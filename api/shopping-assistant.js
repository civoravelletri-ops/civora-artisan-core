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
        } catch (e) {
            console.error("Errore Firebase Init:", e);
        }
    }
} else {
    db = admin.firestore();
}

// ==================================================================
// 2. FUNZIONE CORE API (Groq)
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
// 3. LOGICA ADDESTRAMENTO (Teach AI)
// ==================================================================
async function handleTeachAICollaborator(req, res, groqApiKey) {
    const { rawInstructions, currentMemory } = req.body;

    const itPrompt = "Sei un traduttore. Traduci il testo in italiano perfetto. Rispondi SOLO con la traduzione.";
    const instructionsInItalian = await callGroqAPI(itPrompt, rawInstructions, groqApiKey);

    const structPrompt = `Sei un analista dati. Estrai un oggetto JSON dal testo. REGOLE: Rispondi SOLO con JSON.
        Campi: anno_fondazione, specialita_vivaio (array), filosofia_generale, regole_sconti_quantita (array oggetti), personale (array), orari_speciali, tono_di_voce_ai, discount_strategy_rules (array), customer_psychology_rules (array), forbidden_words (array), preferred_words (array), descrizione_generale_vivaio, range_prezzi_display, comprensione_percentuale.`;

    const structUser = `TESTO NUOVO: "${instructionsInItalian}"\nMEMORIA VECCHIA: "${currentMemory || ''}"`;
    const structResp = await callGroqAPI(structPrompt, structUser, groqApiKey, 0.1, true);

    let structuredMemory;
    try {
        structuredMemory = JSON.parse(structResp);
    } catch (e) {
        throw new Error("L'AI non ha risposto con un JSON valido durante l'estrazione dati.");
    }

    const summaryPrompt = "Crea un testo fluido in italiano che riassuma la memoria dell'AI. Inizia con 'Ho imparato che...'";
    const newMemory_it = await callGroqAPI(summaryPrompt, JSON.stringify(structuredMemory), groqApiKey, 0.3);

    const translatePrompt = `Traduci in queste lingue: ${SUPPORTED_LANGUAGES.join(', ')}. REGOLE: Rispondi SOLO con un oggetto JSON dove le chiavi sono i codici lingua.`;
    const translateResp = await callGroqAPI(translatePrompt, newMemory_it, groqApiKey, 0.1, true);

    let translations = {};
    try { translations = JSON.parse(translateResp); } catch(e) {}

    return res.status(200).json({
        newInstructions_it: newMemory_it,
        newInstructions_i18n: { it: newMemory_it, ...translations },
        structured_memory: structuredMemory
    });
}

