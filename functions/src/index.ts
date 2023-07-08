import * as functions from 'firebase-functions'
import {initializeApp} from 'firebase-admin/app';
import express from 'express'
import cors from 'cors'
import axios from "axios";
import {parse} from 'node-html-parser';
import {getFirestore} from 'firebase-admin/firestore';
import * as cheerio from "cheerio"


type Card = {
    name: string
    civilization: string
    type: string
    text: string
    manaCost: number
    race: string
    power: number
    manaNumber: number
    flavorText: string
    image: string,
    count: number
}

type ParsedRow = {
    field: keyof Card
    value: string
}

function parseName(name: string) {
    return name.replace(/ /g, "_")
}

async function getCard(name: string) {
    const url = `https://duelmasters.fandom.com/wiki/${parseName(name)}`
    try {
        const response = await axios.get<string>(url)
        const html = response.data
        return parseHtml(html, name)
    } catch (e) {
        console.log(e)
        throw new Error("Card not found")
    }
}

function parseHtml(html: string, name: string) {
    const root = parse(html)
    const body = root.querySelector("body")
    const table = body?.querySelector(".wikitable")
    const rows = table?.querySelectorAll("tr")
    const card: Card = {
        name,
        civilization: "",
        type: "",
        text: "",
        manaCost: 0,
        power: 0,
        flavorText: "",
        manaNumber: 0,
        race: "",
        image: "",
        count: 1
    }
    rows?.forEach((row, index) => {
        const parsedRow = parseRow(row as unknown as HTMLTableRowElement, index)
        if (parsedRow) {
            if (isNumberField(parsedRow.field)) {
                (card[parsedRow.field] as any) = parseInt(parsedRow.value)
            } else {
                (card[parsedRow.field] as any) = parsedRow.value
            }
        }
    })

    return card
}

function isNumberField(field: keyof Card) {
    return field === "manaCost" || field === "power" || field === "manaNumber"
}

function parseRow(row: HTMLTableRowElement, index: number): ParsedRow | undefined {
    const header = row.querySelector("th")

    if (header) {
        // Ignore headers
        return undefined
    }

    const dataFields = row.querySelectorAll("td")

    if (dataFields.length !== 2) {
        // Image row
        const img = row.querySelector("img")
        if (!img || index !== 1) {
            return undefined
        }

        return {
            field: "image",
            value: img.getAttribute("src") ?? ""
        }
    }

    const fieldHeader = dataFields[0].querySelector("a span")?.innerHTML ?? ""
    const $ = cheerio.load(dataFields[1].innerHTML)
    const value = sanitize($.text())
    const field = getFieldNameByHeader(fieldHeader)

    if (field === null) {
        return undefined
    }

    return {
        field,
        value
    }
}

function sanitize(text: string) {
    return text.replace("■", "").trim()
}

function getFieldNameByHeader(header: string): keyof Card | null {
    switch (header) {
        case "Civilization":
            return "civilization"
        case "Card Type":
            return "type"
        case "English Text":
            return "text"
        case "Mana Cost":
            return "manaCost"
        case "Race":
            return "race"
        case "Power":
            return "power"
        case "Mana Number":
            return "manaNumber"
        case "Flavor Text":
            return "flavorText"
        default:
            return null
    }
}

function addCard(card: Card) {
    return getFirestore().collection("cards").doc(card.name).set(card)
}

function updateCardNumber(increment: number, card: Card) {
    return getFirestore().collection("cards").doc(card.name).update({count: card.count + increment})
}

async function getCardFromFirestore(name: string) {
    return (await getFirestore().collection("cards").doc(name).get()).data() as Card
}

function getExpressApp() {
    const app = express();

// Enable CORS
    app.use(cors({origin: true}));

// Parse JSON request bodies
    app.use(express.json());

    app.post("/card/:name", async (req, res) => {
        const name = req.params.name;
        try {
            const card = await getCard(name)
            await addCard(card)
            res.sendStatus(201)
        } catch (e) {
            res.status(500).send((e as Error).message)
        }
    })

    app.patch("/card/:name", async (req, res) => {
        const name = req.params.name;
        const increment = req.body.increment as number;
        try {
            await updateCardNumber(increment, await getCardFromFirestore(name))
            res.sendStatus(200)
        } catch (e) {
            res.status(500).send((e as Error).message)
        }
    })

    return app

}


initializeApp();

// Export the Express app as a Firebase Cloud Function
exports.api = functions.region('europe-west1').https.onRequest(getExpressApp());