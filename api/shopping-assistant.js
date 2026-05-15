// api/shopping-assistant.js

const admin = require('firebase-admin');
const SUPPORTED_LANGUAGES = ['en', 'fr', 'de', 'es', 'ru', 'ro', 'sq', 'hi', 'ar', 'zh'];

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
// 2. FUNZIONE CORE API (llama-3.3-70b-versatile)
// ==================================================================
async function callGroqAPI(systemPrompt, userPromptText, groqApiKey, temperature = 0.1, isJson = false) {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPromptText }
            ],
            temperature: temperature,
            response_format: isJson ? { type: "json_object" } : { type: "text" }
        })
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || "Errore API Groq");
    }
    const data = await response.json();
    return data.choices[0].message.content.trim();
}

// ==================================================================
// 3. LOGICA ADDESTRAMENTO (CORAZZATA)
// ==================================================================
async function handleTeachAICollaborator(req, res, groqApiKey) {
    const { rawInstructions, currentMemory, vendorId } = req.body;

    // A. TRADUZIONE IN ITALIANO
    const itPrompt = "Sei un traduttore. Traduci il testo in italiano perfetto. Rispondi SOLO con la traduzione.";
    const instructionsInItalian = await callGroqAPI(itPrompt, rawInstructions, groqApiKey);

    // B. ESTRAZIONE STRUTTURATA (OBLIGATORIO JSON)
    const structPrompt = `Sei un analista dati. Estrai un oggetto JSON dal testo.
    REGOLE: Rispondi SOLO con JSON. Campi: anno_fondazione, specialita_vivaio (array), filosofia_generale, regole_sconti_quantita (mappa), personale (array), orari_speciali, tono_di_voce_ai, discount_strategy_rules (array), customer_psychology_rules (array), forbidden_words (array), preferred_words (array), descrizione_generale_vivaio.`;

    const structUser = `TESTO NUOVO: "${instructionsInItalian}"\nMEMORIA VECCHIA: "${currentMemory || ''}"`;
    const structResp = await callGroqAPI(structPrompt, structUser, groqApiKey, 0.1, true);
    const structuredMemory = JSON.parse(structResp);

    // C. RIASSUNTO FLUIDO (ITALIANO)
    const summaryPrompt = "Crea un testo fluido in italiano che riassuma la memoria dell'AI. Inizia con 'Ho imparato che...'";
    const newMemory_it = await callGroqAPI(summaryPrompt, JSON.stringify(structuredMemory), groqApiKey, 0.3);

    // D. TRADUZIONE MASSIVA (JSON)
    const translatePrompt = `Traduci in queste lingue: ${SUPPORTED_LANGUAGES.join(', ')}.
    REGOLE: Rispondi SOLO con un oggetto JSON dove le chiavi sono i codici lingua.`;

    const translateResp = await callGroqAPI(translatePrompt, newMemory_it, groqApiKey, 0.1, true);
    const translations = JSON.parse(translateResp);

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
        try {
            const aiMemoryDoc = await db.collection('vendors').doc(contesto.vendorId).collection('ai_assistant').doc('memory').get();
            if (aiMemoryDoc.exists) {
                const data = aiMemoryDoc.data();
                structuredMemory = data.structured_memory || {};
                generalInstructions = data.instructions_i18n?.[contesto.lang] || data.instructions || "";
            }
        } catch (e) { console.error("Errore lettura DB", e); }
    }

    const systemPrompt = `Sei il Botanico Digitale di "${contesto.storeName}". Tono amichevole. CONTESTO: ${JSON.stringify(structuredMemory)}. ISTRUZIONI: ${generalInstructions}. PRODOTTI: ${JSON.stringify(contesto.prodotti_semplificati)}.
    REGOLE: Rispondi in ${contesto.lang || 'it'} (max 3 frasi). Rispondi SOLO con un oggetto JSON {"risposta": "tuo testo"}`;

    const aiResponse = await callGroqAPI(systemPrompt, contesto.query, groqApiKey, 0.5, true);
    return res.status(200).json(JSON.parse(aiResponse));
}

// ==================================================================
// 5. VECCHIA LOGICA CARRELLI
// ==================================================================
async function handlePersonalShopperCarrelli(req, res, groqApiKey) {
    const { contesto } = req.body;
    const systemPrompt = `Sei un Personal Shopper. Crea 3 carrelli spesa. Rispondi SOLO con un oggetto JSON {"carrelli": [...]}. Richiesta: ${contesto.richiestaUtente}. Prodotti: ${JSON.stringify(contesto.prodotti)}`;
    const aiResponse = await callGroqAPI(systemPrompt, "Genera carrelli", groqApiKey, 0.5, true);
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
                case 'teach_ai_collaborator':
                    return await handleTeachAICollaborator(req, res, GROQ_API_KEY);

                case 'sync_vendor_inventory':
                    return await handleSyncInventory(req, res, GROQ_API_KEY);

                case 'botanico':
                    return await handleBotanicoClient(req, res, GROQ_API_KEY);

                case 'carrelli':
                    return await handlePersonalShopperCarrelli(req, res, GROQ_API_KEY);

                default: return res.status(400).json({ error: 'Azione sconosciuta' });
            }
    } catch (error) {
        console.error("Errore Handler:", error);
        return res.status(500).json({ error: error.message });
    }
}
// ==================================================================
// 7. LOGICA SINCRONIZZAZIONE AUTOMATICA (RIASSUNTO CATALOGO E PROFILO)
// ==================================================================
async function handleSyncInventory(req, res, groqApiKey) {
    const { vendorData, products, currentMemory } = req.body;

    const systemPrompt = `Sei un esperto analista di business. Riceverai i dati di un negozio e la lista dei suoi prodotti.
    Il tuo compito è creare un "Manuale di Conoscenza" per l'assistente AI del negozio.
    DEVI strutturare la risposta in JSON con:
    1. newInstructions_it: Un testo fluido che riassume chi è il negozio, orari, e cosa vende (diviso per categorie).
    2. structured_memory: Un oggetto con campi chiave estratti (orari, categorie_principali, range_prezzi).
    3. newInstructions_i18n: Le traduzioni del testo fluido.

    Sii professionale e invitante.`;

    const userPrompt = `PROFILO NEGOZIO: ${JSON.stringify(vendorData)}\nPRODOTTI: ${JSON.stringify(products)}\nMEMORIA ATTUALE: ${currentMemory}`;

    const aiResponse = await callGroqAPI(systemPrompt, userPrompt, groqApiKey, 0.3, true);
    const parsed = JSON.parse(aiResponse);

    // Generiamo le traduzioni massive come abbiamo fatto prima
    const translatePrompt = `Traduci in queste lingue: en, fr, de, es, ru, ro, sq, hi, ar, zh. Rispondi solo JSON.`;
    const translateResp = await callGroqAPI(translatePrompt, parsed.newInstructions_it, groqApiKey, 0.1, true);
    const translations = JSON.parse(translateResp);

    return res.status(200).json({
        newInstructions_it: parsed.newInstructions_it,
        newInstructions_i18n: { it: parsed.newInstructions_it, ...translations },
        structured_memory: parsed.structured_memory
    });
}