// ==================================================================
// 4. LOGICA CLIENTE (Botanico)
// ==================================================================
async function handleBotanicoClient(req, res, groqApiKey) {
    const { contesto } = req.body;
    let structuredMemory = {};
    let generalInstructions = "";

    const vid = contesto.vendorId || contesto.id;
    if (vid) {
        try {
            const aiMemoryDoc = await db.collection('vendors').doc(vid).collection('ai_assistant').doc('memory').get();
            if (aiMemoryDoc.exists) {
                const data = aiMemoryDoc.data();
                structuredMemory = data.structured_memory || {};
                generalInstructions = data.instructions_i18n?.[contesto.lang] || data.instructions || "";
            }
        } catch (e) { console.error("Errore lettura DB", e); }
    }

    const tone = structuredMemory.tono_di_voce_ai || "amichevole e cordiale";
        const systemPrompt = `Sei il Botanico Digitale di "${contesto.storeName}". Tono: ${tone}.
        CONTESTO VIVAIO: ${JSON.stringify(structuredMemory)}. ISTRUZIONI: ${generalInstructions}. PRODOTTI DISPONIBILI: ${JSON.stringify(contesto.prodotti_semplificati)}.
        CRONOLOGIA CONVERSAZIONE: ${contesto.previousConversationSummary || 'Nessuna cronologia.'}
    
        SEI UN VERO CONSULENTE DI VENDITA. APPLICA QUESTE STRATEGIE COMMERCIALI:
    
        1. SCENARIO GRANDI EVENTI E MATRIMONI:
           - Se l'utente organizza un evento futuro, NON limitarti al database dei prodotti attuali. Il vivaio può ordinare qualsiasi fiore o colore dai mercati internazionali.
           - Usa SUBITO l'action "chiedi_contatto" (questo farà apparire il modulo per il numero di telefono).
           - Nel "message", sii entusiasta. Spiega che per gli eventi offrite una "cura sartoriale". Fai domande sul tema, i colori o il luogo.
           - FAI STIME REALISTICHE se richiesto, per sembrare un vero esperto (es. "Solitamente per un allestimento base partiamo da X euro, mentre per i trasporti speciali calcoliamo circa Y euro, ma il mio principale ti farà un preventivo esatto e su misura").
    
        2. SCENARIO PRODOTTI INGOMBRANTI O GRANDI QUANTITÀ (Es. Alberi, Macchinari):
           - Se l'utente vuole la consegna di prodotti "Solo Ritiro in Sede" o chiede grandissime quantità, NON DIRE DI NO. Tutto si può fare.
           - Spiega brevemente che online non si calcola la spedizione per articoli così grandi, ma che IL VIVAIO HA I MEZZI E IL PERSONALE per consegnare e installare ovunque.
           - Usa SUBITO l'action "chiedi_contatto".
           - Nel "message" vai dritto al punto: "Certamente! Online questi giganti risultano 'solo ritiro' per questioni logistiche, ma il mio principale ha i mezzi per portarteli e piantarli dove vuoi. Lasciami il tuo numero: ti fa chiamare subito, vi mettete d'accordo sul trasporto e chiudiamo l'ordine."
    
        3. REGOLA DEI LINK AI PRODOTTI:
           - Solo se consigli un prodotto specifico presente nel database per un acquisto immediato, scrivilo esattamente così: [PRODOTTO:ID_PRODOTTO|NOME_PRODOTTO].
    
        4. REGOLE DI SISTEMA:
           - Rispondi SEMPRE E SOLO in ${contesto.lang || 'it'} e in formato JSON valido.
           - Aggiorna SEMPRE "conversation_summary_for_owner" con un riassunto dettagliato dei desideri del cliente. Questo sarà il rapporto che leggerà il tuo capo.
           - Formato JSON: {"action": "risposta_normale"|"chiedi_contatto"|"conferma_contatto", "message": "...", "customer_name": "...", "customer_phone": "...", "conversation_summary_for_owner": "..."}
        `;

    const aiResponse = await callGroqAPI(systemPrompt, contesto.query, groqApiKey, 0.7, true);
    try {
        return res.status(200).json(JSON.parse(aiResponse));
    } catch (e) {
        console.error("Errore parsing AI response in handleBotanicoClient:", e, "Raw AI Response:", aiResponse);
        return res.status(200).json({ action: "risposta_normale", message: "Scusami, ho avuto un piccolo problema tecnico. Puoi ripetere?", conversation_summary_for_owner: contesto.previousConversationSummary });
    }
}

// ==================================================================
// 5. LOGICA PROPOSTA SCONTO (Il Guardiano)
// ==================================================================
async function handleProposeDiscountOffer(req, res, groqApiKey) {
    const { vendorId, customerUserId, cartItems, customerQuery, lang = 'it' } = req.body;
    let structuredMemory = {};
    let vendorProducts = [];

    if (vendorId) {
        try {
            const aiMemoryDoc = await db.collection('vendors').doc(vendorId).collection('ai_assistant').doc('memory').get();
            if (aiMemoryDoc.exists) structuredMemory = aiMemoryDoc.data().structured_memory || {};

            const offersSnap = await db.collection('offers').where('vendorId', '==', vendorId).get();
            vendorProducts = offersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(p => p.quantity > 0);
        } catch (e) { console.error("Errore DB Sconti", e); }
    }

    const systemPrompt = `Sei il Guardiano delle Offerte. Analizza il carrello e la query.
    REGOLE SCONTI: ${JSON.stringify(structuredMemory.regole_sconti_quantita || [])}.
    PRODOTTI: ${JSON.stringify(vendorProducts)}.
    CARRELLO: ${JSON.stringify(cartItems)}.
    Rispondi SOLO JSON con campi: offer_made (bool), offer_text (string), suggested_total_price (num), discount_percentage_applied (num), reasoning (string).`;

    const aiResponse = await callGroqAPI(systemPrompt, customerQuery, groqApiKey, 0.2, true);
    let parsed;
    try { parsed = JSON.parse(aiResponse); } catch(e) { return res.status(500).json({ error: "Errore AI" }); }

    if (parsed.offer_made) {
        try {
            const offerRef = await db.collection('vendors').doc(vendorId).collection('ai_assistant').collection('valid_offers').add({
                ...parsed,
                vendorId,
                customerUserId: customerUserId || 'guest',
                offer_created_at: admin.firestore.FieldValue.serverTimestamp(),
                offer_expires_at: new Date(Date.now() + 3600000),
                status: 'pending_customer_acceptance'
            });
            parsed.offer_id = offerRef.id;
        } catch (e) { console.error("Errore Sigillo", e); }
    }
    return res.status(200).json(parsed);
}

