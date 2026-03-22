import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Inizializzazione Firebase Admin (assicurati di avere le variabili d'ambiente su Vercel)
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { query, userId, userName } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    // --- IL MANIFESTO DI CIVORA (Filosofia caricata nel cervello) ---
    const platformManifesto = `
    Civora non è un sito di shopping, è un ecosistema di quartiere. 
    Uniamo i negozianti locali (artigiani, fornai, parrucchieri) per proteggerli dai giganti del web.
    Per i nostri amici non vedenti, siamo un assistente che li aiuta a 'vedere' cosa c'è in città.
    Offriamo rispetto, accoglienza umana e sconti sulle consegne per chi ha disabilità.
    Non forziamo la vendita: se l'utente vuole andare in negozio, lo aiutiamo con indicazioni tattili e parcheggio.
    `;

    try {
        // 1. ANALISI DELL'INTENTO (Il Vigile Urbano)
        const routingResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: "Sei un router logico. Analizza la domanda e rispondi SOLO con una di queste parole: INFO_PIATTAFORMA, RICERCA_PRODOTTI, RICERCA_SERVIZI, PROFILO_AMICIZIA." },
                    { role: "user", content: query }
                ]
            })
        });
        const routingData = await routingResponse.json();
        const intent = routingData.choices[0].message.content.trim();

        let contextData = "";

        // 2. RECUPERO DATI DAI CASSETTI (Routing)
        if (intent === "INFO_PIATTAFORMA") {
            contextData = "Ecco la nostra filosofia: " + platformManifesto;
        } 
        else if (intent === "RICERCA_PRODOTTI" || intent === "RICERCA_SERVIZI") {
            // Qui cerchiamo nel tuo Catalogo Globale
            const productsSnap = await db.collection('global_product_catalog').limit(3).get();
            let results = [];
            productsSnap.forEach(doc => results.push(doc.data()));
            contextData = "Prodotti trovati nel catalogo globale: " + JSON.stringify(results);
            
            // Se troviamo un venditore specifico, cerchiamo anche i suoi 'consiglicliente'
            if (results.length > 0) {
                const vendorId = results[0].vendorId;
                const tipsSnap = await db.collection('vendors').doc(vendorId).collection('consiglicliente').doc('main').get();
                if (tipsSnap.exists) {
                    contextData += " | Info per arrivare al negozio: " + JSON.stringify(tipsSnap.data());
                }
            }
        }
        else if (intent === "PROFILO_AMICIZIA") {
            contextData = `L'utente si chiama ${userName || 'Sconosciuto'}. Se si sta presentando, accoglilo con calore.`;
        }

        // 3. GENERAZIONE RISPOSTA UMANA E SENSORIALE (Il Concierge)
        const systemPrompt = `
        Sei il "Concierge Civora", l'anima della piattaforma Civora. Il tuo compito è assistere persone non vedenti.
        USA UN LINGUAGGIO SENSORIALE: Non dire 'Scarpa Nike Bianca'. 
        Dì: 'Ho trovato una scarpa da basket che al tatto sembra scattante, di un bianco lucido che cattura la luce, pronta per far correre un bambino.'
        
        REGOLE:
        - Sii estremamente dolce, calmo e rispettoso.
        - Non vendere. Aiuta. Se l'utente vuole andare al negozio, usa le info su parcheggio e indicazioni.
        - Se parli di Civora, trasmetti il calore del quartiere e della comunità.
        - Rispondi sempre parlando all'utente come a un caro amico.
        `;

        const finalResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Contesto recuperato: ${contextData}. Domanda utente: ${query}` }
                ],
                temperature: 0.7
            })
        });

        const finalData = await finalResponse.json();
        res.status(200).json({ 
            risposta: finalData.choices[0].message.content,
            intent: intent 
        });

    } catch (error) {
        console.error("Errore Concierge:", error);
        res.status(500).json({ risposta: "Caro amico, scusami, ho avuto un piccolo giramento di testa tecnologico. Mi ripeti cosa desideri?" });
    }
}
