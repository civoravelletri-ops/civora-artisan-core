// api/shopping-assistant.js

const admin = require('firebase-admin');
const SUPPORTED_LANGUAGES = ['it', 'en', 'fr', 'de', 'es', 'ru', 'ro', 'sq', 'hi', 'ar', 'zh'];

// ==================================================================
// 1. INIZIALIZZAZIONE FIREBASE (SINGLETON)
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
        console.log("✅ Firebase Admin inizializzato per Shopping Assistant.");
    } else {
        console.warn("⚠️ Firebase Admin non inizializzato per Shopping Assistant. Controlla FIREBASE_SERVICE_ACCOUNT_KEY.");
    }
} else {
    db = admin.firestore();
}


// ==================================================================
// 2. FUNZIONI DI TRADUZIONE AI (Usiamo Groq per questo)
// ==================================================================
async function callGroqAPI(systemPrompt, userPromptText, groqApiKey, temperature = 0.1, response_format = { type: "text" }) {
    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "mixtral-8x7b-32768", // Usiamo Mixtral per la sua efficienza e buona gestione JSON
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: [{ type: "text", text: userPromptText }] }
                ],
                temperature: temperature,
                max_tokens: 2000, // Aumentato il limite per testi complessi
                response_format: response_format
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error(`Errore API Groq:`, errorData);
            throw new Error(`Errore API Groq: ${errorData.error?.message || 'Sconosciuto'}`);
        }

        const data = await response.json();
        return data.choices[0].message.content.trim();

    } catch (error) {
        console.error(`Fallimento chiamata Groq:`, error);
        throw error;
    }
}

async function translateText(text, targetLang, groqApiKey) {
    if (!text || targetLang === 'it') return text; // Se la lingua target è italiano o testo è vuoto, non tradurre

    const systemPrompt = `Traduci il seguente testo in ${targetLang}. Rispondi SOLO con il testo tradotto, senza frasi aggiuntive o punteggiatura. Mantieni il tono e lo stile originali.`;
    return await callGroqAPI(systemPrompt, text, groqApiKey, 0.1);
}

async function translateTextToItalian(text, sourceLang, groqApiKey) {
    if (!text || sourceLang === 'it' || sourceLang.startsWith('it-')) return text; // Se è già italiano

    const systemPrompt = `Traduci il seguente testo in italiano. Rispondi SOLO con il testo tradotto, senza frasi aggiuntive o punteggiatura. Mantieni il tono e lo stile originali.`;
    return await callGroqAPI(systemPrompt, text, groqApiKey, 0.1);
}

