const admin = require('firebase-admin');

// Inizializzazione Firebase Admin per le azioni di salvataggio (Action 5)
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
    });
}

const db = admin.firestore();

module.exports = async function handler(req, res) {

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
    });
}

const db = admin.firestore();

module.exports = async function handler(req, res) {
    // Abilita i CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
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
                // AZIONE 2: IL CERVELLO DELL'ASSISTENTE (ESTRAZIONE DATI E MEMORIA)
                // =====================================================================================
                else if (action === 'formatta_regole_ai') {
                    const { testo_grezzo, memoria_precedente } = payload;

                    const promptSystem = `Sei un analista di dati per negozi. Il tuo compito è AGGIORNARE il cervello di un assistente digitale.
                    Riceverai nuove istruzioni dal negoziante e dovrai unirle a quelle vecchie.

                    DEVI RISPONDERE ESCLUSIVAMENTE CON UN OGGETTO JSON.

                    Campi da estrarre/aggiornare:
                    - store_owner: Nome del titolare.
                    - phone_fixed: Numero di telefono fisso.
                    - whatsapp: Numero WhatsApp.
                    - email_business: Email per i clienti.
                    - compiled_instructions: Tutto il resto delle regole (prezzi, orari, info) formattate in HTML <ul><li> chiaro e professionale.

                    REGOLE:
                    - Se un dato (es. whatsapp) non è presente nel testo nuovo ma c'era nel vecchio, MANTIENI il vecchio.
                    - Se il testo nuovo dà un nuovo numero, SOSTITUISCI il vecchio.
                    - compiled_instructions deve essere un unico blocco HTML che unisce tutto in modo logico.`;

                    const promptUser = `MEMORIA ATTUALE (JSON): ${memoria_precedente || '{}'}\n\nNUOVE ISTRUZIONI: ${testo_grezzo}`;

                    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: AI_MODEL,
                            response_format: { type: "json_object" },
                            messages: [
                                { role: 'system', content: promptSystem },
                                { role: 'user', content: promptUser }
                            ],
                            temperature: 0.2,
                        })
                    });

                    if (!groqResponse.ok) throw new Error(`Errore Groq: ${await groqResponse.text()}`);
                    const data = await groqResponse.json();
                    return res.status(200).json({ risultato: JSON.parse(data.choices[0].message.content) });
                }

                    // =====================================================================================
                                        // AZIONE 3: CHAT AI CONCIERGE (VENDITA E PREVENTIVI REAL-TIME)
                                        // =====================================================================================
                                        else if (action === 'ai_concierge_chat') {
                                            const { chatHistory, serviceName, vendorName, rawInstructions, serviceDescription, isTrisActive, deliveryStrategy } = payload;

                                            // Definiamo il messaggio logistico in base alle impostazioni del profilo del negoziante
                                            let logisticInstructions = "";
                                            if (isTrisActive) {
                                                logisticInstructions = `
                                                ✅ IL MODELLO TRIS È ATTIVO PER QUESTO NEGOZIO.
                                                Spiega al cliente che può pagare ora e:
                                                - Se è una riparazione: Un Rider passerà a ritirare l'oggetto a casa (Logistica: ${deliveryStrategy}).
                                                - Se sono fotocopie/documenti: Può caricare i file subito dopo il pagamento per trovarli già stampati ed evitare la fila.
                                                - Specifica che la sicurezza del ritiro è garantita da contenitori con lucchetto anti-manomissione.`;
                                            } else {
                                                logisticInstructions = `
                                                ❌ IL MODELLO TRIS NON È ATTIVO.
                                                Informa il cliente che dopo il pagamento dovrà recarsi fisicamente in negozio per consegnare l'oggetto o ritirare il lavoro.`;
                                            }

                                            const promptSystem = `Sei l'AI Concierge di Civora per il negozio "${vendorName}".
                                                        Servizio richiesto: "${serviceName}".

                                                        MANUALE PREZZI E REGOLE DEL NEGOZIO:
                                                        ${rawInstructions}

                                                        ISTRUZIONI LOGISTICHE DA COMUNICARE:
                                                        ${logisticInstructions}

                                                        ⚠️ REGOLE DI CHIUSURA VENDITA:
                                                        1. Tu NON processi pagamenti. Il tuo compito è convincere il cliente e generare il preventivo finale.
                                                        2. Il tuo UNICO modo per far procedere il cliente al pagamento è scrivere il comando: [PRENOTA:valore]
                                                        3. Quando il cliente accetta il prezzo, spiegagli i vantaggi logistici (TRIS o Salva-fila) e scrivi SEMPRE il comando [PRENOTA:valore] alla fine del messaggio.
                                                        4. NON inventare prezzi. Se non sono nel manuale, chiedi dettagli al cliente per calcolarli.
                                                        5. Usa un tono da "Commesso Esperto": cordiale, rassicurante e professionale.`;

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
                                                // AZIONE 4: INVIO SMS OTP TRAMITE MACRODROID (PONTE SMARTPHONE) - AGGIORNATO CON IL TUO URL
                                                // =====================================================================================
                                                else if (action === 'invia-sms-negoziante') {
                                                    const { phone, otp, vendorName } = payload;

                                                    // Messaggio che riceverà il cliente sul suo cellulare
                                                    const messaggioSms = `Civora: Il tuo codice di conferma per ${vendorName} e' ${otp}`;

                                                    // RECUPERO IL TUO INDIRIZZO MACRODROID DALLE VARIABILI D'AMBIENTE
                                                    const MACRODROID_WEBHOOK_URL = process.env.SMS_GATEWAY_URL;

                                                    if (!MACRODROID_WEBHOOK_URL) {
                                                        console.error("SMS_GATEWAY_URL non configurato nelle variabili d'ambiente di Vercel.");
                                                        return res.status(500).json({ error: 'Configurazione SMS MacroDroid mancante. Controlla le variabili d\'ambiente di Vercel.' });
                                                    }

                                                    try {
                                                        // CHIAMIAMO IL TUO WEBHOOK DI MACRODROID CON I PARAMETRI CORRETTI
                                                        const finalMacroDroidUrl = `${MACRODROID_WEBHOOK_URL}?phone=${encodeURIComponent(phone)}&message=${encodeURIComponent(messaggioSms)}`;

                                                        // Per il debug, possiamo stampare l'URL che viene chiamato (verrà visualizzato nei log di Vercel)
                                                        console.log("Chiamando MacroDroid Webhook:", finalMacroDroidUrl);

                                                        const macroDroidResponse = await fetch(finalMacroDroidUrl);

                                                        if (!macroDroidResponse.ok) {
                                                            // Se MacroDroid non risponde "OK", catturiamo più dettagli sull'errore
                                                            const responseText = await macroDroidResponse.text();
                                                            console.error("MacroDroid Webhook non ha risposto OK:", macroDroidResponse.status, responseText);
                                                            throw new Error(`MacroDroid ha risposto con errore: ${responseText || macroDroidResponse.statusText}`);
                                                        }

                                                        return res.status(200).json({ success: true, message: 'Segnale SMS inviato allo smartphone tramite MacroDroid.' });
                                                    } catch (error) {
                                                        console.error("Errore invio SMS tramite MacroDroid:", error);
                                                        // Dettagliamo l'errore per il frontend
                                                        return res.status(500).json({ error: `Errore invio SMS: ${error.message}` });
                                                    }
                                                }

                                        // =====================================================================================
                                                // AZIONE 5: SALVATAGGIO PRENOTAZIONE NEL PROFILO NEGOZIANTE - AGGIUSTATO PER ERRORE 500
                                                // =====================================================================================
                                                else if (action === 'salva-prenotazione-ai') {
                                                            const { vendorId, chatTranscript, serviceId, serviceName, customerPhone, totalPrice } = payload;
                                                            try {
                                                                const bookingsCollectionRef = db.collection('vendors').doc(vendorId).collection('bookings');

                                                                await bookingsCollectionRef.add({
                                                                    serviceId: serviceId,
                                                                    serviceName: serviceName,
                                                                    customerPhone: customerPhone,
                                                                    totalPrice: parseFloat(totalPrice),
                                                                    chatTranscript: JSON.stringify(chatTranscript),
                                                                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                                                                    status: 'pending-ai-quote',
                                                                    type: 'ai_concierge_booking',
                                                                    vendorId: vendorId
                                                                });

                                                                return res.status(200).json({ success: true, message: 'Prenotazione AI salvata con successo.' });
                                                            } catch (error) {
                                                                console.error("Errore salvataggio prenotazione AI:", error);
                                                                return res.status(500).json({ error: 'Errore salvataggio prenotazione AI', details: error.message });
                                                            }
                                                        }
                                                        else {
                                                            return res.status(400).json({ error: 'Azione non riconosciuta' });
                                                        }

                                                    } catch (error) {
                                                        console.error("Errore nel Router Civora:", error);
                                                        res.status(500).json({ error: error.message });
                                                    }
                                                };
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