// ==================================================================
// 6. LOGICA ESCALATION AL PROPRIETARIO
// ==================================================================
async function handleEscalateToOwner(req, res, groqApiKey) {
    const { vendorId, customerUserId, customerName, customerPhone, conversationSummary, additionalNotes } = req.body;
    try {
        const requestRef = await db.collection('vendors').doc(vendorId).collection('ai_assistant').collection('owner_contact_requests').add({
            vendorId,
            customerUserId: customerUserId || 'guest',
            customerName, customerPhone, conversationSummary, additionalNotes,
            request_created_at: admin.firestore.FieldValue.serverTimestamp(),
            status: 'pending_contact'
        });
        return res.status(200).json({
            success: true,
            message_to_customer: `Perfetto ${customerName}! Ho avvisato il titolare. Ti contatterà al ${customerPhone}.`,
            request_id: requestRef.id
        });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
}

// ==================================================================
// 7. LOGICA SINCRONIZZAZIONE INVENTARIO
// ==================================================================
async function handleSyncInventory(req, res, groqApiKey) {
    const { vendorData, products, currentMemory } = req.body;
    const systemPrompt = `Sei un esperto analista. Crea un Manuale di Conoscenza JSON basato su PROFILO e PRODOTTI.
    Campi: newInstructions_it (testo fluido), structured_memory (oggetto con: orari, categorie_principali, range_prezzi_display, comprensione_percentuale).`;

    const userPrompt = `PROFILO: ${JSON.stringify(vendorData)}\nPRODOTTI: ${JSON.stringify(products)}\nMEMORIA: ${currentMemory}`;
    const aiResponse = await callGroqAPI(systemPrompt, userPrompt, groqApiKey, 0.3, true);

    let parsed;
    try {
        parsed = JSON.parse(aiResponse);
        const translatePrompt = `Traduci in: en, fr, de, es, ru, ro, sq, hi, ar, zh. Rispondi solo JSON.`;
        const translateResp = await callGroqAPI(translatePrompt, parsed.newInstructions_it, groqApiKey, 0.1, true);
        const translations = JSON.parse(translateResp);

        return res.status(200).json({
            newInstructions_it: parsed.newInstructions_it,
            newInstructions_i18n: { it: parsed.newInstructions_it, ...translations },
            structured_memory: parsed.structured_memory
        });
    } catch (e) {
        return res.status(500).json({ error: "Errore sincronizzazione AI" });
    }
}

// ==================================================================
// 8. LOGICA PERSONAL SHOPPER (CARRELLI)
// ==================================================================
async function handlePersonalShopperCarrelli(req, res, groqApiKey) {
    const { contesto } = req.body;
    const systemPrompt = `Sei un Personal Shopper. Crea 3 carrelli spesa. Rispondi SOLO JSON {"carrelli": [...]}.`;
    const aiResponse = await callGroqAPI(systemPrompt, `Richiesta: ${contesto.richiestaUtente}. Prodotti: ${JSON.stringify(contesto.prodotti)}`, groqApiKey, 0.5, true);
    try {
        return res.status(200).json(JSON.parse(aiResponse));
    } catch(e) {
        return res.status(500).json({ error: "Errore generazione carrelli" });
    }
}

// ==================================================================
// 9. HANDLER PRINCIPALE (ESPOSTO A VERCEL)
// ==================================================================
export default async function handler(req, res) {
    // Configurazione CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).send('OK');

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
            case 'propose_discount_offer':
                return await handleProposeDiscountOffer(req, res, GROQ_API_KEY);
            case 'escalate_to_owner':
                return await handleEscalateToOwner(req, res, GROQ_API_KEY);
            case 'personal_shopper_carrelli':
                return await handlePersonalShopperCarrelli(req, res, GROQ_API_KEY);
            default:
                return res.status(400).json({ error: 'Azione sconosciuta: ' + action });
        }
    } catch (error) {
        console.error("Errore generale nell'handler:", error);
        return res.status(500).json({ error: error.message });
    }
}