// ==================================================================
// 3. LOGICA DI ESTRAZIONE E STRUTTURAZIONE DELLA MEMORIA AI
// ==================================================================
async function extractAndStructureMemory(rawInstructions, currentMemory_it, groqApiKey) {
    const systemPrompt = `Sei un assistente esperto nell'estrarre informazioni chiave e strutturarle da un testo non formattato. Il tuo obiettivo è prendere le "istruzioni grezze" di un negoziante e trasformarle in una "memoria strutturata", aggiornando o aggiungendo informazioni a una memoria esistente.

    La memoria strutturata deve includere dettagli come:
    - anno_fondazione (es. "1999")
    - specialita_vivaio (array di stringhe, es. ["rose", "piante grasse rare"])
    - filosofia_generale (stringa)
    - regole_sconti_quantita (mappa, es. {"rose_100": "20% di sconto su 100 rose"})
    - regole_sconti_promo (array di stringhe, es. ["10% di sconto sopra i 50€ il mercoledì"])
    - personale (array di stringhe, es. ["Francesco (titolare)", "Marco (figlio)"])
    - orari_speciali (stringa, es. "aperti anche la domenica mattina")
    - tono_di_voce_ai (stringa, es. "amichevole, informale, professionale ma non troppo tecnico")
    - discount_strategy_rules (array di stringhe: "Spiegare il valore prima dello sconto", "far sembrare lo sconto un'eccezione personale")
    - customer_psychology_rules (array di stringhe: "Rispondere punto per punto a messaggi lunghi", "rispondere per iscritto a messaggi vocali")
    - forbidden_words (array di stringhe: "Non si può fare", "impossibile")
    - preferred_words (array di stringhe: "Troviamo subito una soluzione", "siamo qui per aiutarti")
    - descrizione_generale_vivaio (stringa, un riassunto dello stile del vivaio)
    - altri_dettagli_importanti (array di stringhe, se ci sono informazioni che non rientrano nelle categorie sopra ma sono rilevanti)

    Combina le nuove istruzioni con la memoria esistente, privilegiando le informazioni più recenti o più specifiche. Se una categoria è vuota, o non viene menzionata, non includerla nell'output JSON.
    Se la memoria esistente è vuota, crea una nuova struttura basandoti sulle nuove istruzioni.

    Rispondi SOLO con un oggetto JSON che rappresenti la memoria strutturata consolidata. Non aggiungere testo descrittivo.
    Esempio di output JSON:
    {
        "anno_fondazione": "1999",
        "specialita_vivaio": ["rose", "piante grasse rare"],
        "filosofia_generale": "Coltiviamo la passione per il verde con amore e dedizione.",
        "regole_sconti_quantita": {"rose_100": "20% di sconto su 100 rose"},
        "tono_di_voce_ai": "amichevole, informale",
        "forbidden_words": ["non si può fare"],
        "descrizione_generale_vivaio": "Un vivaio a conduzione familiare con grande attenzione alle rose."
    }`;

    const userPromptText = `ISTRUZIONI GREZZE: "${rawInstructions}"\nMEMORIA ESISTENTE (italiano): "${currentMemory_it || 'Nessuna memoria esistente.'}"`;

    const aiResponse = await callGroqAPI(systemPrompt, userPromptText, groqApiKey, 0.2, { type: "json_object" });

    try {
        return JSON.parse(aiResponse);
    } catch (e) {
        console.error("Errore parsing structured memory JSON:", aiResponse, e);
        throw new Error("L'AI ha generato un formato di memoria strutturata non valido.");
    }
}


