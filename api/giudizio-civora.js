const admin = require('firebase-admin');

module.exports = async function handler(req, res) {
    // 1. Abilita i CORS subito, prima che qualsiasi cosa possa andare storta
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
            throw new Error("GROQ_API_KEY mancante");
        }

        const AI_MODEL = 'meta-llama/llama-3.1-70b-versatile';
        const action = payload.action || 'giudizio';

        // =====================================================================================
        // AZIONE 1: IL GIUDIZIO DEL CONCIERGE (PRODOTTI)
        // =====================================================================================
        if (action === 'giudizio') {
            const productData = payload;
            const promptSystem = `Sei un Concierge esperto. Valuta il prodotto in modo onesto. Rispondi solo in JSON.`;
            const promptUser = `Dati prodotto: ${JSON.stringify(productData)}`;

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: AI_MODEL,
                    response_format: { type: "json_object" },
                    messages:[
                        { role: 'system', content: promptSystem },
                        { role: 'user', content: promptUser }
                    ],
                })
            });
            const data = await groqResponse.json();
            return res.status(200).json(JSON.parse(data.choices[0].message.content));
        }

        // =====================================================================================
        // AZIONE 2: FORMATTA REGOLE AI (ADDESTRAMENTO)
        // =====================================================================================
        else if (action === 'formatta_regole_ai') {
            const { testo_grezzo, memoria_precedente } = payload;
            const promptSystem = `Sei un analista. Estrai owner, telefoni e istruzioni HTML in un JSON.`;
            const promptUser = `MEMORIA: ${memoria_precedente}\nNUOVO TESTO: ${testo_grezzo}`;

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: AI_MODEL,
                    response_format: { type: "json_object" },
                    messages:[
                        { role: 'system', content: promptSystem },
                        { role: 'user', content: promptUser }
                    ],
                })
            });
            const data = await groqResponse.json();
            return res.status(200).json({ risultato: JSON.parse(data.choices[0].message.content) });
        }

        // =====================================================================================
        // AZIONE 3: CHAT AI CONCIERGE (VENDITA E TRIS)
        // =====================================================================================
        else if (action === 'ai_concierge_chat') {
            const { chatHistory, serviceName, vendorName, rawInstructions, isTrisActive, deliveryStrategy } = payload;

            let logisticInstructions = isTrisActive 
                ? `✅ IL MODELLO TRIS È ATTIVO. Spiega che possono pagare ora e:
                   - Se riparazione: Passa il Rider (${deliveryStrategy}).
                   - Se documenti: Caricano i file ora e ritirano senza fila.
                   - Usa [PRENOTA:prezzo] alla fine se accettano.`
                : `❌ TRIS DISATTIVO. Devono venire in negozio dopo il pagamento. Usa[PRENOTA:prezzo] se accettano.`;

            const promptSystem = `Sei l'AI Concierge di "${vendorName}" per "${serviceName}".
            REGOLE PREZZI: ${rawInstructions || "Nessuna regola specifica fornite. Chiedi dettagli."}
            ISTRUZIONI LOGISTICHE: ${logisticInstructions}
            REGOLE: Sii professionale. Se il cliente accetta il preventivo, scrivi[PRENOTA:valore] alla fine del messaggio (es. [PRENOTA:10.50]).`;

            const finalMessages =[{ role: 'system', content: promptSystem }, ...chatHistory.slice(-12)];

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: AI_MODEL, messages: finalMessages, temperature: 0.5 })
            });

            const data = await groqResponse.json();
            return res.status(200).json({ risultato: data.choices[0].message.content });
        }

        // =====================================================================================
        // AZIONE 4: SMS OTP (MACRODROID)
        // =====================================================================================
        else if (action === 'invia-sms-negoziante') {
            const { phone, otp, vendorName } = payload;
            const msg = `Civora: Il tuo codice per ${vendorName} e' ${otp}`;
            const url = `${process.env.SMS_GATEWAY_URL}?phone=${encodeURIComponent(phone)}&message=${encodeURIComponent(msg)}`;
            await fetch(url);
            return res.status(200).json({ success: true });
        }

        // =====================================================================================
        // AZIONE 5: SALVATAGGIO PRENOTAZIONE
        // =====================================================================================
        else if (action === 'salva-prenotazione-ai') {
            const { vendorId, chatTranscript, serviceId, serviceName, customerPhone, totalPrice } = payload;
            
            // Accendiamo Firebase Admin SOLO qui, se necessario
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
            const bookingsRef = db.collection('vendors').doc(vendorId).collection('bookings');

            await bookingsRef.add({
                serviceId: serviceId || "generico", 
                serviceName: serviceName || "Servizio Assistito", 
                customerPhone: customerPhone || "",
                totalPrice: parseFloat(totalPrice),
                chatTranscript: JSON.stringify(chatTranscript),
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                status: 'pending-ai-quote',
                type: 'ai_concierge_booking',
                vendorId: vendorId
            });

            return res.status(200).json({ success: true });
        }

        return res.status(400).json({ error: 'Azione non riconosciuta' });

    } catch (error) {
        console.error("ERRORE SERVER:", error);
        res.status(500).json({ error: error.message });
    }
};
