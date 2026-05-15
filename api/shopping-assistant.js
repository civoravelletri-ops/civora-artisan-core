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
        REGOLE: Rispondi SOLO con JSON.
        Campi:
        - anno_fondazione (stringa, l'anno di fondazione del vivaio, es. "1982")
        - specialita_vivaio (array di stringhe, le specialitÃ  del vivaio, es. ["rose antiche", "piante grasse"])
        - filosofia_generale (stringa, la filosofia del negozio, es. "coltiviamo con amore e passione")
        - regole_sconti_quantita (array di oggetti con: min_qty (numero), percentage (numero), description (stringa), es. [{"min_qty": 100, "percentage": 20, "description": "sconto del 20% su 100 rose"}])
        - personale (array di stringhe, nomi e ruoli chiave, es. ["Marco (esperto di bonsai)", "Giulia (responsabile consegne)"])
        - orari_speciali (stringa, descrizione di orari particolari o festivitÃ )
        - tono_di_voce_ai (stringa, lo stile di comunicazione dell'AI, es. "familiare e cordiale", "professionale e diretto")
        - discount_strategy_rules (array di stringhe, regole generali per gli sconti)
        - customer_psychology_rules (array di stringhe, regole su come trattare i clienti)
        - forbidden_words (array di stringhe, parole che l'AI non deve usare)
        - preferred_words (array di stringhe, parole che l'AI dovrebbe preferire)
        - descrizione_generale_vivaio (stringa, un riassunto generale del vivaio)
        - range_prezzi_display (stringa, un range di prezzi tipico dei prodotti del vivaio, es. "€ 5,00 - € 150,00" se ricavabile, altrimenti "N/D")
        - comprensione_percentuale (numero intero da 0 a 100, una stima di quanto l'AI ha compreso i dettagli forniti, sempre 98 se il testo è ricco di informazioni).`;

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

    const systemPrompt = `Sei il Botanico Digitale di "${contesto.storeName}". Il tuo tono deve essere ${tone || "amichevole e cordiale"}.

        CONTESTO MEMORIA AI: ${JSON.stringify(structuredMemory)}.
        ISTRUZIONI GENERALI DEL NEGOZIO: ${generalInstructions}.
        PRODOTTI DISPONIBILI (nome, prezzo, categoria, quantitÃ ): ${JSON.stringify(contesto.prodotti_semplificati)}.

        REGOLE DI RISPOSTA:
        1. Rispondi SEMPRE in ${contesto.lang || 'it'}.
        2. Se il cliente esprime il desiderio di "parlare con il proprietario", "essere richiamato", "negoziare", o se la sua richiesta va oltre le tue capacitÃ  attuali di gestione (es. ordini enormi per matrimoni con dettagli complessi, richieste molto specifiche e non standard), DEVI proporre l'escalation al proprietario.
        3. Quando proponi l'escalation, DEVI chiedere al cliente di fornire il suo "nome" e "numero di telefono".
        4. Dopo aver ricevuto nome e numero, DEVI chiedere se vuole aggiungere "altre note" per il proprietario.
        5. Se il cliente aggiunge "altre note", DEVI aggiornare il riepilogo della conversazione includendole.
        6. Se il cliente ha un carrello attivo o ha fatto una richiesta specifica che ha generato un'offerta AI (quindi con un "sigillo" in valid_offers), DEVI fare riferimento a quella proposta nel riassunto.
        7. Mantieni le risposte il piÃ¹ concise possibile, rispettando il tono del negozio.
        8. Rispondi SEMPRE e SOLO con un oggetto JSON nel formato:
           {"action": "risposta_normale"|"chiedi_contatto"|"conferma_contatto"|"aggiungi_note_contatto",
            "message": "messaggio al cliente",
            "fields_needed": ["nome", "telefono"] (solo per "chiedi_contatto"),
            "customer_name": "nome del cliente" (se giÃ  estratto o fornito),
            "customer_phone": "telefono del cliente" (se giÃ  estratto o fornito),
            "conversation_summary_for_owner": "riassunto interno della conversazione per il proprietario" (solo per "conferma_contatto" o "aggiungi_note_contatto"),
            "additional_notes_for_owner": "note aggiuntive dal cliente per il proprietario" (solo per "aggiungi_note_contatto")}
        9. NON inventare prezzi o sconti che non siano esplicitamente nelle regole del vivaio o che tu non abbia giÃ  proposto con un "sigillo".

        Il cliente ha giÃ  fornito le seguenti informazioni (se disponibili):
        Nome: ${contesto.customerName || 'N/D'}
        Telefono: ${contesto.customerPhone || 'N/D'}
        Riassunto conversazione precedente: ${contesto.previousConversationSummary || 'Nessuno.'}
        Offerta AI (se presente): ${contesto.activeAiOffer ? JSON.stringify(contesto.activeAiOffer) : 'Nessuna.'}
        `;

        const aiResponse = await callGroqAPI(systemPrompt, contesto.query, groqApiKey, 0.7, true);
        let parsedResponse;
        try {
            parsedResponse = JSON.parse(aiResponse);
            // Assicurati che 'action' sia sempre presente e valido
            if (!parsedResponse.action || !["risposta_normale", "chiedi_contatto", "conferma_contatto", "aggiungi_note_contatto"].includes(parsedResponse.action)) {
                throw new Error("Formato JSON non valido: campo 'action' mancante o non riconosciuto.");
            }
        } catch (e) {
            console.error("Errore parsing risposta AI Botanico:", aiResponse, e);
            return res.status(500).json({
                action: "risposta_normale",
                message: `Mi dispiace, c'è stato un problema tecnico e non riesco a elaborare la tua richiesta in questo momento. Riprova più tardi.`,
                reasoning: `AI response not valid JSON or invalid action: ${aiResponse}`
            });
        }
        return res.status(200).json(parsedResponse);
    }

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

                            case 'propose_discount_offer':
                                return await handleProposeDiscountOffer(req, res, GROQ_API_KEY);

                            case 'escalate_to_owner': // NUOVA AZIONE PER ESCALATION
                                return await handleEscalateToOwner(req, res, GROQ_API_KEY);

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
// 5. LOGICA PROPOSTA SCONTO/TRATTATIVA (Corazzata per il Guardiano)
// ==================================================================
async function handleProposeDiscountOffer(req, res, groqApiKey) {
    const { vendorId, customerUserId, cartItems, customerQuery, lang = 'it' } = req.body;
    let structuredMemory = {};
    let generalInstructions = "";
    let vendorProducts = [];

    if (vendorId) {
        try {
            const aiMemoryDoc = await db.collection('vendors').doc(vendorId).collection('ai_assistant').doc('memory').get();
            if (aiMemoryDoc.exists) {
                const data = aiMemoryDoc.data();
                structuredMemory = data.structured_memory || {};
                generalInstructions = data.instructions_i18n?.[lang] || data.instructions || "";
            }
            // Per il sigillo, assumiamo che i prodotti siano disponibili nel DB, ma per AI diamo una lista semplificata
            const offersSnap = await db.collection('offers').where('vendorId', '==', vendorId).get();
            vendorProducts = offersSnap.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    name: data.productName,
                    price: data.price,
                    category: data.productCategory,
                    quantity_available: data.quantity,
                    quickSyncCode: data.quickSyncCode // Potrebbe essere utile per referenze
                };
            }).filter(p => p.quantity_available > 0);

        } catch (e) {
            console.error("Errore lettura DB per AI offerta:", e);
        }
    }

    const rules = structuredMemory.regole_sconti_quantita || [];
    const discountStrategy = structuredMemory.discount_strategy_rules || [];
    const philosophy = structuredMemory.filosofia_generale || "";
    const tone = structuredMemory.tono_di_voce_ai || "familiare e cordiale";

    const systemPrompt = `Sei un "Guardiano delle Offerte" per il vivaio. Il tuo compito è analizzare la richiesta del cliente e il suo carrello attuale.
    Consulta le regole di sconto del vivaio. Se le condizioni sono soddisfatte, propone un'offerta al cliente.
    Il tuo tono di voce è: ${tone}. La filosofia del vivaio è: ${philosophy}.
    REGOLE DI SCONTO DEL VIVAIO: ${JSON.stringify(rules)}.
    STRATEGIE AGGIUNTIVE: ${JSON.stringify(discountStrategy)}.
    PRODOTTI DISPONIBILI NEL VIVAIO (semplificati): ${JSON.stringify(vendorProducts)}.
    CARRELLO ATTUALE DEL CLIENTE: ${JSON.stringify(cartItems)}.

    DEVI rispondere SOLO con un oggetto JSON.
    Campi dell'oggetto JSON:
    - offer_made (booleano, true se fai un'offerta, false altrimenti)
    - offer_text (stringa, il testo dell'offerta al cliente, es. "Ottima scelta! Per le 100 rose, ti offro uno sconto del 20% e la consegna gratuita. Il totale sarÃ  di €X.XX")
    - suggested_total_price (numero, il prezzo totale suggerito DOPO lo sconto, se offer_made Ã¨ true)
    - discount_percentage_applied (numero, la percentuale di sconto applicata, se offer_made Ã¨ true)
    - original_subtotal (numero, il subtotale prima dello sconto)
    - offer_details (oggetto, con dettagli specifici dell'offerta come "free_shipping": true/false)
    - reasoning (stringa, spiegazione interna del perchÃ© l'offerta è stata fatta, NON mostrare al cliente).

    Se non fai un'offerta, offer_text sarÃ  una risposta amichevole che invita a proseguire o a chiedere altro.`;

    const userPromptText = `Cliente chiede: "${customerQuery}". Analizza il carrello per vedere se si applicano sconti.`;

    const aiResponse = await callGroqAPI(systemPrompt, userPromptText, groqApiKey, 0.2, true);
    let parsedResponse;
    try {
        parsedResponse = JSON.parse(aiResponse);
    } catch (e) {
        console.error("Errore parsing risposta AI per offerta:", aiResponse, e);
        return res.status(500).json({
            offer_made: false,
            offer_text: `Mi dispiace, c'è stato un errore nel calcolare le offerte. Riprova più tardi.`,
            reasoning: `AI response not valid JSON: ${aiResponse}`
        });
    }

    if (parsedResponse.offer_made) {
        // Qui dovremmo idealmente creare il "Sigillo" nel database `validazioni`
        // Per ora, lo facciamo internamente e indichiamo che è una prossima fase di integrazione
        // Il frontend cliente riceverà questa offerta e, se accettata, invierà la richiesta di pagamento
        // Il `agrigarden-payment-intent.js` a quel punto verificherà se esiste un sigillo valido
        console.log("AI ha proposto un'offerta. Servirebbe creare il sigillo qui:", parsedResponse);

        // NUOVA LOGICA: Creazione del "Sigillo" nel database Firestore
        try {
            const timestamp = admin.firestore.FieldValue.serverTimestamp();
            const offerRef = await db.collection('vendors').doc(vendorId).collection('ai_assistant').collection('valid_offers').add({
                vendorId: vendorId,
                customerUserId: customerUserId || 'guest',
                cartItems: cartItems,
                customerQuery: customerQuery,
                offer_made: true,
                suggested_total_price: parsedResponse.suggested_total_price,
                discount_percentage_applied: parsedResponse.discount_percentage_applied,
                original_subtotal: parsedResponse.original_subtotal,
                offer_details: parsedResponse.offer_details,
                offer_created_at: timestamp,
                offer_expires_at: new Date(Date.now() + 3600000), // Offerta valida per 1 ora
                status: 'pending_customer_acceptance',
                reasoning: parsedResponse.reasoning,
                ai_response: parsedResponse
            });
            console.log(`Sigillo offerta creato con ID: ${offerRef.id}`);
            parsedResponse.offer_id = offerRef.id; // Aggiungi l'ID del sigillo alla risposta

        } catch (e) {
            console.error("Errore nella creazione del Sigillo dell'offerta:", e);
            parsedResponse.offer_made = false;
            parsedResponse.offer_text = `Mi dispiace, non sono riuscito a creare il sigillo per l'offerta. Riprova più tardi.`;
            parsedResponse.reasoning = `Errore creazione sigillo: ${e.message}`;
        }
    }

    return res.status(200).json(parsedResponse);
}

// ==================================================================
// 6. LOGICA DI ESCALATION AL PROPRIETARIO
// ==================================================================
async function handleEscalateToOwner(req, res, groqApiKey) {
    const { vendorId, customerUserId, customerName, customerPhone, conversationSummary, additionalNotes, lang = 'it' } = req.body;
    let structuredMemory = {};
    let generalInstructions = "";

    if (vendorId) {
        try {
            const aiMemoryDoc = await db.collection('vendors').doc(vendorId).collection('ai_assistant').doc('memory').get();
            if (aiMemoryDoc.exists) {
                const data = aiMemoryDoc.data();
                structuredMemory = data.structured_memory || {};
                generalInstructions = data.instructions_i18n?.[lang] || data.instructions || "";
            }
        } catch (e) {
            console.error("Errore lettura DB per AI escalation:", e);
        }
    }

    const tone = structuredMemory.tono_di_voce_ai || "familiare e cordiale";

    // Salviamo la richiesta nel database
    try {
        const timestamp = admin.firestore.FieldValue.serverTimestamp();
        const requestRef = await db.collection('vendors').doc(vendorId).collection('ai_assistant').collection('owner_contact_requests').add({
            vendorId: vendorId,
            customerUserId: customerUserId || 'guest',
            customerName: customerName || 'Anonimo',
            customerPhone: customerPhone,
            conversationSummary: conversationSummary,
            additionalNotes: additionalNotes,
            request_created_at: timestamp,
            status: 'pending_contact', // Stato iniziale: in attesa di essere contattato
            lang: lang
        });
        console.log(`Richiesta di contatto proprietario creata con ID: ${requestRef.id}`);

        // Opzionale: notifica il venditore via email/Whatsapp/Telegram che c'è una richiesta
        // Questa parte richiederebbe un'altra Vercel Function per le notifiche, non inclusa qui.
        // Ad esempio: fetch('URL_NOTIFICHE_VENDITORE', { method: 'POST', body: JSON.stringify({ type: 'new_contact_request', requestId: requestRef.id, ...req.body }) });

        // Risposta per il cliente
        const aiResponseText = `Perfetto ${customerName || ''}! Ho inoltrato tutte le informazioni al mio capo. Non preoccuparti, sa già di cosa avete parlato. Ti contatterà al più presto al numero ${customerPhone}. Vuoi aggiungere qualcos'altro da lasciare detto al mio capo prima che ti contatti, oppure posso aiutarti in qualche altra cosa?`;

        return res.status(200).json({
            success: true,
            message_to_customer: aiResponseText,
            request_id: requestRef.id
        });

    } catch (e) {
        console.error("Errore nella creazione della richiesta di contatto proprietario:", e);
        return res.status(500).json({
            success: false,
            message_to_customer: `Mi dispiace, c'è stato un errore e non sono riuscito a inoltrare la tua richiesta. Riprova più tardi.`,
            error: e.message
        });
    }
}

// ==================================================================
// 7. LOGICA SINCRONIZZAZIONE AUTOMATICA (RIASSUNTO CATALOGO E PROFILO)
// ==================================================================
async function handleSyncInventory(req, res, groqApiKey) {
    const { vendorData, products, currentMemory } = req.body;

const systemPrompt = `Sei un esperto analista di business. Riceverai i dati di un negozio e la lista dei suoi prodotti.
    Il tuo compito Ã¨ creare un "Manuale di Conoscenza" per l'assistente AI del negozio.
    DEVI strutturare la risposta in JSON con:
    1. newInstructions_it: Un testo fluido in italiano che riassume chi Ã¨ il negozio, i suoi orari di apertura, l'indirizzo, il tipo di prodotti che vende (diviso per categorie o tipi principali), e le sue specializzazioni.
    2. structured_memory: Un oggetto JSON con i seguenti campi chiave estratti dal contesto:
       - orari (stringa, riassunto degli orari di apertura, es. "Dal lunedÃ¬ al sabato 9:00-13:00 e 15:00-19:00")
       - categorie_principali (array di stringhe, le categorie di prodotti piÃ¹ vendute o importanti, es. ["Piante da esterno", "Macchinari"])
       - range_prezzi_display (stringa, un range di prezzi tipico dei prodotti offerti, es. "€ 5,00 - € 150,00" se ricavabile dai prodotti, altrimenti "N/D")
       - comprensione_percentuale (numero intero da 0 a 100, una stima di quanto l'AI ha compreso i dettagli forniti, sempre 98 se il testo Ã¨ ricco di informazioni)
       - anno_fondazione (stringa, l'anno di fondazione del vivaio, se disponibile)
       - descrizione_generale_vivaio (stringa, un riassunto conciso del vivaio)
    3. newInstructions_i18n: Le traduzioni del testo fluido 'newInstructions_it' nelle lingue supportate.

    Sii professionale, preciso e invitante. Se il range prezzi non Ã¨ chiaramente desumibile, usa "N/D".`;

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
