// api/shopping-assistant.js

const admin = require('firebase-admin');
const crypto = require('crypto');
const SUPPORTED_LANGUAGES = ['en', 'fr', 'de', 'es', 'ru', 'ro', 'sq', 'hi', 'ar', 'zh'];

// ==================================================================
// 1. INIZIALIZZAZIONE FIREBASE
// ==================================================================
let db;
if (!admin.apps.length) {
    const firebaseServiceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (firebaseServiceAccountKey) {
        try {
            const firebaseConfig = firebaseServiceAccountKey.trim().startsWith('{')
                ? JSON.parse(firebaseServiceAccountKey)
                : JSON.parse(Buffer.from(firebaseServiceAccountKey, 'base64').toString('utf8'));
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
// 2. MOTORE CORE API: GOOGLE VERTEX AI (Gemini 3.5 Flash-Lite)
//    Zero dipendenze esterne, usa la variabile GOOGLE_CREDENTIALS
// ==================================================================
let cachedGoogleToken = null;
let cachedTokenExpiry = 0;
let cachedProjectId = null;

function base64UrlEncode(input) {
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(JSON.stringify(input));
    return buf.toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

async function getGoogleAccessToken() {
    const nowSec = Math.floor(Date.now() / 1000);
    if (cachedGoogleToken && cachedProjectId && nowSec < (cachedTokenExpiry - 300)) {
        return { token: cachedGoogleToken, projectId: cachedProjectId };
    }

    const rawCreds = process.env.GOOGLE_CREDENTIALS;
    if (!rawCreds) throw new Error('GOOGLE_CREDENTIALS mancante nelle variabili d\'ambiente.');

    const credentials = typeof rawCreds === 'string' && rawCreds.trim().startsWith('{')
        ? JSON.parse(rawCreds)
        : JSON.parse(Buffer.from(rawCreds, 'base64').toString('utf8'));

    const header = base64UrlEncode({ alg: 'RS256', typ: 'JWT' });
    const claimSet = base64UrlEncode({
        iss: credentials.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        exp: nowSec + 3600,
        iat: nowSec
    });

    const unsignedJwt = `${header}.${claimSet}`;
    const privateKey = String(credentials.private_key || '').replace(/\\n/g, '\n');
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsignedJwt);
    const signature = base64UrlEncode(signer.sign(privateKey));
    const jwt = `${unsignedJwt}.${signature}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt
        }).toString()
    });

    if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        throw new Error(`Errore OAuth Google (${tokenRes.status}): ${errText}`);
    }

    const tokenData = await tokenRes.json();
    cachedGoogleToken = tokenData.access_token;
    cachedTokenExpiry = nowSec + (tokenData.expires_in || 3600);
    cachedProjectId = credentials.project_id;

    return { token: cachedGoogleToken, projectId: cachedProjectId };
}

async function buildImagePart(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return null;

    if (imageUrl.startsWith('data:image')) {
        const match = imageUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (match) {
            return { inlineData: { mimeType: match[1], data: match[2] } };
        }
        return null;
    }

    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        try {
            const imgRes = await fetch(imageUrl);
            if (!imgRes.ok) return null;
            const mimeType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
            const buffer = Buffer.from(await imgRes.arrayBuffer());
            return { inlineData: { mimeType, data: buffer.toString('base64') } };
        } catch (e) {
            console.warn('[Gemini Vision] Impossibile scaricare immagine:', e.message);
            return null;
        }
    }

    return null;
}

function parseJsonSafe(rawText) {
    const cleaned = String(rawText || '')
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    return JSON.parse(cleaned);
}

async function callGeminiAPI(systemPrompt, userPromptText, temperature = 0.2, isJson = false, imageUrl = null, retryAttempt = 0) {
    const { token, projectId } = await getGoogleAccessToken();
    const location = 'us-central1';
    const modelId = 'gemini-3.5-flash-lite';
    const url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`;

    const parts = [{ text: String(userPromptText || '') }];
    if (imageUrl) {
        const imgPart = await buildImagePart(imageUrl);
        if (imgPart) parts.push(imgPart);
    }

    const payload = {
        contents: [{ role: 'user', parts }],
        generationConfig: {
            temperature: temperature,
            maxOutputTokens: 8192
        },
        safetySettings: [
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' }
        ]
    };

    if (isJson) {
        payload.generationConfig.responseMimeType = 'application/json';
    }

    if (systemPrompt) {
        payload.systemInstruction = {
            parts: [{ text: systemPrompt }]
        };
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (response.status === 429 && retryAttempt < 2) {
        console.warn(`[Gemini 429 Auto-Retry] Attendo 2s e riprovo (Tentativo ${retryAttempt + 1})...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return callGeminiAPI(systemPrompt, userPromptText, temperature, isJson, imageUrl, retryAttempt + 1);
    }

    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Gemini API Error (${response.status}): ${details}`);
    }

    const data = await response.json();
    return (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

// ==================================================================
// 3. LOGICA ADDESTRAMENTO (Teach AI)
// ==================================================================
async function handleTeachAICollaborator(req, res) {
    const { rawInstructions, currentMemory } = req.body;

    const itPrompt = "Sei un traduttore. Traduci il testo in italiano perfetto. Rispondi SOLO con la traduzione.";
    const instructionsInItalian = await callGeminiAPI(itPrompt, rawInstructions, 0.1, false);

    const structPrompt = `Sei un analista dati. Estrai un oggetto JSON dal testo. REGOLE: Rispondi SOLO con JSON.
        Campi: anno_fondazione, specialita_vivaio (array), filosofia_generale, regole_sconti_quantita (array oggetti), personale (array), orari_speciali, tono_di_voce_ai, discount_strategy_rules (array), customer_psychology_rules (array), forbidden_words (array), preferred_words (array), descrizione_generale_vivaio, range_prezzi_display, comprensione_percentuale.`;

    const structUser = `TESTO NUOVO: "${instructionsInItalian}"\nMEMORIA VECCHIA: "${currentMemory || ''}"`;
    const structResp = await callGeminiAPI(structPrompt, structUser, 0.1, true);

    let structuredMemory;
    try {
        structuredMemory = parseJsonSafe(structResp);
    } catch (e) {
        throw new Error("L'AI non ha risposto con un JSON valido durante l'estrazione dati.");
    }

    const summaryPrompt = "Crea un testo fluido in italiano che riassuma la memoria dell'AI. Inizia con 'Ho imparato che...'";
    const newMemory_it = await callGeminiAPI(summaryPrompt, JSON.stringify(structuredMemory), 0.3, false);

    const translatePrompt = `Traduci in queste lingue: ${SUPPORTED_LANGUAGES.join(', ')}. REGOLE: Rispondi SOLO con un oggetto JSON dove le chiavi sono i codici lingua.`;
    const translateResp = await callGeminiAPI(translatePrompt, newMemory_it, 0.1, true);

    let translations = {};
    try { translations = parseJsonSafe(translateResp); } catch (e) {}

    return res.status(200).json({
        newInstructions_it: newMemory_it,
        newInstructions_i18n: { it: newMemory_it, ...translations },
        structured_memory: structuredMemory
    });
}

// ==================================================================
// 4. LOGICA CLIENTE (Il tuo Vivaista / Specchio del Titolare)
// ==================================================================
async function handleBotanicoClient(req, res) {
    const { contesto } = req.body;
    let structuredMemory = {};
    let generalInstructions = "";

    const vid = contesto.vendorId || contesto.id;
    if (vid && db) {
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
    const systemPrompt = `Sei il proprietario del vivaio "${contesto.storeName}" o il suo fidato capo giardiniere. Parla sempre in prima persona (singolare o plurale). Non presentarti MAI come un robot, assistente virtuale, IA o bot. Devi essere la copia digitale del titolare.

        PROFILO DEL VIVAIO:
        - Nome Vivaio: ${contesto.storeName}
        - Filosofia & Storia: ${structuredMemory.filosofia_generale || "Lavoriamo con passione e rispetto per la natura."}
        - Anno Fondazione: ${structuredMemory.anno_fondazione || "N/D"}
        - Staff del Vivaio: ${JSON.stringify(structuredMemory.personale || [])}
        - Tono di Voce Richiesto: ${tone} (Adotta rigorosamente questo tono amichevole, esperto ed umano).

        ISTRUZIONI GENERALI DEL VIVAIO: ${generalInstructions}
        PRODOTTI DISPONIBILI ONLINE (con ID, nome, prezzo, categoria, stock): ${JSON.stringify(contesto.prodotti_semplificati)}
        CRONOLOGIA CONVERSAZIONE: ${contesto.previousConversationSummary || 'Nessuna cronologia.'}

        REGOLE COMPORTAMENTALI DA SEGUIRE RIGOROSAMENTE ("SONO IO IL TITOLARE"):

        1. DIVIETO ASSOLUTO DI LINGUAGGIO DA MACCHINA:
           - Non dire mai: "In base al mio database", "Ecco i prodotti disponibili", "Come assistente virtuale", "Ho trovato questi risultati per te".
           - Non strutturare mai le risposte con elenchi puntati troppo lunghi, freddi o tabelle rigide. Parla con le mani sporche di terra, con passione, calore ed estrema competenza botanica.

        2. REGOLA DEL FLUSSO DIALOGO CONTINUO (NO LOOP DI BENVENUTO):
           - Esamina con estrema attenzione la "CRONOLOGIA CONVERSAZIONE" prima di rispondere.
           - Se la conversazione è già in corso (l'utente ha già salutato e fatto domande), non devi MAI più dire "Ciao!", "Benvenuto nel vivaio!", né ripresentarti o rifare le domande iniziali.
           - Se l'utente risponde con frasi secche o singole parole (es: "misto", "sì", "no"), non riavviare la conversazione da capo. Comprendi che sta rispondendo alla tua domanda precedente, unisci il contesto e procedi subito a consigliare i prodotti o a fare le 3 proposte d'arredo fiorite.

        3. REGOLA BOTANICA DI FERRO (IL SOLE E L'OMBRA):
           - Quando consigli delle piante per il balcone del cliente, devi verificare tassativamente le sue condizioni di esposizione al sole e incrociarle con le caratteristiche di ciascun prodotto nel database.
           - Se l'utente specifica di avere un balcone sempre al sole (pieno sole, assolato, esposto fino al pomeriggio tardo), non devi MAI consigliare piante che richiedono l'ombra o la mezza ombra (es: l'Impatiens Nuova Guinea Lilla ha come caratteristica l'ombra e non sopporta il sole diretto, quindi hai il DIVIETO ASSOLUTO di consigliarla per balconi al sole).
           - Proponi solo prodotti idonei all'esposizione dichiarata dal cliente (es: se ha il sole, proponi cactus, piante grasse, decespugliatori, gerani, lavanda o plumbago).

        4. RICERCA E PROPOSTA PRODOTTI (CON CONSIGLIO INCROCIATO):
           - Quando il cliente ti chiede un prodotto, cercalo tra i "PRODOTTI DISPONIBILI ONLINE".
           - Se ti chiede lo stock reale, digli chiaramente quanto ne hai a terra (es. "Ne ho solo 5 pezzi qui in serra").
           - Se proponi prodotti, usa sempre e solo questo formato: [PRODOTTO:ID_PRODOTTO|NOME_PRODOTTO].
           - ESEMPIO: "Se cerchi del colore ti consiglio la nostra splendida [PRODOTTO:2fKaEPiaupBja0ybP4SI|Rosa Red Velvet] (ne ho 19 in stock). Per bagnarla ti consiglio anche questo pratico [PRODOTTO:abc123def456ghi789|Innaffiatoio Stocker] da 5 litri."
           - Non limitarti a mandare il link. Aggiungi sempre un consiglio da esperto per l'abbinamento (es. "La dipladenia ama il caldo ma soffre molto i ristagni, quindi abbinala a un terriccio drenante").

        5. SE IL CLIENTE TI INVIA UNA FOTO (CONTESTO VISIONE):
           - Se il cliente ha caricato l'immagine del suo balcone, terrazzo, salotto o giardino, analizzala attentamente.
           - Osserva lo spazio, i colori e i materiali presenti (es. piastrelle grigie, pavimento in legno caldo, muri bianchi, ringhiere nere).
           - Formula 3 PROPOSTE TEMATICHE SARTORIALI basate sull'estetica della foto e sui prodotti del negozio:
             - Proposta 1: "Sinfonia Multicolore" (Energia e fiori colorati ad alto impatto visivo).
             - Proposta 2: "Oasi di Pace Profumata" (Verde rilassante ed erbe aromatiche).
             - Proposta 3: "Emanazione Zen" (Bassa manutenzione, cactus e design pulito).
           - Quando proponi prodotti disponibili, usa sempre e solo questo formato: [PRODOTTO:ID_PRODOTTO|NOME_PRODOTTO].
           - Non spaventare il cliente con i prezzi dei singoli articoli subito. Fai capire che l'effetto d'insieme del pacchetto sarà spettacolare.

        6. LA REGOLA DELL'ORDINE SU MISURA (Se mancano prodotti online):
           - Se il cliente sceglie una delle 3 proposte e vuole acquistarla, ma alcuni articoli di quel pacchetto (piante particolari, vasi artistici) NON sono attualmente caricati nel nostro catalogo online, non dirgli di no e non fargli fare un acquisto standard che escluderebbe i vasi o la terra.
           - Spiegagli con premura che, per fargli avere il pacchetto completo perfetto, creerai un Ordine Personalizzato su Misura direttamente dal tuo pannello!
           - Imposta IMMEDIATAMENTE l'azione "chiedi_contatto" nel JSON.
           - Nel "message", rassicuralo: "Ottima scelta! Visto che alcune piante di questa proposta sono pezzi unici che abbiamo in serra e non sul sito, ti preparo io un Ordine su Misura. Lasciami il tuo nome e numero di telefono: ti invierò subito un link di pagamento sicuro sul cellulare per bloccare tutto il pacchetto completo in un solo clic, e poi ti portiamo tutto a domicilio!"

        7. SCENARIO GRANDI EVENTI, MATRIMONI O ALLESTIMENTI PARTICOLARI:
           - Se il cliente sta organizzando un evento, un matrimonio o vuole qualcosa che non vedi a catalogo, spiegagli con passione che il vivaio ha canali preferenziali per ordinare qualsiasi tipo di fiore o pianta direttamente dai mercati nazionali ed esteri. Offri una consulenza su misura.
           - Attiva IMMEDIATAMENTE l'azione "chiedi_contatto" nel JSON.
           - Nel "message", sii accogliente: spiegagli che per i grandi progetti preferisci parlarne a voce per fare un progetto in 3D e un preventivo sartoriale.

        8. LA REGOLA DEL NEGOZIO FISICO (Se l'online è limitato):
           - Se non trovi un prodotto esatto nel catalogo online, o se lo stock online è esaurito, non dire mai "non lo abbiamo". Spiega che il sito mostra solo una piccola parte delle varietà che abbiamo fisicamente qui in vivaio.
           - Attiva IMMEDIATAMENTE l'azione "chiedi_contatto" nel JSON.
           - Nel "message", rassicuralo: "Quello che vedi online è solo un assaggio delle nostre serre! Ho salvato la tua richiesta, lasciami il tuo numero così vado a controllare fisicamente in vivaio se ne ho altri lotti pronti o ti propongo un'alternativa spettacolare che ho visto stamattina."

        9. REGOLE DI SISTEMA RIGIDE:
           - REQUISITO FONDAMENTALE DI LINGUA: Rispondi ESCLUSIVAMENTE nella lingua richiesta: "${contesto.lang || 'it'}". Anche se il catalogo o le istruzioni sono in italiano, tu devi tradurre ed esprimerti nella lingua del cliente ("${contesto.lang || 'it'}"). Non usare l'italiano se la lingua richiesta è diversa.
           - Aggiorna SEMPRE "conversation_summary_for_owner" con un riassunto dettagliato in italiano di ciò che il cliente desidera. Sarà il promemoria letto dal negoziante.
           - Formato JSON: {"action": "risposta_normale"|"chiedi_contatto"|"conferma_contatto", "message": "...", "customer_name": "...", "customer_phone": "...", "conversation_summary_for_owner": "..."}
        `;

    const hasImage = Boolean(contesto.imageUrl && (contesto.imageUrl.startsWith("data:image") || contesto.imageUrl.startsWith("http")));
    const userPrompt = contesto.query || (hasImage ? "Ciao, guarda la foto del mio balcone o giardino." : "Ciao!");

    let aiResponse;
    try {
        aiResponse = await callGeminiAPI(systemPrompt, userPrompt, hasImage ? 0.5 : 0.7, true, hasImage ? contesto.imageUrl : null);
    } catch (visionErr) {
        if (hasImage) {
            console.error("Errore chiamata Vision Gemini, fallback solo testo:", visionErr);
            aiResponse = await callGeminiAPI(systemPrompt, contesto.query || "Ciao, ti ho mandato una foto ma c'è stato un problema di caricamento.", 0.7, true, null);
        } else {
            throw visionErr;
        }
    }

    try {
        return res.status(200).json(parseJsonSafe(aiResponse));
    } catch (e) {
        console.error("Errore parsing AI response in handleBotanicoClient:", e, "Raw AI Response:", aiResponse);
        return res.status(200).json({ action: "risposta_normale", message: "Scusami, ho avuto un piccolo problema tecnico nel caricare l'immagine o il testo. Puoi ripetere?", conversation_summary_for_owner: contesto.previousConversationSummary });
    }
}

// ==================================================================
// 5. LOGICA PROPOSTA SCONTO (Il Guardiano)
// ==================================================================
async function handleProposeDiscountOffer(req, res) {
    const { vendorId, customerUserId, cartItems, customerQuery } = req.body;
    let structuredMemory = {};
    let vendorProducts = [];

    if (vendorId && db) {
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

    const aiResponse = await callGeminiAPI(systemPrompt, customerQuery, 0.2, true);
    let parsed;
    try { parsed = parseJsonSafe(aiResponse); } catch (e) { return res.status(500).json({ error: "Errore AI" }); }

    if (parsed.offer_made && db) {
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
async function handleEscalateToOwner(req, res) {
    const data = req.body.contesto || req.body;
    const { vendorId, customerUserId, customerName, customerPhone, conversationSummary, additionalNotes, requestId } = data;

    try {
        if (!vendorId) throw new Error("ID Venditore mancante");

        if (requestId) {
            await db.collection('vendors').doc(vendorId).collection('owner_contact_requests').doc(requestId).update({
                additionalNotes: additionalNotes || '',
                request_updated_at: admin.firestore.FieldValue.serverTimestamp()
            });
            return res.status(200).json({
                action: "aggiungi_note_contatto",
                message_to_customer: "Perfetto, ho aggiunto le tue note! Il titolare ha ora tutti i dettagli. A presto!"
            });
        } else {
            const requestRef = await db.collection('vendors').doc(vendorId).collection('owner_contact_requests').add({
                vendorId: vendorId,
                customerUserId: customerUserId || 'guest',
                customerName: customerName || 'Cliente',
                customerPhone: customerPhone || 'N/D',
                conversationSummary: conversationSummary || 'Nessun riassunto',
                additionalNotes: additionalNotes || '',
                request_created_at: admin.firestore.FieldValue.serverTimestamp(),
                status: 'pending_contact'
            });
            return res.status(200).json({
                action: "conferma_contatto",
                message_to_customer: `Grazie ${customerName}! Ho inviato tutto al titolare. Ti chiamerà al più presto al numero ${customerPhone}. Vuoi aggiungere un'ultima nota scritta per lui?`,
                request_id: requestRef.id,
                conversation_summary_for_owner: conversationSummary
            });
        }
    } catch (e) {
        console.error("Errore Salvataggio Contatto:", e);
        return res.status(500).json({ error: e.message });
    }
}

// ==================================================================
// 7. LOGICA SINCRONIZZAZIONE INVENTARIO
// ==================================================================
async function handleSyncInventory(req, res) {
    const { vendorData, products, currentMemory } = req.body;
    const systemPrompt = `Sei un esperto analista. Crea un Manuale di Conoscenza JSON basato su PROFILO e PRODOTTI.
    Campi: newInstructions_it (testo fluido), structured_memory (oggetto con: orari, categorie_principali, range_prezzi_display, comprensione_percentuale).`;

    const userPrompt = `PROFILO: ${JSON.stringify(vendorData)}\nPRODOTTI: ${JSON.stringify(products)}\nMEMORIA: ${currentMemory}`;
    const aiResponse = await callGeminiAPI(systemPrompt, userPrompt, 0.3, true);

    try {
        const parsed = parseJsonSafe(aiResponse);
        const translatePrompt = `Traduci in: en, fr, de, es, ru, ro, sq, hi, ar, zh. Rispondi solo JSON.`;
        const translateResp = await callGeminiAPI(translatePrompt, parsed.newInstructions_it, 0.1, true);
        const translations = parseJsonSafe(translateResp);

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
// 8. LOGICA PERSONAL SHOPPER (CARRELLI) - CHEF & MACELLAIO (CATALOGO COMPLETO)
// ==================================================================
async function handlePersonalShopperCarrelli(req, res) {
    const { contesto } = req.body;

    function convertUnitToGrams(qty, unit) {
        const q = parseFloat(qty) || 0;
        const u = String(unit || '').toLowerCase().trim();
        if (u === 'kg') return Math.round(q * 1000);
        if (u === 'hg') return Math.round(q * 100);
        if (u === 'g') return Math.round(q);
        return null;
    }

    // Invia TUTTI i prodotti disponibili (nessun taglio/slice!), tenendo solo i campi essenziali
    const prodottiLeggeri = (contesto.prodotti || []).map(p => {
        const rawVars = Array.isArray(p.variants) ? p.variants : [];
        const availableVars = rawVars
            .filter(v => v.stock === undefined || v.stock === null || Number(v.stock) > 0)
            .map(v => {
                const grams = convertUnitToGrams(v.quantity, v.unit);
                return {
                    variantId: v.id,
                    formato: `${v.quantity || ''} ${v.unit || ''}`.trim() + (grams ? ` (${grams}g)` : ''),
                    peso_grammi: grams,
                    prezzo: parseFloat(v.price || 0)
                };
            });

        if (rawVars.length > 0 && availableVars.length === 0) {
            return null;
        }
        if (rawVars.length === 0 && p.stock !== undefined && p.stock !== null && Number(p.stock) <= 0) {
            return null;
        }

        const itemObj = {
            id: p.id || p.productId,
            nome: p.name || p.productName || p.title,
            categoria: p.category || p.productCategory || ''
        };

        if (p.famigliaCarne) itemObj.famiglia = p.famigliaCarne;
        if (p.taglio) itemObj.taglio = p.taglio;
        if (p.frollatura) itemObj.frollatura_giorni = p.frollatura;
        if (p.coltivazione) itemObj.coltivazione = p.coltivazione;
        if (p.certificazioni) itemObj.certificazioni = p.certificazioni;
        if (p.preparazionePesce) itemObj.preparazione = p.preparazionePesce;
        if (p.shortDesc) itemObj.note = String(p.shortDesc).slice(0, 90);
        if (p.allergeni) itemObj.allergeni = p.allergeni;

        if (availableVars.length > 0) {
            itemObj.formati = availableVars;
        } else {
            itemObj.formato = p.unit || 'pz';
            itemObj.prezzo = parseFloat(p.price || 0);
        }

        return itemObj;
    }).filter(Boolean);

    const systemPrompt = `Sei un Personal Shopper esperto di gastronomia, macelleria, pescheria e mercato fresco per il negozio "${contesto.store_name}".
    Il tuo obiettivo è consigliare il cliente e comporre spese REALISTICHE, EQUILIBRATE e SENSATE basate sulle porzioni vere.

    REGOLE FONDAMENTALI SULLE QUANTITÀ E SUL PESO (NON SBAGLIARE MAI):
    1. CALCOLA IN GRAMMI A PERSONA, NON A "PEZZI":
       - Carne o Pesce: calcola circa 200g - 300g TOTALI a persona (massimo 350g se è l'unico piatto forte).
       - Contorni / Frutta / Verdura: circa 150g - 250g a persona.
       - Salumi / Formaggi: circa 80g - 120g a persona.
    2. CONTROLLA SEMPRE "formati" E "peso_grammi" PRIMA DI DECIDERE "qty":
       - Se un formato pesa già 500g (0.5 kg) o 1000g (1 kg), NON mettere mai "qty": 2 per 1 o 2 persone!
       - Esempio pratico: se siamo in 2 persone e la confezione pesa 500g, metti "qty": 1 (500g bastano per 2!). Se nel negozio esiste un formato più piccolo (es. 250g o 300g) e ti serve una porzione per 1 sola persona, scegli quel "variantId" piccolo e metti "qty": 1!
       - Se il nome o la nota del prodotto indica già il peso (es. "confezione 500g", "da mezzo kg") e non ha formati piccoli, metti "qty": 1 (MAI "qty": 2 per 1 persona!).
    3. DIVISIONE GUSTI TRA PERSONE (ES. UNO VUOLE POLLO, UNO CARNE ROSSA):
       - Se 2 persone hanno preferenze diverse (es. uno pollo/carne bianca, l'altro carne rossa), scegli 1 porzione da ~250g-350g di pollo per lui e 1 porzione da ~250g-350g di carne rossa per lei. NON raddoppiare entrambi!
       - Se proponi una grigliata mista con 3 tagli diversi per 2 persone, fai in modo che la SOMMA di tutte le carni sia circa 500g - 700g totali, scegliendo i formati più piccoli (200g-300g ciascuno).
    4. RISPETTO DI DIETE, ALLERGENI E RICHIESTE:
       - Controlla i campi "famiglia", "categoria", "note" e "allergeni". Se il cliente dice "senza maiale", escludi Suino/Salsiccia/Pancetta/Norcineria suina. Se chiede carne bianca, guarda "famiglia": "Carni Bianche".
    5. USA SOLO PRODOTTI REALI DELLA LISTA:
       - Usa ESATTAMENTE gli "id" e i "variantId" (se il prodotto ha "formati") presenti nella lista "Prodotti Negozio". Non inventare ID o prezzi.

    ANALIZZA LA RICHIESTA DELL'UTENTE:
    - Se l'utente scrive solo un saluto generico (es. "ciao", "salve", "buongiorno") lascia l'array "carrelli" completamente VUOTO [].
    - Altrimenti, crea esattamente 3 diverse proposte di carrelli (1. Classico/Equilibrato, 2. Selezione Gourmet/Pregiata, 3. Pratico/Leggero o Conveniente) spiegando brevemente le dosi pensate per le persone indicate.

    REQUISITI DI RISPOSTA:
    Rispondi SOLO ed ESCLUSIVAMENTE con un JSON valido con questa struttura:
    {
      "messaggioConversazione": "Testo caloroso e amichevole dove spieghi i 3 menu pensati con le dosi giuste per le persone.",
      "carrelli": [
        {
          "nome": "Nome proposta (es. Grigliata Equilibrata)",
          "descrizione": "Breve spiegazione del menu e del peso totale stimato a persona",
          "prodotti": [
            {
              "productId": "ID esatto del prodotto",
              "variantId": "variantId esatto scelto da formati (oppure null se non ha formati)",
              "productName": "Nome esatto del prodotto",
              "qty": 1,
              "price": 3.50
            }
          ]
        }
      ]
    }`;

    const promptUtente = `Richiesta Utente: "${contesto.richiestaUtente}". Prodotti Negozio: ${JSON.stringify(prodottiLeggeri)}`;
    const aiResponse = await callGeminiAPI(systemPrompt, promptUtente, 0.3, true);

    try {
        return res.status(200).json(parseJsonSafe(aiResponse));
    } catch (e) {
        console.error("Errore parsing JSON in personal shopper:", e, "Risposta grezza:", aiResponse);
        return res.status(500).json({ error: "Errore generazione carrelli" });
    }
}

// ==================================================================
// 9. LOGICA CONSULENTE AI - CURA DELLA PERSONA (Salone / Barbiere / Estetica)
// ==================================================================
async function handleCuraPersonaConsultant(req, res) {
    const { contesto } = req.body;
    if (!contesto) return res.status(400).json({ error: "Contesto mancante" });

    const storeName = contesto.storeName || "il nostro salone";
    const lang = contesto.lang || "it";
    const product = contesto.product || {};
    const query = contesto.query || contesto.richiestaUtente || "Ciao! Vorrei sapere se questo prodotto è adatto a me.";

    const prodDetails = {
        nome: product.productName || product.nome || "",
        marca: product.brand || product.marca || "",
        prezzo: product.price || product.prezzo || "",
        benefici: product.productAttributes || product.benefici || [],
        modo_uso: product.productUsage || product.modo_uso || "",
        ingredienti: product.productIngredients || product.ingredienti || "",
        descrizione: product.productDescription || product.descrizione || product.shortDescription || "",
        formato: product.productNetQuantity || product.formato || "",
        pao: product.productPao || product.pao || ""
    };

    const systemPrompt = `Sei il Consulente Esperto di Bellezza e Cura della Persona del salone "${storeName}".
Parla con calore, professionalità e competenza, come un fidato hair stylist o professionista della cura della persona che sta consigliando un cliente seduto in salone.

REGOLE FONDAMENTALI:
1. PARLA COME UN VERO PROFESSIONISTA:
   - Sii amichevole, chiaro, rassicurante e autorevole.
   - Non presentarti MAI come un'intelligenza artificiale, bot o macchina.
   - Dai consigli personalizzati in base al tipo di capello, pelle o barba menzionati dal cliente.
2. CONOSCI PERFETTAMENTE IL PRODOTTO:
   - Dati del prodotto su cui ti sta chiedendo il cliente:
     ${JSON.stringify(prodDetails)}
   - Spiega con parole semplici perché gli ingredienti o la formula sono efficaci per le sue esigenze.
   - Se il cliente chiede come usarlo, fornisci una routine pratica passo-passo basata sul modo d'uso.
   - Se il cliente chiede se è adatto a una specifica esigenza (es. cute sensibile, capelli ricci, barba dura), rispondi con trasparenza ed onestà basandoti sui benefici e ingredienti.
3. REQUISITO RIGOROSO DI LINGUA:
   - Rispondi ESCLUSIVAMENTE nella lingua del cliente: "${lang}".
4. FORMATO RISPOSTA:
   - Rispondi ESCLUSIVAMENTE con un JSON valido strutturato così:
   {
     "message": "La tua risposta da esperto, calorosa e dettagliata, senza muri di testo ma ben leggibile a paragrafi brevi.",
     "suggestedQuestions": ["Domanda rapida 1 che il cliente potrebbe voler fare", "Domanda rapida 2"]
   }`;

    const userPrompt = `Domanda del cliente: "${query}". Cronologia precedente: "${contesto.history || 'Nessuna'}".`;
    const aiResponse = await callGeminiAPI(systemPrompt, userPrompt, 0.4, true);

    try {
        return res.status(200).json(parseJsonSafe(aiResponse));
    } catch (e) {
        console.error("Errore parsing JSON consulente cura persona:", e, "Risposta grezza:", aiResponse);
        return res.status(200).json({
            message: "Questo prodotto è una formula professionale selezionata con cura per garantire i massimi risultati. Per cosa vorresti utilizzarlo nello specifico?",
            suggestedQuestions: ["Come si applica?", "Va bene per il mio tipo di capello?"]
        });
    }
}

// ==================================================================
// 10. HANDLER PRINCIPALE + PROTEZIONE CREDITI AI (ESPOSTO A VERCEL)
// ==================================================================
const ALLOWED_ORIGINS = [
    'https://localmente-v3-core.web.app',
    'https://localmente-v3-core.firebaseapp.com',
    'https://localmente-site.web.app',
    'https://localmente-site.firebaseapp.com',
    'https://www.civora.it',
    'https://civora.it',
    'capacitor://localhost',
    'ionic://localhost'
];

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 15;

function checkRateLimit(req) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress) || 'unknown';
    const now = Date.now();
    const entry = rateLimitMap.get(ip);

    if (!entry || (now - entry.startTime) > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.set(ip, { count: 1, startTime: now });
        return true;
    }
    if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
        return false;
    }
    entry.count += 1;
    return true;
}

export default async function handler(req, res) {
    const origin = req.headers.origin;
    const host = req.headers.host || '';
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1') || (origin && (origin.includes('localhost') || origin.includes('127.0.0.1')));

    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (isLocal) {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
    } else if (origin && origin !== 'null') {
        return res.status(403).json({ error: 'Accesso non autorizzato da questo dominio.' });
    }

    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).send('OK');

    if (!checkRateLimit(req)) {
        return res.status(429).json({ error: 'Troppe richieste. Attendi qualche secondo prima di riprovare.' });
    }

    if (!process.env.GOOGLE_CREDENTIALS) {
        return res.status(500).json({ error: "GOOGLE_CREDENTIALS mancante su Vercel" });
    }

    try {
        const { action } = req.body;
        switch (action) {
            case 'teach_ai_collaborator': return await handleTeachAICollaborator(req, res);
            case 'sync_vendor_inventory': return await handleSyncInventory(req, res);
            case 'botanico': return await handleBotanicoClient(req, res);
            case 'propose_discount_offer': return await handleProposeDiscountOffer(req, res);
            case 'escalate_to_owner': return await handleEscalateToOwner(req, res);
            case 'personal_shopper_carrelli': return await handlePersonalShopperCarrelli(req, res);
            case 'cura_persona_consultant': return await handleCuraPersonaConsultant(req, res);
            default: return res.status(400).json({ error: 'Azione sconosciuta: ' + action });
        }
    } catch (error) {
        console.error("Errore generale nell'handler:", error);
        return res.status(500).json({ error: error.message });
    }
}

export const config = {
    maxDuration: 60
};