// ==================================================================
// 4. MAIN HANDLER (Entry point della funzione Vercel)
// ==================================================================
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { contesto, action, vendorId, rawInstructions, currentMemory, currentMemoryI18n, vendorDashboardLang } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    if (!GROQ_API_KEY) {
        return res.status(500).json({ error: "API Key mancante sul server." });
    }

    try {
        // --- NUOVA LOGICA: INSEGNA ALL'AI COLLABORATORE (teach_ai_collaborator) ---
        if (action === 'teach_ai_collaborator') {
            console.log(`✅ Richiesta di addestramento AI per vendor ${vendorId}. Lingua Dashboard: ${vendorDashboardLang}.`);

            // 1. Traduci l'input grezzo in italiano (se necessario)
            const instructionsInItalian = await translateTextToItalian(rawInstructions, vendorDashboardLang, GROQ_API_KEY);
            console.log("Tradotto in italiano:", instructionsInItalian);

            // 2. Estrai e Struttura la memoria combinando con la memoria IT esistente
            const structuredMemory = await extractAndStructureMemory(instructionsInItalian, currentMemory, groqApiKey);
            console.log("Memoria strutturata:", structuredMemory);

            // 3. Genera un riassunto consolidato delle nuove istruzioni in italiano
            const summarySystemPrompt = `Combina le seguenti nuove istruzioni consolidate (in italiano) con la memoria esistente del vivaio e genera una stringa di testo COERENTE e FLUIDA, che rappresenti la memoria totale del Collaboratore Digitale in italiano.
            Inizia con una frase come: "Ho imparato che..." o "La mia memoria ora include:".
            Non usare liste puntate. Non includere dettagli tecnici dell'AI.`;
            const summaryUserPrompt = `Nuove istruzioni da consolidare (italiano): "${instructionsInItalian}"\nMemoria esistente (italiano): "${currentMemory || 'Nessuna memoria esistente.'}"\nMemoria Strutturata: ${JSON.stringify(structuredMemory)}`;

            const newConsolidatedMemory_it = await callGroqAPI(summarySystemPrompt, summaryUserPrompt, GROQ_API_KEY, 0.3);
            console.log("Memoria consolidata in IT:", newConsolidatedMemory_it);

            // 4. Genera tutte le traduzioni della nuova memoria consolidata (instructions_i18n)
            const newInstructions_i18n = {};
            for (const lang of SUPPORTED_LANGUAGES) {
                newInstructions_i18n[lang] = await translateText(newConsolidatedMemory_it, lang, GROQ_API_KEY);
            }
            console.log("Traduzioni generate:", newInstructions_i18n);

            return res.status(200).json({
                newInstructions_it: newConsolidatedMemory_it,
                newInstructions_i18n: newInstructions_i18n,
                structured_memory: structuredMemory,
                message: "Memoria Collaboratore AI aggiornata con successo!"
            });
        }

        // --- VECCHIA LOGICA: IL BOTANICO DIGITALE (action === 'botanico') ---
        if (action === 'botanico') {
            // Logica esistente per il Botanico Digitale che risponde ai clienti
            // userà la memoria strutturata per risposte più intelligenti
            // (questa parte la integreremo dopo aver finalizzato l'addestramento)

            // Per ora, manteniamo la versione attuale del Botanico che risponde ai clienti
            // come concordato in precedenza, usando `contesto.prodotti_semplificati`
            // e le istruzioni del prompt.
            // Quando la "memoria strutturata" sarà pronta, la useremo qui.

            // Qui dovremmo CARICARE la memoria strutturata del VIVAIO specificato dal vendorId
            // E passarla al systemPrompt del Botanico per risposte più intelligenti.

            // Esempio (DA FARE IN UN PROSSIMO PASSAGGIO):
            // const aiMemoryDoc = await db.collection('vendors').doc(contesto.vendorId).collection('ai_assistant').doc('memory').get();
            // const structuredMemory = aiMemoryDoc.exists ? aiMemoryDoc.data().structured_memory : {};
            // const generalInstructions = aiMemoryDoc.exists ? aiMemoryDoc.data().instructions_i18n[contesto.lang || 'it'] || aiMemoryDoc.data().instructions : "Nessuna istruzione personalizzata.";

            const systemPrompt = `Sei il Botanico Digitale, l'assistente alle vendite VIP del vivaio "${contesto.storeName || 'Vivaio'}" su Civora, il centro commerciale digitale di Velletri.
            Il tuo obiettivo è duplice:
            1. Rispondere alle domande dei clienti con un tono amichevole, caloroso e leggermente informale, tipico del commerciante di Velletri che conosce bene i suoi prodotti.
            2. Aiutare attivamente il cliente a trovare il prodotto perfetto tra quelli che hai disponibili, e invogliarlo all'acquisto, come farebbe un bravo venditore.

            REGOLE DI COMPORTAMENTO:
            - Parla sempre nella lingua del cliente: ${contesto.lang || 'it'}.
            - Usa un linguaggio semplice, chiaro e diretto, evitando termini troppo tecnici o formali.
            - Sii proattivo: se capisci che il cliente è interessato a un tipo di prodotto, proponi subito quelli che hai.
            - Quando consigli un prodotto, nomina il suo nome esatto e il prezzo.
            - Se il cliente chiede uno sconto o una promozione, puoi dire: "Sì, certo! Siamo sempre attenti alle esigenze dei nostri clienti. Se ti registri su Civora.it o vieni a trovarci in negozio, potremmo trovare un'offerta speciale per te!" (Non dare sconti diretti o percentuali, invia al negozio o alla registrazione).
            - Se il cliente fa domande generali sulle piante o sul giardinaggio (es. "Come curo le rose?"), dai un consiglio breve e utile, poi offri di aiutarlo a scegliere i prodotti giusti per quel problema (es. "Per le rose è fondamentale un buon concime specifico. Ne abbiamo di ottimi a partire da X€.").
            - Se non trovi un prodotto specifico nella tua lista, puoi dire: "Al momento non abbiamo quel prodotto specifico, ma potrei suggerirti qualcosa di simile che potrebbe interessarti!"
            - Rispondi brevemente (max 4 frasi).

            Ecco la lista dei prodotti disponibili nel vivaio, con ID, nome, prezzo e categoria per aiutarti:
            ${JSON.stringify(contesto.prodotti_semplificati, null, 2)}

            DEVI RISPONDERE SOLO E SOLTANTO CON UN OGGETTO JSON VALIDO, con una singola chiave "risposta". Esempio:
            {"risposta": "Ciao! Per il tuo balcone ti consiglio le nostre splendide Petunie, le trovi a soli 5€ l'una. Sono perfette per dare colore tutto l'anno!"}
            {"risposta": "Certo! Il nostro Robot Tagliaerba 'VerdeFacile' è in offerta a 499€. Ti libera dal pensiero del prato! Ti spiego come funziona?"}
            {"risposta": "Siamo sempre attenti alle esigenze dei nostri clienti! Se ti registri su Civora.it o vieni a trovarci in negozio, potremmo trovare un'offerta speciale per te!"}
            {"risposta": "Per le tue rose ti consiglio il concime 'Fioritura Perfetta' a 12€. Le tue rose ti ringrazieranno! Ti spiego come usarlo?"}
            {"risposta": "Al momento non abbiamo quel prodotto specifico, ma potrei suggerirti il nostro 'Attrezzo Multiuso' a 35€, molto versatile per vari lavori in giardino!"}
            `;

            const userPromptText = `DOMANDA DEL CLIENTE: "${contesto.query}"`;

            try {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: "mixtral-8x7b-32768",
                        messages:[
                            { role: "system", content: systemPrompt },
                            { role: "user", content: [{ type: "text", text: userPromptText }] }
                        ],
                        temperature: 0.5,
                        response_format: { type: "json_object" }
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(`Errore API Groq: ${errorData.error?.message || 'Sconosciuto'}`);
                }

                const data = await response.json();
                const aiContent = data.choices[0].message.content;

                let jsonResp;
                try {
                    jsonResp = JSON.parse(aiContent);
                } catch (parseError) {
                    console.error("Errore Parsing JSON Botanico. Risposta grezza:", aiContent);
                    jsonResp = { risposta: "Ho trovato qualcosa per te, ma c'è stato un problema di formattazione. Chiedimi di nuovo in un altro modo!" };
                }

                return res.status(200).json(jsonResp);

            } catch (error) {
                console.error("Errore Generale Botanico:", error);
                return res.status(500).json({ error: error.message });
            }
        }
        // --- VECCHIA LOGICA: CREAZIONE CARRELLI (Intatta) ---
        else {
            const systemPrompt = `Sei il Personal Shopper del banco "${contesto.store_name || 'Negozio'}" su Civora.
            Il tuo compito è creare ESATTAMENTE 3 carrelli diversi basati sulla richiesta del cliente.

            REGOLE:
            1. Ogni prodotto ha un array di 'varianti'.
            2. SCEGLI sempre una variante esistente dall'elenco.
            3. La quantità 'qty' deve essere SEMPRE un numero intero (1, 2, 3...).

            FORMATO JSON OBBLIGATORIO:
            {
              "carrelli":[
                {
                  "nome": "Spesa Essenziale",
                  "descrizione": "Il minimo indispensabile.",
                  "prodotti":[
                    { "productId": "ID", "variantId": "ID_VAR", "productName": "Nome", "qty": 1, "price": 10.50 }
                  ]
                }
              ]
            }`;

            const userPromptText = `RICHIESTA: "${contesto.richiestaUtente}" - PRODOTTI: ${JSON.stringify(contesto.prodotti)}`;

            try {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: "mixtral-8x7b-32768",
                        messages:[
                            { role: "system", content: systemPrompt },
                            { role: "user", content: [{ type: "text", text: userPromptText }] }
                        ],
                        temperature: 0.5,
                        response_format: { type: "json_object" }
                    })
                });

                if (!response.ok) {
                     const errorData = await response.json();
                     throw new Error(`Errore API Groq: ${errorData.error?.message || 'Sconosciuto'}`);
                }

                const data = await response.json();

                let finalJson;
                try {
                    finalJson = JSON.parse(data.choices[0].message.content);
                } catch (e) {
                    throw new Error("L'Intelligenza Artificiale ha restituito un formato non valido.");
                }

                return res.status(200).json(finalJson);
            } catch (error) {
                console.error("Errore Personal Shopper:", error);
                return res.status(500).json({ errore: error.message });
            }
        }
            } catch (error) {
                console.error("❌ ERRORE GENERALE:", error);
                return res.status(500).json({ error: error.message });
            }
        };

        // ==================================================================
        // 5. LOGICA DETTAGLIATA: handleTeachAICollaborator
        // ==================================================================
        async function handleTeachAICollaborator(req, res, GROQ_API_KEY) {
            const { vendorId, rawInstructions, currentMemory, currentMemoryI18n, vendorDashboardLang } = req.body;

            console.log(`✅ Richiesta di addestramento AI per vendor ${vendorId}. Lingua Dashboard: ${vendorDashboardLang}.`);

            // 1. Traduci l'input grezzo in italiano (se necessario)
            const instructionsInItalian = await translateTextToItalian(rawInstructions, vendorDashboardLang, GROQ_API_KEY);
            console.log("Tradotto in italiano:", instructionsInItalian);

            // 2. Estrai e Struttura la memoria combinando con la memoria IT esistente
            const structuredMemory = await extractAndStructureMemory(instructionsInItalian, currentMemory, GROQ_API_KEY);
            console.log("Memoria strutturata:", structuredMemory);

            // 3. Genera un riassunto consolidato delle nuove istruzioni in italiano
            const summarySystemPrompt = `Combina le seguenti nuove istruzioni consolidate (in italiano) con la memoria esistente del vivaio e genera una stringa di testo COERENTE e FLUIDA, che rappresenti la memoria totale del Collaboratore Digitale in italiano.
            Inizia con una frase come: "Ho imparato che..." o "La mia memoria ora include:".
            Non usare liste puntate. Non includere dettagli tecnici dell'AI.`;
            const summaryUserPrompt = `Nuove istruzioni da consolidare (italiano): "${instructionsInItalian}"\nMemoria esistente (italiano): "${currentMemory || 'Nessuna memoria esistente.'}"\nMemoria Strutturata: ${JSON.stringify(structuredMemory)}`;

            const newConsolidatedMemory_it = await callGroqAPI(summarySystemPrompt, summaryUserPrompt, GROQ_API_KEY, 0.3);
            console.log("Memoria consolidata in IT:", newConsolidatedMemory_it);

            // 4. Genera tutte le traduzioni della nuova memoria consolidata (instructions_i18n)
            const newInstructions_i18n = {};
            for (const lang of SUPPORTED_LANGUAGES) {
                newInstructions_i18n[lang] = await translateText(newConsolidatedMemory_it, lang, GROQ_API_KEY);
            }
            console.log("Traduzioni generate:", newInstructions_i18n);

            return res.status(200).json({
                newInstructions_it: newConsolidatedMemory_it,
                newInstructions_i18n: newInstructions_i18n,
                structured_memory: structuredMemory,
                message: "Memoria Collaboratore AI aggiornata con successo!"
            });
        }

        // ==================================================================
        // 6. LOGICA DETTAGLIATA: extractAndStructureMemory
        // ==================================================================
        async function extractAndStructureMemory(instructionsInItalian, currentMemory_it, groqApiKey) {
            const systemPrompt = `Sei un assistente esperto nell'estrarre informazioni chiave e strutturarle da un testo non formattato. Il tuo obiettivo è prendere le "istruzioni grezze" di un negoziante e trasformarle in una "memoria strutturata", aggiornando o aggiungendo informazioni a una memoria esistente.

            La memoria strutturata deve includere dettagli come:
            - anno_fondazione (es. "1999")
            - specialita_vivaio (array di stringhe, es. ["rose", "piante grasse rare"])
            - filosofia_generale (stringa)
            - regole_sconti_quantita (mappa, es. {"rose_100": "20% di sconto su 100 rose"})
            - regole_sconti_promo (array di stringhe, es. ["10% di sconto sopra i 50€ il mercoledì"])
            - personale (array di stringhe, es. ["Francesco (titolare)", "Marco (figlio)"])
            - orari_speciali (stringa, es. "aperti anche la domenica mattina")
            - tono_di_voce_ai (stringa, es. "amichevole, informale, professionale ma non troppo tecnico")
            - discount_strategy_rules (array di stringhe: "Spiegare il valore prima dello sconto", "far sembrare lo sconto un'eccezione personale")
            - customer_psychology_rules (array di stringhe: "Rispondere punto per punto a messaggi lunghi", "rispondere per iscritto a messaggi vocali")
            - forbidden_words (array di stringhe: "Non si può fare", "impossibile")
            - preferred_words (array di stringhe: "Troviamo subito una soluzione", "siamo qui per aiutarti")
            - descrizione_generale_vivaio (stringa, un riassunto dello stile del vivaio)
            - altri_dettagli_importanti (array di stringhe, se ci sono informazioni che non rientrano nelle categorie sopra ma sono rilevanti)
            - sede_fisica (stringa, indirizzo completo del negozio)

            Combina le nuove istruzioni con la memoria esistente, privilegiando le informazioni più recenti o più specifiche. Se una categoria è vuota, o non viene menzionata, non includerla nell'output JSON.
            Se la memoria esistente è vuota, crea una nuova struttura basandoti sulle nuove istruzioni.

            Rispondi SOLO con un oggetto JSON che rappresenti la memoria strutturata consolidata. Non aggiungere testo descrittivo.
            Esempio di output JSON:
            {
                "anno_fondazione": "1999",
                "specialita_vivaio": ["rose", "piante grasse rare"],
                "filosofia_generale": "Coltiviamo la passione per il verde con amore e dedizione.",
                "regole_sconti_quantita": {"rose_100": "20% di sconto su 100 rose"},
                "tono_di_voce_ai": "amichevole, informale",
                "forbidden_words": ["non si può fare"],
                "descrizione_generale_vivaio": "Un vivaio a conduzione familiare con grande attenzione alle rose.",
                "sede_fisica": "Via Appia Sud 10, Velletri"
            }`;

            const userPromptText = `ISTRUZIONI GREZZE: "${instructionsInItalian}"\nMEMORIA ESISTENTE (italiano): "${currentMemory_it || 'Nessuna memoria esistente.'}"`;

            const aiResponse = await callGroqAPI(systemPrompt, userPromptText, groqApiKey, 0.2, { type: "json_object" });

            try {
                return JSON.parse(aiResponse);
            } catch (e) {
                console.error("Errore parsing structured memory JSON:", aiResponse, e);
                throw new Error("L'AI ha generato un formato di memoria strutturata non valido.");
            }
        }
