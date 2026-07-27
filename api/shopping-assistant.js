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
// 4. LOGICA CLIENTE (Il tuo Vivaista / Specchio del Titolare)
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

    let aiResponse;

    if (contesto.imageUrl && (contesto.imageUrl.startsWith("data:image") || contesto.imageUrl.startsWith("http"))) {
        // Se l'utente ha inviato un'immagine, usiamo il nuovo e potentissimo Llama 4 Scout di Groq con supporto Vision
        try {
            // Per evitare errori 400 di Groq, uniamo le istruzioni di sistema direttamente nel testo dell'utente!
            const promptUnito = `${systemPrompt}\n\nDOMANDA CLIENTE DA RISPONDERE: ${contesto.query || "Ciao, guarda la foto del mio balcone o giardino."}`;

            const visionResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: "meta-llama/llama-4-scout-17b-16e-instruct",
                    messages: [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: promptUnito },
                                { type: "image_url", image_url: { url: contesto.imageUrl } }
                            ]
                        }
                    ],
                    temperature: 0.5,
                    response_format: { type: "json_object" }
                })
            });

            if (!visionResponse.ok) {
                const err = await visionResponse.json();
                throw new Error(err.error?.message || "Errore Vision API");
            }
            const visionData = await visionResponse.json();
            aiResponse = visionData.choices[0].message.content.trim();
        } catch (visionError) {
            console.error("Errore chiamata Vision, eseguo il fallback a testo standard:", visionError);
            // Fallback su testo standard con Llama-3.3-70b se la chiamata immagine fallisce per sicurezza
            aiResponse = await callGroqAPI(systemPrompt, contesto.query || "Ciao, ti ho mandato una foto ma c'è stato un problema di caricamento.", groqApiKey, 0.7, true);
        }
    } else {
        // Chiamata testo standard classica (Llama-3.3-70b)
        aiResponse = await callGroqAPI(systemPrompt, contesto.query, groqApiKey, 0.7, true);
    }

    try {
        return res.status(200).json(JSON.parse(aiResponse));
    } catch (e) {
        console.error("Errore parsing AI response in handleBotanicoClient:", e, "Raw AI Response:", aiResponse);
        return res.status(200).json({ action: "risposta_normale", message: "Scusami, ho avuto un piccolo problema tecnico nel caricare l'immagine o il testo. Puoi ripetere?", conversation_summary_for_owner: contesto.previousConversationSummary });
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
// 6. LOGICA ESCALATION AL PROPRIETARIO (Corretta)
// ==================================================================
async function handleEscalateToOwner(req, res, groqApiKey) {
    const data = req.body.contesto || req.body;
    const { vendorId, customerUserId, customerName, customerPhone, conversationSummary, additionalNotes, requestId } = data;

    try {
        if (!vendorId) throw new Error("ID Venditore mancante");

        if (requestId) {
            // Aggiunta note opzionali: percorso corretto
            await db.collection('vendors').doc(vendorId).collection('owner_contact_requests').doc(requestId).update({
                additionalNotes: additionalNotes || '',
                request_updated_at: admin.firestore.FieldValue.serverTimestamp()
            });
            return res.status(200).json({
                action: "aggiungi_note_contatto",
                message_to_customer: "Perfetto, ho aggiunto le tue note! Il titolare ha ora tutti i dettagli. A presto!"
            });
        } else {
            // Creazione nuova richiesta: percorso corretto
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
    const systemPrompt = `Sei un Personal Shopper intelligente ed amichevole di alimentari per il negozio "${contesto.store_name}".
    Il tuo obiettivo è consigliare il cliente e guidarlo nella spesa.

    ANALIZZA LA RICHIESTA DELL'UTENTE:
    - Se l'utente scrive solo un saluto generico (es. "ciao", "salve", "buongiorno", "chi sei?") o un testo troppo corto/incomprensibile per creare dei carrelli, devi solo rispondergli in modo caloroso ed amichevole presentandoti e guidandolo su cosa può chiederti (es. chiedigli amichevolmente per quante persone è la cena, se preferiscono carne/pesce/veggie o se hanno intolleranze). In questo caso, lascia l'array "carrelli" completamente VUOTO [].
    - Se l'utente esprime un'esigenza reale di spesa (es. "cena per due", "voglio del pesce", "siamo vegetariani"), crea esattamente 3 diverse proposte di carrelli della spesa basandoti sui prodotti realmente disponibili nel negozio.

    REQUISITI DI RISPOSTA:
    Devi rispondere ESCLUSIVAMENTE con un oggetto JSON valido. Non aggiungere alcuna spiegazione, introduzione o testo aggiuntivo fuori dal JSON.

    STRUTTURA JSON RICHIESTA (RISPETTA RIGOROSAMENTE QUESTE ETICHETTE CHIAVE):
    {
      "messaggioConversazione": "Un testo discorsivo amichevole in italiano dove saluti il cliente presentandoti (se scrive solo 'ciao'), oppure una breve introduzione calorosa in cui spieghi i 3 carrelli proposti.",
      "carrelli": [
        // Compila questo array con ESATTAMENTE 3 carrelli SOLO se c'è una richiesta di spesa reale.
        // Se l'utente ha solo salutato o fatto domande generiche, lascia questo array completamente vuoto []
        {
          "nome": "Nome accattivante della proposta in italiano (es. Grigliata Rustica, Spesa Energetica)",
          "descrizione": "Una breve e invitante spiegazione in italiano del perché hai consigliato questo carrello",
          "prodotti": [
            {
              "productId": "ID esatto del prodotto preso dal catalogo",
              "productName": "Nome esatto del prodotto preso dal catalogo",
              "qty": 1,
              "price": 3.50,
              "variantId": "ID esatto della variante se presente, altrimenti lascialo vuoto o omettilo"
            }
          ]
        }
      ]
    }`;
    const aiResponse = await callGroqAPI(systemPrompt, `Richiesta Utente: "${contesto.richiestaUtente}". Prodotti del Negozio: ${JSON.stringify(contesto.prodotti)}`, groqApiKey, 0.5, true);
    try {
        return res.status(200).json(JSON.parse(aiResponse));
    } catch(e) {
        console.error("Errore parsing JSON in personal shopper:", e, "Risposta grezza:", aiResponse);
        return res.status(500).json({ error: "Errore generazione carrelli" });
    }
}

// ==================================================================
// 9. HANDLER PRINCIPALE (ESPOSTO A VERCEL)
// ==================================================================
export default async function handler(req, res) {
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
            case 'teach_ai_collaborator': return await handleTeachAICollaborator(req, res, GROQ_API_KEY);
            case 'sync_vendor_inventory': return await handleSyncInventory(req, res, GROQ_API_KEY);
            case 'botanico': return await handleBotanicoClient(req, res, GROQ_API_KEY);
            case 'propose_discount_offer': return await handleProposeDiscountOffer(req, res, GROQ_API_KEY);
            case 'escalate_to_owner': return await handleEscalateToOwner(req, res, GROQ_API_KEY);
            case 'personal_shopper_carrelli': return await handlePersonalShopperCarrelli(req, res, GROQ_API_KEY);
            default: return res.status(400).json({ error: 'Azione sconosciuta: ' + action });
        }
    } catch (error) {
        console.error("Errore generale nell'handler:", error);
        return res.status(500).json({ error: error.message });
    }
}
