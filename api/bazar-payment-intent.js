const admin = require('firebase-admin');

// 1. INIZIALIZZAZIONE FIREBASE ADMIN (Dalle tue chiavi Bazar)
if (!admin.apps.length) {
    const firebaseConfig = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
    admin.initializeApp({ credential: admin.credential.cert(firebaseConfig) });
}
const db = admin.firestore();

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
        const action = payload.action || 'giudizio';

        // =====================================================================================
        // AZIONE 1: IL GIUDIZIO DEL CONCIERGE (PRODOTTI FISICI + VISIONE MULTIMODALE)
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
                }
            }

            const promptSystem = `Sei un "Concierge" esperto, un personal shopper imparziale e onesto.
            REGOLE FONDAMENTALI:
            1. Se l'analisi visiva o i dati indicano un prodotto ARTIGIANALE (fiori, artigianato, cibo), non cercare il Brand. Valuta l'unicità, la freschezza e l'estetica del pezzo unico.
            2. Se è un prodotto INDUSTRIALE, valuta marca e specifiche tecniche.
            3. Sii super onesto: evidenzia pregi e difetti reali.
            4. Il tono deve essere quello di un esperto che ha visto il prodotto e lo commenta per un amico.
            5. DEVI RISPONDERE SOLO CON UN OGGETTO JSON VALIDO.

            Formato JSON:
            {
                "summary": "Breve riassunto emozionale e onesto...",
                "pros":["Vantaggio 1", "Vantaggio 2"],
                "cons": ["Svantaggio reale 1"]
            }`;

            const promptUser = `Dati del prodotto:
            - Nome: ${productData.productName}
            - Categoria: ${productData.productCategory}
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

            const data = await groqResponse.json();
            return res.status(200).json(JSON.parse(data.choices[0].message.content));
        }

        // =====================================================================================
        // AZIONE 2: FORMATTAZIONE REGOLE NEGOZIANTE (HTML)
        // =====================================================================================
        else if (action === 'formatta_regole_ai') {
            const promptSystem = `Sei un assistente per negozianti. Prendi il testo del negoziante e trasformalo in un elenco puntato HTML <ul> e <li> chiaro, sintetico e professionale. Non inventare prezzi.`;
            const promptUser = `Testo del negoziante:\n${payload.testo_grezzo}`;

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: AI_MODEL,
                    messages:[{ role: 'system', content: promptSystem }, { role: 'user', content: promptUser }],
                    temperature: 0.3
                })
            });

            const data = await groqResponse.json();
            return res.status(200).json({ risultato: data.choices[0].message.content });
        }

        // =====================================================================================
        // AZIONE 3: CHAT AI CONCIERGE (VENDITA E MEMORIA)
        // =====================================================================================
        else if (action === 'ai_concierge_chat') {
            const { chatHistory, serviceName, vendorName, rawInstructions } = payload;

            const promptSystem = `Sei l'AI Concierge di Civora per il negozio "${vendorName}".
            Servizio: "${serviceName}". REGOLE PREZZI: ${rawInstructions}.

            ⚠️ REGOLE VENDITA:
            1. Quando il cliente accetta il preventivo, scrivi SEMPRE alla fine: [PRENOTA:valore].
            2. NON dire mai "Pagamento effettuato". 
            3. Usa la cronologia per ricordare le scelte del cliente.
            4. Parla in italiano elegante e professionale.`;

            const finalMessages = [{ role: 'system', content: promptSystem }, ...chatHistory.slice(-15)];

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: AI_MODEL,
                    messages: finalMessages,
                    temperature: 0.5
                })
            });

            const data = await groqResponse.json();
            return res.status(200).json({ risultato: data.choices[0].message.content });
        }

        // =====================================================================================
        // AZIONE 4: INVIO SMS OTP TRAMITE MACRODROID (COLLEGAMENTO REALE)
        // =====================================================================================
        else if (action === 'invia-sms-negoziante') {
            const { phone, otp, vendorName } = payload;
            let numeroPulito = phone.replace(/\s+/g, '');
            if (!numeroPulito.startsWith('+')) numeroPulito = '+39' + numeroPulito;

            const messaggioSms = `Civora: Il tuo codice per ${vendorName} e' ${otp}. Inseriscilo per confermare la prenotazione.`;
            const MACRODROID_ID = "51db87e2-5593-48a5-9df5-a59f5dc9cf07";
            const url = `https://trigger.macrodroid.com/${MACRODROID_ID}/bazar_sms?phone=${encodeURIComponent(numeroPulito)}&message=${encodeURIComponent(messaggioSms)}`;

            await fetch(url);
            return res.status(200).json({ success: true });
        }

        // =====================================================================================
        // AZIONE 5: SALVATAGGIO PRENOTAZIONE AI (FIREBASE ADMIN SDK - SICURO)
        // =====================================================================================
        else if (action === 'salva-prenotazione-ai') {
            const { vendorId, ...bookingData } = payload;

            await db.collection('vendors').doc(vendorId).collection('bookings').add({
                serviceId: bookingData.serviceId || "",
                serviceName: bookingData.serviceName || "",
                customerPhone: bookingData.customerPhone || "",
                totalPrice: parseFloat(bookingData.totalPrice) || 0,
                status: "pending_payment",
                type: "ai_chat_booking",
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                chatTranscript: JSON.stringify(bookingData.chatTranscript || [])
            });

            return res.status(200).json({ success: true });
        }

        else {
            return res.status(400).json({ error: 'Azione non riconosciuta' });
        }

    } catch (error) {
        console.error("Errore nel Router Civora:", error);
        res.status(500).json({ error: error.message });
    }
}
