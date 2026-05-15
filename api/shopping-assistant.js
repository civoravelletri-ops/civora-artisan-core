// api/shopping-assistant.js

const admin = require('firebase-admin');
const SUPPORTED_LANGUAGES = ['en', 'fr', 'de', 'es', 'ru', 'ro', 'sq', 'hi', 'ar', 'zh']; // 'it' lo gestiamo a parte

// ==================================================================
// 1. INIZIALIZZAZIONE FIREBASE
// ==================================================================
let db;
if (!admin.apps.length) {
    const firebaseServiceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (firebaseServiceAccountKey) {
        try {
            const firebaseConfig = JSON.parse(Buffer.from(firebaseServiceAccountKey, 'base64').toString('utf8'));
            admin.initializeApp({ credential: admin.credential.cert(firebaseConfig) });
            db = admin.firestore();
        } catch (e) { console.error("Errore Firebase Init", e); }
    }
} else { db = admin.firestore(); }

// ==================================================================
// 2. FUNZIONE CORE API (MODELLO 70B - PIÙ POTENTE)
// ==================================================================
async function callGroqAPI(systemPrompt, userPromptText, groqApiKey, temperature = 0.1, response_format = { type: "text" }) {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "llama-3.3-70b-versatile", // USARE QUESTO: HA LIMITI PIÙ ALTI (30k TPM)
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPromptText }],
            temperature: temperature,
            response_format: response_format
        })
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || "Errore API");
    }
    const data = await response.json();
    return data.choices[0].message.content.trim();
}

// ==================================================================
// 3. LOGICA ADDESTRAMENTO (OTTIMIZZATA: 1 SOLA CHIAMATA PER TUTTE LE LINGUE)
// ==================================================================
async function handleTeachAICollaborator(req, res, groqApiKey) {
    const { rawInstructions, currentMemory, vendorDashboardLang } = req.body;

    // A. TRADUCI IN ITALIANO SE NECESSARIO
    const instructionsInItalian = await callGroqAPI("Traduci in italiano. Rispondi solo col testo.", rawInstructions, groqApiKey);
    
    // B. ESTRAZIONE STRUTTURATA (JSON)
    const structPrompt = `Sei un assistente esperto. Estrai dati JSON. Campi: anno_fondazione, specialita_vivaio (array), filosofia_generale, regole_sconti_quantita (mappa), personale (array), orari_speciali, tono_di_voce_ai, discount_strategy_rules (array), customer_psychology_rules (array), forbidden_words (array), preferred_words (array), descrizione_generale_vivaio.`;
    const structUser = `TESTO: "${instructionsInItalian}"\nMEMORIA: "${currentMemory || ''}"`;
    const structResp = await callGroqAPI(structPrompt, structUser, groqApiKey, 0.2, { type: "json_object" });
    const structuredMemory = JSON.parse(structResp);

    // C. RIASSUNTO FLUIDO (ITALIANO)
    const summaryPrompt = `Consolida le istruzioni in un testo fluido in italiano per la memoria dell'AI. Inizia con 'Ho imparato che...'`;
    const summaryUser = `NUOVO: "${instructionsInItalian}"\nVECCHIO: "${currentMemory || ''}"`;
    const newMemory_it = await callGroqAPI(summaryPrompt, summaryUser, groqApiKey, 0.3);

    // D. TRADUZIONE MASSIVA (UNA SOLA CHIAMATA PER 10 LINGUE!) - Così non andiamo in Rate Limit
    const translatePrompt = `Traduci il testo fornito in queste lingue: ${SUPPORTED_LANGUAGES.join(', ')}. Rispondi SOLO con un oggetto JSON dove le chiavi sono i codici lingua.`;
    const translateResp = await callGroqAPI(translatePrompt, newMemory_it, groqApiKey, 0.1, { type: "json_object" });
    const translations = JSON.parse(translateResp);
    
    // Uniamo l'italiano alla mappa
    const newInstructions_i18n = { it: newMemory_it, ...translations };

    return res.status(200).json({
        newInstructions_it: newMemory_it,
        newInstructions_i18n: newInstructions_i18n,
        structured_memory: structuredMemory
    });
}

// ==================================================================
// 4. LOGICA CLIENTE (BOTANICO)
// ==================================================================
async function handleBotanicoClient(req, res, groqApiKey) {
    const { contesto } = req.body;
    let structuredMemory = {};
    let generalInstructions = "";

    if (contesto.vendorId) {
        const aiMemoryDoc = await db.collection('vendors').doc(contesto.vendorId).collection('ai_assistant').doc('memory').get();
        if (aiMemoryDoc.exists) {
            const data = aiMemoryDoc.data();
            structuredMemory = data.structured_memory || {};
            generalInstructions = data.instructions_i18n?.[contesto.lang] || data.instructions || "";
        }
    }

    const systemPrompt = `Sei il Botanico Digitale di "${contesto.storeName}". Tono velletrano amichevole. CONTESTO: ${JSON.stringify(structuredMemory)}. ISTRUZIONI: ${generalInstructions}. PRODOTTI: ${JSON.stringify(contesto.prodotti_semplificati)}. Rispondi in ${contesto.lang || 'it'} (max 3 frasi). SOLO JSON {"risposta": "testo"}`;
    const aiResponse = await callGroqAPI(systemPrompt, contesto.query, groqApiKey, 0.5, { type: "json_object" });
    return res.status(200).json(JSON.parse(aiResponse));
}

// ==================================================================
// 5. VECCHIA LOGICA CARRELLI
// ==================================================================
async function handlePersonalShopperCarrelli(req, res, groqApiKey) {
    const { contesto } = req.body;
    const systemPrompt = `Sei il Personal Shopper. Crea 3 carrelli JSON basati su: ${contesto.richiestaUtente}. Prodotti: ${JSON.stringify(contesto.prodotti)}`;
    const aiResponse = await callGroqAPI(systemPrompt, "Genera carrelli", groqApiKey, 0.5, { type: "json_object" });
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
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) return res.status(500).json({ error: "API Key mancante" });

    try {
        const { action } = req.body;
        switch (action) {
            case 'teach_ai_collaborator': return await handleTeachAICollaborator(req, res, GROQ_API_KEY);
            case 'botanico': return await handleBotanicoClient(req, res, GROQ_API_KEY);
            case 'carrelli': return await handlePersonalShopperCarrelli(req, res, GROQ_API_KEY);
            default: return res.status(400).json({ error: 'Azione sconosciuta' });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
}
