// api/shopping-assistant.js

const admin = require('firebase-admin');
const SUPPORTED_LANGUAGES = ['it', 'en', 'fr', 'de', 'es', 'ru', 'ro', 'sq', 'hi', 'ar', 'zh'];

// ==================================================================
// 1. INIZIALIZZAZIONE FIREBASE
// ==================================================================
let db;
if (!admin.apps.length) {
    let firebaseConfig = null;
    const firebaseServiceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

    if (firebaseServiceAccountKey) {
        try {
            firebaseConfig = JSON.parse(firebaseServiceAccountKey);
        } catch (e) {
            try {
                firebaseConfig = JSON.parse(Buffer.from(firebaseServiceAccountKey, 'base64').toString('utf8'));
            } catch (e2) {
                console.error("❌ ERRORE CRITICO: Impossibile leggere FIREBASE_SERVICE_ACCOUNT_KEY", e2);
            }
        }
    }

    if (firebaseConfig) {
        admin.initializeApp({ credential: admin.credential.cert(firebaseConfig) });
        db = admin.firestore();
    }
} else {
    db = admin.firestore();
}

// ==================================================================
// 2. FUNZIONI DI SUPPORTO AI (Groq API - MODELLO LLAMA-3.1-8B-INSTANT)
// ==================================================================
async function callGroqAPI(systemPrompt, userPromptText, groqApiKey, temperature = 0.1, response_format = { type: "text" }) {
    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant", // IL MODELLO CHE HAI SCELTO TU
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: [{ type: "text", text: userPromptText }] }
                ],
                temperature: temperature,
                max_tokens: 2000,
                response_format: response_format
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Errore API Groq: ${errorData.error?.message || 'Sconosciuto'}`);
        }

        const data = await response.json();
        return data.choices[0].message.content.trim();

    } catch (error) {
        throw error;
    }
}

async function translateText(text, targetLang, groqApiKey) {
    if (!text || targetLang === 'it') return text;
    const systemPrompt = `Traduci il seguente testo in ${targetLang}. Rispondi SOLO con il testo tradotto, senza frasi aggiuntive.`;
    return await callGroqAPI(systemPrompt, text, groqApiKey, 0.1);
}

async function translateTextToItalian(text, sourceLang, groqApiKey) {
    if (!text || sourceLang === 'it' || sourceLang.startsWith('it-')) return text;
    const systemPrompt = `Traduci il seguente testo in italiano. Rispondi SOLO con il testo tradotto, senza frasi aggiuntive.`;
    return await callGroqAPI(systemPrompt, text, groqApiKey, 0.1);
}

// ==================================================================
// 3. LOGICA ADDESTRAMENTO
// ==================================================================
async function handleTeachAICollaborator(req, res, groqApiKey) {
    const { vendorId, rawInstructions, currentMemory, vendorDashboardLang } = req.body;

    const instructionsInItalian = await translateTextToItalian(rawInstructions, vendorDashboardLang, groqApiKey);
    
    // ESTRAZIONE STRUTTURATA
    const structPrompt = `Sei un assistente esperto. Estrai dati JSON da questo testo. 
    Campi: anno_fondazione, specialita_vivaio (array), filosofia_generale, regole_sconti_quantita (mappa), regole_sconti_promo (array), personale (array), orari_speciali, tono_di_voce_ai, discount_strategy_rules (array), customer_psychology_rules (array), forbidden_words (array), preferred_words (array), descrizione_generale_vivaio, sede_fisica.`;
    const structUser = `TESTO: "${instructionsInItalian}"\nMEMORIA: "${currentMemory || ''}"`;
    const structResp = await callGroqAPI(structPrompt, structUser, groqApiKey, 0.2, { type: "json_object" });
    const structuredMemory = JSON.parse(structResp);

    // RIASSUNTO FLUIDO
    const summaryPrompt = `Consolida le istruzioni in un testo fluido in italiano. Inizia con 'Ho imparato che...'`;
    const summaryUser = `NUOVO: "${instructionsInItalian}"\nVECCHIO: "${currentMemory || ''}"`;
    const newConsolidatedMemory_it = await callGroqAPI(summaryPrompt, summaryUser, groqApiKey, 0.3);

    const newInstructions_i18n = {};
    for (const lang of SUPPORTED_LANGUAGES) {
        newInstructions_i18n[lang] = await translateText(newConsolidatedMemory_it, lang, groqApiKey);
    }

    return res.status(200).json({
        newInstructions_it: newConsolidatedMemory_it,
        newInstructions_i18n: newInstructions_i18n,
        structured_memory: structuredMemory
    });
}

// ==================================================================
// 4. LOGICA CLIENTE (BOTANICO)
// ==================================================================
async function handleBotanicoClient(req, res, groqApiKey) {
    const { contesto } = req.body;
    const vendorId = contesto.vendorId;

    let structuredMemory = {};
    let generalInstructions = "";
    if (vendorId) {
        const aiMemoryDoc = await db.collection('vendors').doc(vendorId).collection('ai_assistant').doc('memory').get();
        if (aiMemoryDoc.exists) {
            const data = aiMemoryDoc.data();
            structuredMemory = data.structured_memory || {};
            generalInstructions = data.instructions_i18n?.[contesto.lang] || data.instructions || "";
        }
    }

    const systemPrompt = `Sei il Botanico Digitale di "${contesto.storeName || 'Vivaio'}". Tono amichevole di Velletri. 
    CONTESTO NEGOZIO: ${JSON.stringify(structuredMemory)}
    ISTRUZIONI: ${generalInstructions}
    PRODOTTI: ${JSON.stringify(contesto.prodotti_semplificati)}
    Rispondi in ${contesto.lang || 'it'} (max 4 frasi). SOLO JSON {"risposta": "testo"}`;

    const aiResponse = await callGroqAPI(systemPrompt, `DOMANDA: "${contesto.query}"`, groqApiKey, 0.5, { type: "json_object" });
    return res.status(200).json(JSON.parse(aiResponse));
}

// ==================================================================
// 5. VECCHIA LOGICA CARRELLI
// ==================================================================
async function handlePersonalShopperCarrelli(req, res, groqApiKey) {
    const { contesto } = req.body;
    const systemPrompt = `Sei il Personal Shopper. Crea 3 carrelli JSON.`;
    const aiResponse = await callGroqAPI(systemPrompt, `RICHIESTA: "${contesto.richiestaUtente}" - PRODOTTI: ${JSON.stringify(contesto.prodotti)}`, groqApiKey, 0.5, { type: "json_object" });
    return res.status(200).json(JSON.parse(aiResponse));
}

// ==================================================================
// 6. HANDLER PRINCIPALE
// ==================================================================
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) return res.status(500).json({ error: "API Key mancante" });

    const { action } = req.body || {};

    try {
        switch (action) {
            case 'teach_ai_collaborator': return await handleTeachAICollaborator(req, res, GROQ_API_KEY);
            case 'botanico': return await handleBotanicoClient(req, res, GROQ_API_KEY);
            case 'carrelli': return await handlePersonalShopperCarrelli(req, res, GROQ_API_KEY);
            default: return res.status(400).json({ error: 'Azione sconosciuta' });
        }
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
