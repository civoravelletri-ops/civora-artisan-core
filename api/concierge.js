import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Inizializzazione Firebase Admin con decodifica automatica (Base64 o JSON)
let serviceAccount;
try {
    const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (rawKey.startsWith('{')) {
        // Se è JSON normale
        serviceAccount = JSON.parse(rawKey);
    } else {
        // Se è Base64 (quello che inizia con "ewog")
        serviceAccount = JSON.parse(Buffer.from(rawKey, 'base64').toString('utf8'));
    }
} catch (e) {
    console.error("Errore critico nella lettura della chiave Firebase:", e);
}

if (!getApps().length && serviceAccount) {
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
                                    { role: "system", content: `Sei un router di intenti. Analizza la richiesta dell'utente e classificala in una e una sola delle seguenti categorie. Rispondi SOLO con il nome della categoria, senza spiegazioni o punteggiatura.
                                        CATEGORIE:
                                        - INFO_PIATTAFORMA: Domande su Civora, la sua missione, come funziona, la sua storia, i suoi valori.
                                        - RICERCA_PRODOTTI: Domande per trovare prodotti specifici (es. "scarpe", "pane", "regalo").
                                        - RICERCA_SERVIZI: Domande per trovare servizi specifici (es. "parrucchiere", "massaggio", "dentista").
                                        - PROFILO_AMICIZIA: L'utente si presenta, chiede di essere chiamato per nome, o interagisce a livello personale.

                                        Esempio:
                                        Utente: Chi sei?
                                        Risposta: INFO_PIATTAFORMA
                                        Utente: Vorrei un massaggio rilassante.
                                        Risposta: RICERCA_SERVIZI
                                        Utente: Mi chiamo Andrea.
                                        Risposta: PROFILO_AMICIZIA
                                        Utente: Dove trovo delle mele?
                                        Risposta: RICERCA_PRODOTTI
                                        `
                                    },
                                    { role: "user", content: query }
                                ]
            })
        });
        const routingData = await routingResponse.json();
                let intent = "INFO_PIATTAFORMA"; // Default a INFO_PIATTAFORMA se l'AI non risponde

                if (routingData.choices && routingData.choices.length > 0) {
                    intent = routingData.choices[0].message.content.trim();
                } else {
                    console.warn("Groq non ha restituito un intento valido per la query:", query, "Usando default INFO_PIATTAFORMA.");
                }

        let contextData = "";

        // 2. RECUPERO DATI DAI CASSETTI (Routing)
        if (intent === "INFO_PIATTAFORMA") {
                    contextData = "Ecco la nostra filosofia: " + platformManifesto;
                }
                else if (intent === "RICERCA_PRODOTTI" || intent === "RICERCA_SERVIZI") {
                    let searchResults = [];
                    const keywordQueryParts = query.toLowerCase().split(' ').filter(w => w.length > 2); // Split della query per parole chiave
                    
                    let catalogSnapshot;
                    if (keywordQueryParts.length > 0) {
                        // Ricerca in 'searchableIndex' che hai già, filtrando per parole chiave
                        catalogSnapshot = await db.collection('global_product_catalog')
                                                    .where('searchableIndex', 'array-contains-any', keywordQueryParts)
                                                    .limit(2) // Limita a 2 risultati per un racconto più gestibile
                                                    .get();
                    } else {
                        // Fallback a una query generica se non ci sono parole chiave valide
                        catalogSnapshot = await db.collection('global_product_catalog').limit(2).get();
                    }
        
                    catalogSnapshot.forEach(doc => searchResults.push({ id: doc.id, ...doc.data() }));
        
                    if (searchResults.length > 0) {
                        contextData = `Hai chiesto di un ${intent === "RICERCA_PRODOTTI" ? "prodotto" : "servizio"}. Ho trovato: \n`;
                        for (const result of searchResults) {
                            contextData += `- ${result.productName} (${result.vendorStoreName}). Descrizione: ${result.productDescription || result.shortDescription || 'Nessuna descrizione.'}. Prezzo: ${result.price}€.\n`;
                            
                            const vendorTipsSnap = await db.collection('vendors').doc(result.vendorId).collection('consiglicliente').doc('main').get();
                            if (vendorTipsSnap.exists) {
                                const tips = vendorTipsSnap.data();
                                contextData += `  Per arrivare da ${result.vendorStoreName}: ${tips.directions || 'Nessuna indicazione.'}. Parcheggio: ${tips.parkingTips || 'Nessun suggerimento.'}.\n`;
                            }
                        }
                    } else {
                        contextData = "Mi dispiace, non ho trovato nulla che corrisponda alla tua richiesta nel nostro catalogo. Puoi provare a chiedermi in un altro modo, o forse cercare qualcosa di più generale?";
                    }
                } 
                else if (intent === "PROFILO_AMICIZIA") {
                    if (userName) {
                        contextData = `L'utente si chiama ${userName}. Vuole fare amicizia con te, Civora.`;
                    } else {
                        contextData = `L'utente sta parlando del suo profilo o vuole presentarsi. Invitalo a dire il suo nome.`;
                    }
                } else { // Fallback generico se l'intento non è riconosciuto o è un caso limite
                    contextData = "Non sono sicuro di aver capito. Riprova a chiedere in modo diverso, oppure chiedimi di Civora.";
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
