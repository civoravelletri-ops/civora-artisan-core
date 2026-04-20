import admin from 'firebase-admin';

// 1. INIZIALIZZAZIONE FIREBASE
let db = null;
try {
    if (!admin.apps.length) {
        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
        if (!serviceAccount) {
            console.error("🔥 ERRORE: Manca FIREBASE_SERVICE_ACCOUNT_KEY.");
        } else {
            admin.initializeApp({
                credential: admin.credential.cert(JSON.parse(serviceAccount))
            });
        }
    }
    if (admin.apps.length > 0) {
        db = admin.firestore();
    }
} catch (error) {
    console.error("🔥 Errore Init Firebase:", error);
}

// Nota: SMS_GATEWAY_URL e CIVORA_API_BASE_URL non sono più necessari qui,
// perché la logica SMS è stata spostata nella funzione 'civora-otp-sms'.
// Quindi non importiamo più queste variabili qui, ma non creano problemi se ci sono.

export default async function handler(req, res) {
    // Abilita i CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!db) {
        console.error("DB non operativo. Firebase Admin SDK non inizializzato.");
        return res.status(500).json({ error: 'DB non operativo.' });
    }

    try {
        const payload = req.body;
        const GROQ_API_KEY = process.env.GROQ_API_KEY;

        if (!GROQ_API_KEY) {
            throw new Error("GROQ_API_KEY mancante nelle variabili d'ambiente di Vercel");
        }

        const AI_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'; // Assicurati che questo modello sia corretto o usa un fallback.

        // --- SISTEMA DI SMISTAMENTO (ROUTER CHE RISPETTA LA TUA PRIORITÀ) ---
        const action = payload.action || 'giudizio';

        // =====================================================================================
        // AZIONE 1 (PRIORITÀ): IL GIUDIZIO DEL CONCIERGE (IL TUO CODICE ORIGINALE)
        // =====================================================================================
        if (action === 'giudizio') {
            const productData = payload;

            let visualAnalysis = "Nessuna immagine disponibile.";
            const imagesToAnalyze = productData.allImages && productData.allImages.length > 0
                                    ? productData.allImages.slice(0, 3)
                                    : (productData.imageUrl ? [productData.imageUrl] :[]);

            if (imagesToAnalyze.length > 0) {
                try {
                    const visionContent =[
                        { type: 'text', text: "Analizza queste immagini del prodotto (possono essere varianti dello stesso oggetto). Dimmi cosa vedi: colori, materiali, freschezza. Se vedi che è un'opera artigianale o un bouquet, enfatizza la composizione manuale. Se vedi varianti di colore, segnalalo. Questo mi serve per capire se è un pezzo unico o industriale." }
                    ];

                    imagesToAnalyze.forEach(url => {
                        visionContent.push({ type: 'image_url', image_url: { url: url } });
                    });

                    const visionResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${GROQ_API_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: AI_MODEL,
                            messages:[{ role: 'user', content: visionContent }],
                            temperature: 0.2
                        })
                    });
                    const visionData = await visionResponse.json();
                    visualAnalysis = visionData.choices[0]?.message?.content || "Analisi visiva non riuscita.";
                } catch (vErr) {
                    console.error("Errore visione:", vErr);
                    visualAnalysis = "Errore durante l'analisi visiva.";
                }
            }

            const promptSystem = `Sei un "Concierge" esperto, un personal shopper imparziale e onesto.
            REGOLE FONDAMENTALI:
            1. Se l'analisi visiva o i dati indicano un prodotto ARTIGIANALE (fiori, artigianato, cibo), non cercare il Brand. Valuta l'unicità, la freschezza e l'estetica del pezzo unico.
            2. Se è un prodotto INDUSTRIALE, valuta marca e specifiche tecniche.
            3. Sii super onesto: evidenzia pregi e difetti reali (es: stagionalità per i fiori, o vestibilità per abiti).
            4. Il tono deve essere quello di un esperto che ha visto il prodotto e lo commenta per un amico.
            5. Ricorda al cliente che acquistando tramite questo negozio fisico locale ha garanzia di originalità, scontrino e assistenza umana reale.
            6. DEVI RISPONDERE SOLO CON UN OGGETTO JSON VALIDO.

            Formato JSON:
            {
                "summary": "Breve riassunto emozionale e onesto...",
                "pros":["Vantaggio 1", "Vantaggio 2"],
                "cons": ["Svantaggio reale 1"]
            }`;

            const promptUser = `Dati del prodotto:
            - Nome: ${productData.productName}
            - Categoria: ${productData.productCategory}
            - Marca: ${productData.brand || 'Artigianale/Non specificata'}
            - Prezzo: €${productData.price}
            - Descrizione Negoziante: ${productData.shortDescription || productData.productDescription}
            - COSA VEDI NELL'IMMAGINE: ${visualAnalysis}`;

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: AI_MODEL,
                    response_format: { type: "json_object" },
                    messages:[
                        { role: 'system', content: promptSystem },
                        { role: 'user', content: promptUser }
                    ],
                    temperature: 0.7,
                })
            });

            if (!groqResponse.ok) throw new Error(`Errore da Groq: ${await groqResponse.text()}`);

            const data = await groqResponse.json();
            const aiJudgmentJSON = JSON.parse(data.choices[0].message.content);

            return res.status(200).json(aiJudgmentJSON);
        }

        // =====================================================================================
        // AZIONE 2: FORMATTAZIONE REGOLE NEGOZIANTE (IL NUOVO BINARIO 3)
        // =====================================================================================
        else if (action === 'formatta_regole_ai') {
            const { testo_grezzo } = payload; // Estraggo testo_grezzo correttamente

            const promptSystem = `Sei un assistente per negozianti. Il tuo compito è prendere un testo scritto dal negoziante (spesso confuso o in dialetto) che spiega come lui calcola i prezzi dei suoi servizi, e trasformarlo in un elenco puntato HTML chiaro, sintetico e professionale in italiano.
            Regole:
            1. Usa SOLO i tag HTML <ul> e <li>. Nessun altro tag, nessun titolo, nessuna introduzione.
            2. Evidenzia bene se i prezzi sono fissi, al metro, all'ora o extra.
            3. Non inventare prezzi, usa solo quelli forniti.`;

            const promptUser = `Testo del negoziante:\n${testo_grezzo}`;

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: AI_MODEL,
                    messages:[
                        { role: 'system', content: promptSystem },
                        { role: 'user', content: promptUser }
                    ],
                    temperature: 0.3,
                })
            });

            if (!groqResponse.ok) throw new Error(`Errore Groq: ${await groqResponse.text()}`);

            const data = await groqResponse.json();
            const regolePuliteHTML = data.choices[0].message.content;

            return res.status(200).json({ risultato: regolePuliteHTML });
        }

        // =====================================================================================
        // AZIONE 3: CHAT AI CONCIERGE (VENDITA E PREVENTIVI REAL-TIME)
        // =====================================================================================
        else if (action === 'ai_concierge_chat') {
            const { chatHistory, serviceName, vendorName, rawInstructions, serviceDescription } = payload; // Estraggo tutti i campi payload

            const promptSystem = `Sei l'AI Concierge di Civora per il negozio "${vendorName}".
                        Servizio: "${serviceName}".

                        MANUALE PREZZI DA SEGUIRE:
                        ${rawInstructions}

                        ⚠️ REGOLE FONDAMENTALI DI VENDITA (NON SBAGLIARE):
                        1. Tu NON puoi processare pagamenti e NON puoi registrare ordini.
                        2. Il tuo UNICO modo per far procedere il cliente è scrivere il comando: [PRENOTA:valore]
                        3. Quando il cliente è d'accordo sul preventivo, scrivi una frase di conferma e aggiungi SEMPRE il comando [PRENOTA:valore] alla fine del messaggio.
                        4. NON dire mai "Pagamento effettuato". Di' invece che la richiesta verrà inviata al negoziante per la conferma finale.
                        5. Se il cliente dice "Sì", "Ok", "Procediamo" o accetta il prezzo, tu rispondi: "Ottimo! Clicca sul tasto qui sotto per inviare la tua richiesta di prenotazione al negozio. [PRENOTA:valore]"

                        ESEMPIO:
                        Cliente: "Mi va bene 180 euro."
                        Tu: "Perfetto! Clicca pure sul tasto qui sotto per confermare la prenotazione dei 100 inviti. Il negozio riceverà i dettagli e ti contatterà per il pagamento. [PRENOTA:180.00]"

                        6. Parla in italiano elegante e professionale.`;
            const finalMessages = [{ role: 'system', content: promptSystem }];
            const recentHistory = chatHistory.slice(-15);
            recentHistory.forEach(msg => finalMessages.push(msg));

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: AI_MODEL,
                    messages: finalMessages,
                    temperature: 0.5,
                })
            });

            if (!groqResponse.ok) throw new Error(`Errore Groq: ${await groqResponse.text()}`);

            const data = await groqResponse.json();
            const rispostaAI = data.choices[0].message.content;

            return res.status(200).json({ risultato: rispostaAI });
        }
        
        // =====================================================================================
        // AZIONE 4: RIMOSSO il blocco 'invia-sms-negoziante' come richiesto.
        //           Questa logica è ora gestita dalla funzione 'civora-otp-sms'.
        // =====================================================================================

        // =====================================================================================
        // AZIONE 5: SALVATAGGIO PRENOTAZIONE NEL PROFILO NEGOZIANTE (Sistemato l'Errore 500)
        // =====================================================================================
        else if (action === 'salva-prenotazione-ai') {
            // Estraiamo solo i dati che vogliamo salvare nel documento di Firebase
            const { vendorId, chatTranscript, serviceId, serviceName, customerPhone, totalPrice } = payload;

            try {
                // Usiamo l'Admin SDK di Firebase per salvare la prenotazione.
                // Questo è il modo più robusto e corretto quando l'Admin SDK è già inizializzato.
                // Il percorso sarà: collection('vendors') -> doc(vendorId) -> collection('bookings') -> add()
                const bookingsCollectionRef = db.collection('vendors').doc(vendorId).collection('bookings');

                await bookingsCollectionRef.add({
                    serviceId: serviceId,
                    serviceName: serviceName,
                    customerPhone: customerPhone,
                    totalPrice: totalPrice, // Assicurati che totalPrice sia un numero (già gestito dal frontend)
                    chatTranscript: JSON.stringify(chatTranscript), // Salva la chat completa come stringa JSON
                    createdAt: admin.firestore.FieldValue.serverTimestamp(), // Usa il timestamp del server per maggiore precisione
                    status: 'pending-ai-quote', // Nuovo status per le prenotazioni generate da AI
                    type: 'ai_concierge_booking', // Tipo specifico per identificare questa prenotazione AI
                    vendorId: vendorId // Aggiungiamo vendorId anche nel documento di booking per facilitare le query
                    // Puoi aggiungere altri campi di default qui se necessario, es. customerEmail, customerName se li passi
                });

                return res.status(200).json({ success: true, message: 'Prenotazione AI salvata con successo.' });
            } catch (error) {
                console.error("Errore salvataggio prenotazione AI in Firebase:", error);
                // Dettagliamo l'errore per il debug
                return res.status(500).json({ error: 'Errore salvataggio prenotazione AI', details: error.message });
            }
        }

        // Se l'azione non è riconosciuta
        else {
            return res.status(400).json({ error: 'Azione non riconosciuta' });
        }

    } catch (error) {
        console.error("Errore nel Router Civora:", error);
        res.status(500).json({ error: error.message });
    }
}
