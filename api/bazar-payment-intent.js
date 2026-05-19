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

    try {
        const payload = req.body;
        const GROQ_API_KEY = process.env.GROQ_API_KEY;

        if (!GROQ_API_KEY) {
            throw new Error("GROQ_API_KEY mancante nelle variabili d'ambiente di Vercel");
        }

        const AI_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

        // --- SISTEMA DI SMISTAMENTO (ROUTER CHE RISPETTA LA TUA PRIORITÀ) ---
        // La tua funzione originale è la priorità (se non c'è una "action" specifica)
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
            const promptSystem = `Sei un assistente per negozianti. Il tuo compito è prendere un testo scritto dal negoziante (spesso confuso o in dialetto) che spiega come lui calcola i prezzi dei suoi servizi, e trasformarlo in un elenco puntato HTML chiaro, sintetico e professionale in italiano.
            Regole:
            1. Usa SOLO i tag HTML <ul> e <li>. Nessun altro tag, nessun titolo, nessuna introduzione.
            2. Evidenzia bene se i prezzi sono fissi, al metro, all'ora o extra.
            3. Non inventare prezzi, usa solo quelli forniti.`;

            const promptUser = `Testo del negoziante:\n${payload.testo_grezzo}`;

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
                                const { chatHistory, serviceName, vendorName, rawInstructions, serviceDescription } = payload;

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
                                                // AZIONE 4: INVIO SMS OTP TRAMITE MACRODROID (COLLEGAMENTO REALE SMARTPHONE CIVORA)
                                                // =====================================================================================
                                                else if (action === 'invia-sms-negoziante') {
                                                    const { phone, otp, vendorName } = payload;

                                                    let numeroPulito = phone.replace(/\s+/g, '');
                                                    if (!numeroPulito.startsWith('+')) numeroPulito = '+39' + numeroPulito;

                                                    const messaggioSms = `Civora: Il tuo codice per ${vendorName} e' ${otp}. Inseriscilo per confermare la prenotazione.`;

                                                    const urlSmsReale = `https://trigger.macrodroid.com/51db87e2-5593-48a5-9df5-a59f5dc9cf07/bazar_sms?phone=${encodeURIComponent(numeroPulito)}&message=${encodeURIComponent(messaggioSms)}`;

                                                    try {
                                                        await fetch(urlSmsReale);
                                                        return res.status(200).json({ success: true });
                                                    } catch (errSms) {
                                                        return res.status(500).json({ error: 'Errore invio segnale SMS' });
                                                    }
                                                }

                                                // =====================================================================================
                                                // AZIONE 5: CALCOLO TOTALE E CREAZIONE PAGAMENTO STRIPE (CALCULATE_AND_PAY)
                                                // =====================================================================================
                                                else if (action === 'CALCULATE_AND_PAY') {
                                                    const { clientClaimedTotal } = payload;
                                                    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

                                                    if (!STRIPE_SECRET_KEY) {
                                                        return res.status(500).json({ error: "Errore: STRIPE_SECRET_KEY mancante su Vercel." });
                                                    }

                                                    try {
                                                        const stripeParams = new URLSearchParams();
                                                        stripeParams.append('amount', clientClaimedTotal.toString());
                                                        stripeParams.append('currency', 'eur');
                                                        stripeParams.append('automatic_payment_methods[enabled]', 'true');

                                                        const stripeReq = await fetch('https://api.stripe.com/v1/payment_intents', {
                                                            method: 'POST',
                                                            headers: {
                                                                'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
                                                                'Content-Type': 'application/x-www-form-urlencoded'
                                                            },
                                                            body: stripeParams
                                                        });

                                                        const stripeRes = await stripeReq.json();

                                                        if (stripeRes.error) {
                                                            return res.status(400).json({ error: stripeRes.error.message });
                                                        }

                                                        return res.status(200).json({
                                                            clientSecret: stripeRes.client_secret
                                                        });

                                                    } catch (err) {
                                                        return res.status(500).json({ error: err.message });
                                                    }
                                                }

                                                // =====================================================================================
                                                        // AZIONE 6: CONFERMA ORDINE E RICEVUTA (FINALIZE_ORDER) - BLINDATO DA SERVER
                                                        // =====================================================================================
                                                        else if (action === 'FINALIZE_ORDER') {
                                                            const { paymentIntentId, vendorId, productId, customerShippingData } = payload;

                                                            try {
                                                                // 1. Caricamento della libreria Admin (se manca, ci dirà esattamente questo)
                                                                let admin;
                                                                try {
                                                                    admin = require('firebase-admin');
                                                                } catch (reqErr) {
                                                                    return res.status(500).json({ error: "ATTENZIONE: Manca la libreria 'firebase-admin' nel progetto Vercel." });
                                                                }

                                                                // 2. Inizializzazione Firebase
                                                                if (!admin.apps.length) {
                                                                    let serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

                                                                    if (!serviceAccountKey) {
                                                                                            return res.status(500).json({ error: "Chiave FIREBASE mancante nelle variabili di Vercel." });
                                                                                        }
                                                                    
                                                                                        let parsedKey;
                                                                                        try {
                                                                                            // Tenta prima il parsing diretto
                                                                                            parsedKey = JSON.parse(serviceAccountKey);
                                                                                        } catch (e1) {
                                                                                            try {
                                                                                                // Se fallisce, prova a decodificare da Base64 e poi a parsare
                                                                                                const decodedKey = Buffer.from(serviceAccountKey, 'base64').toString('utf8');
                                                                                                parsedKey = JSON.parse(decodedKey);
                                                                                            } catch (e2) {
                                                                                                return res.status(500).json({ error: "Il testo della chiave su Vercel non è formattato bene o non è JSON valido: " + e2.message });
                                                                                            }
                                                                                        }
                                                                    
                                                                                        // Sistema i ritorni a capo della chiave privata
                                                                                        if (parsedKey && parsedKey.private_key) {
                                                                                            parsedKey.private_key = parsedKey.private_key.replace(/\\n/g, '\n');
                                                                                        }

                                                                    admin.initializeApp({
                                                                        credential: admin.credential.cert(parsedKey)
                                                                    });
                                                                }

                                                                const db = admin.firestore();

                                                                // 3. Lettura SICURA dei dati reali del prodotto
                                                                const productRef = db.collection('vendors').doc(vendorId).collection('products').doc(productId);
                                                                const productDoc = await productRef.get();

                                                                if (!productDoc.exists) {
                                                                    return res.status(404).json({ error: "Prodotto non trovato nel database." });
                                                                }
                                                                const productData = productDoc.data();

                                                                // 4. Genera numero ordine univoco
                                                                const generatedOrderNumber = "ORD-" + Math.floor(Math.random() * 1000000);

                                                                // 5. Salva l'ordine REALE nella Dashboard (Calcolando i totali internamente)
                                                                const orderData = {
                                                                    status: 'pending',
                                                                    orderNumber: generatedOrderNumber,
                                                                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                                                                    totalAmount: (productData.price || 0) + (productData.deliveryCost || 0),
                                                                    shippingAddress: customerShippingData,
                                                                    cartItems: [{
                                                                        productId: productId,
                                                                        productName: productData.name,
                                                                        price: productData.price,
                                                                        deliveryCost: productData.deliveryCost,
                                                                        imageUrl: (productData.imageUrls && productData.imageUrls.length > 0) ? productData.imageUrls[0] : '',
                                                                        quantity: 1
                                                                    }]
                                                                };

                                                                const orderRef = await db.collection('vendors').doc(vendorId).collection('orders').add(orderData);

                                                                // 6. Metti il prodotto come VENDUTO
                                                                await productRef.update({ status: 'sold' });

                                                                return res.status(200).json({
                                                                    success: true,
                                                                    orderId: orderRef.id,
                                                                    orderNumber: generatedOrderNumber
                                                                });

                                                            } catch (err) {
                                                                console.error("Errore finale Vercel:", err);
                                                                return res.status(500).json({ error: "Errore interno a Vercel: " + err.message });
                                                            }
                                                        }

                                                // Se l'azione non è riconosciuta
                                                else {
                                                    return res.status(400).json({ error: 'Azione non riconosciuta dal sistema.' });
                                                }

    } catch (error) {
        console.error("Errore nel Router Civora:", error);
        res.status(500).json({ error: error.message });
    }
}
