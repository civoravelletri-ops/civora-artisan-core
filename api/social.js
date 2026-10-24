const admin = require('firebase-admin');

// Inizializzazione diretta di Firebase con la chiave che hai su Vercel
if (!admin.apps.length) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('[Firebase Admin] Inizializzato con successo su social.js');
    } catch (err) {
        console.error('[Firebase Admin Error] Errore inizializzazione:', err.message);
    }
}
const db = admin.firestore();

module.exports = async function handler(req, res) {
    // Permessi CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const body = req.body || {};
        const GROQ_API_KEY = process.env.GROQ_API_KEY;

        if (!GROQ_API_KEY) {
            return res.status(500).json({ errore: "Manca la chiave d'accesso GROQ_API_KEY nelle variabili d'ambiente di Vercel." });
        }

        // =========================================================================
        // 🟢 NUOVO BLOCCO WHATSAPP AUTOPILOT CON BUTTAFUORI INCORRUTTIBILE
        // =========================================================================
        if (body.isWhatsAppAutoPilot && body.vendorId) {
            const vendorId = body.vendorId;
            const senderPhone = body.senderPhone || '';
            const senderJid = body.senderJid || senderPhone;
            const messageText = (body.messageText || "").trim();
            const pushName = (body.pushName || "").trim();

            if (!messageText) {
                return res.status(200).json({ status: "skipped", reason: "Messaggio vuoto" });
            }

            // -------------------------------------------------------------
            // 💂‍♂️ IL BUTTAFUORI INCORRUTTIBILE (Controllo Diretto Firestore)
            // -------------------------------------------------------------
            const vendorDoc = await db.collection('vendors').doc(vendorId).get();
            if (!vendorDoc.exists) {
                console.log(`[Buttafuori] 🛑 Salone ${vendorId} non trovato nel database.`);
                return res.status(200).json({ status: "skipped", reason: "Salone inesistente" });
            }

            const vendorData = vendorDoc.data() || {};
            const isWaConnected = vendorData.whatsapp_connected === true;
            const isAutoPilotOn = vendorData.whatsapp_ai_autopilot === true;

            // Se anche una sola levetta è spenta, chiude la porta all'istante
            if (!isWaConnected || !isAutoPilotOn) {
                console.log(`[Buttafuori] 🛑 Accesso Negato per ${vendorId}. Connesso: ${isWaConnected}, Pilota IA: ${isAutoPilotOn}`);
                return res.status(200).json({ 
                    status: "skipped", 
                    reason: "Pilota automatico o WhatsApp non attivi per questo salone" 
                });
            }

            console.log(`[Buttafuori] 🟢 VIA LIBERA! Salone "${vendorData.store_name || vendorId}" attivo. Elaboro messaggio...`);
            // -------------------------------------------------------------

            // 1. L'Intelligenza Artificiale (Groq - Llama 3.3)
            let aiReply = "Ciao! Ti rispondo subito.";
            const storeName = vendorData.store_name || "il nostro salone";

            try {
                const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${GROQ_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: "llama-3.3-70b-versatile",
                        messages: [
                            { 
                                role: "system", 
                                content: `Sei l'assistente virtuale del salone "${storeName}" su WhatsApp. Rispondi con grande gentilezza, naturalezza e brevità (massimo 2 frasi).` 
                            },
                            { 
                                role: "user", 
                                content: messageText 
                            }
                        ],
                        temperature: 0.5,
                        max_tokens: 250
                    })
                });

                if (groqRes.ok) {
                    const groqData = await groqRes.json();
                    aiReply = groqData.choices?.[0]?.message?.content?.trim() || aiReply;
                }
            } catch (aiErr) {
                console.error("[AutoPilot] Errore risposta Groq:", aiErr.message);
            }

            // 2. Rispedisce la risposta a Render (il Postino)
            const GATEWAY_BASE_URL = (process.env.CIVORA_WHATSAPP_GATEWAY_URL || 'https://civora-whatsapp-gateway.onrender.com').replace(/\/+$/, '');
            
            try {
                await fetch(`${GATEWAY_BASE_URL}/send-message`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        vendorId: vendorId,
                        phone: senderJid || senderPhone,
                        message: aiReply
                    })
                });
                console.log(`[AutoPilot] 🚀 Risposta inviata al cliente con successo!`);
            } catch (sendErr) {
                console.error("[AutoPilot] Errore invio Gateway Render:", sendErr.message);
            }

            return res.status(200).json({ success: true, reply: aiReply });
        }

        // =========================================================================
        // 🔒 BLOCCO COPYWRITER MARKETING PER I POST (INTATTO E SIGILLATO)
        // =========================================================================
        const contesto = body.contesto;
        if (!contesto) {
            return res.status(400).json({ errore: "Dati di contesto mancanti nella richiesta." });
        }

        let systemPrompt = `Sei un Senior Social Media Copywriter da Agenzia di Marketing di Lusso. Crea post magnetici per promuovere servizi e prodotti. Rispondi solo con il testo del post.`;
        let userPromptText = `Dati: Negozio: "${contesto.store_name || 'Salone'}", Servizio: "${contesto.nome || 'Servizio'}", Prezzo: ${contesto.prezzo || '0'}€, Link: ${contesto.link_shop || 'https://www.civora.it'}`;

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPromptText }
                ],
                temperature: 0.2,
                max_tokens: 800
            })
        });

        const data = await response.json();
        const postOutput = data.choices?.[0]?.message?.content || "";
        res.status(200).json({ post: postOutput.trim() });

    } catch (error) {
        console.error("[api/social.js] Errore critico:", error);
        res.status(500).json({ errore: "Errore interno del server: " + error.message });
    }
};
