const admin = require('firebase-admin');

// 🔑 1. Inizializzazione diretta di Firebase Admin SDK
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
        // 🟢 BLOCCO WHATSAPP AUTOPILOT (BUTTAFUORI + MAGGIORDOMO INTELLIGENTE)
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
            // 💂‍♂️ IL BUTTAFUORI INCORRUTTIBILE (Controllo Permessi)
            // -------------------------------------------------------------
            const vendorDoc = await db.collection('vendors').doc(vendorId).get();
            if (!vendorDoc.exists) {
                console.log(`[Buttafuori] 🛑 Salone ${vendorId} non trovato.`);
                return res.status(200).json({ status: "skipped", reason: "Salone inesistente" });
            }

            const vendorData = vendorDoc.data() || {};
            const isWaConnected = vendorData.whatsapp_connected === true;
            const isAutoPilotOn = vendorData.whatsapp_ai_autopilot === true;

            if (!isWaConnected || !isAutoPilotOn) {
                console.log(`[Buttafuori] 🛑 Accesso negato per ${vendorId}. Connesso: ${isWaConnected}, Pilota IA: ${isAutoPilotOn}`);
                return res.status(200).json({ 
                    status: "skipped", 
                    reason: "Pilota automatico o WhatsApp disattivati dal negoziante" 
                });
            }

            console.log(`[Buttafuori] 🟢 VIA LIBERA per "${vendorData.store_name || vendorId}". Chiamo il Maggiordomo...`);

            // -------------------------------------------------------------
            // 🤵 IL MAGGIORDOMO: RACCOLTA DATI ISTANTANEA (IN PARALLELO)
            // -------------------------------------------------------------
            let cleanPhone = senderPhone.replace(/\D/g, '');
            if (!cleanPhone.startsWith('39') && cleanPhone.length === 10) cleanPhone = '39' + cleanPhone;

            const phoneVariants = Array.from(new Set([
                senderPhone,
                cleanPhone,
                `+${cleanPhone}`,
                cleanPhone.startsWith('39') ? cleanPhone.substring(2) : cleanPhone
            ].filter(Boolean)));

            // Esegue tutte le letture del database in contemporanea (circa 50ms)
            const [clientTipsDoc, servicesSnap, productsSnap, clientSnap, chatHistorySnap] = await Promise.all([
                // 1. Consigli salone (parcheggi e indicazioni)
                db.collection('vendors').doc(vendorId).collection('consiglicliente').doc('main').get().catch(() => ({ exists: false })),
                
                // 2. Menu Servizi del salone
                db.collection('artisan_services').where('vendorId', '==', vendorId).get().catch(() => ({ docs: [] })),
                
                // 3. Vetrina Prodotti
                db.collection('offers').where('vendorId', '==', vendorId).get().catch(() => ({ docs: [] })),
                
                // 4. Controllo Rubrica Salone
                db.collection('vendors').doc(vendorId).collection('clients')
                    .where('phone', 'in', phoneVariants.slice(0, 10))
                    .limit(1).get().catch(() => ({ empty: true })),
                
                // 5. Memoria ultimi messaggi chat
                db.collection('vendors').doc(vendorId).collection('whatsapp_chats').doc(cleanPhone)
                    .collection('messages').orderBy('timestamp', 'desc').limit(6).get().catch(() => ({ docs: [] }))
            ]);

            // Estrazione Dati Salone
            const storeName = vendorData.store_name || vendorData.owner_name || "il nostro salone";
            const storeAddress = vendorData.address || "in salone";
            const storeHours = vendorData.public_opening_hours || vendorData.opening_hours || "Orari standard";
            const specializations = (vendorData.customization_specializations || []).join(', ');
            
            const tipsData = clientTipsDoc.exists ? clientTipsDoc.data() : {};
            const parkingInfo = tipsData.parkingTips || "";
            const directionsInfo = tipsData.directions || "";

            // Estrazione Servizi Reali
            const servicesList = servicesSnap.docs
                .map(d => d.data())
                .filter(s => s.productName && s.isAvailable !== false)
                .map(s => `- ${s.productName}: ${s.price}€ (${s.totalOccupiedTimeMinutes || s.serviceDuration || 30} min)`)
                .slice(0, 20)
                .join('\n');

            // Estrazione Prodotti in Vendita
            const productsList = productsSnap.docs
                .map(d => d.data())
                .filter(p => p.productName || p.name)
                .map(p => `- ${p.productName || p.name}${p.brand ? ` (${p.brand})` : ''}: ${p.price || 0}€`)
                .slice(0, 15)
                .join('\n');

            // Profilazione Cliente dalla Rubrica
            let isKnownClient = false;
            let clientFullName = pushName || "Cliente";
            let clientNotesFormula = "";
            let isVip = false;

            if (!clientSnap.empty) {
                const cData = clientSnap.docs[0].data();
                isKnownClient = true;
                clientFullName = `${cData.name || ''} ${cData.surname || ''}`.trim() || clientFullName;
                clientNotesFormula = cData.notes || "";
                isVip = Array.isArray(cData.tags) && cData.tags.includes('VIP');
            }

            // Storico Conversazione
            let conversationHistory = [];
            if (chatHistorySnap.docs && chatHistorySnap.docs.length > 0) {
                conversationHistory = chatHistorySnap.docs.map(doc => ({
                    role: doc.data().role === 'assistant' ? 'assistant' : 'user',
                    content: doc.data().content
                })).reverse();
            }

            // -------------------------------------------------------------
            // 🧠 PREPARAZIONE DEL CERVELLO AI (Iniezione Contesto)
            // -------------------------------------------------------------
            const nowRome = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
            const todayRome = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });

            const systemPrompt = `Sei l'assistente virtuale ufficiale del salone "${storeName}" su WhatsApp.
Oggi è ${todayRome}, ore ${nowRome}.

DATI DEL SALONE:
- Nome: ${storeName}
- Indirizzo: ${storeAddress}
- Orari di apertura: ${storeHours}
${specializations ? `- Specializzazioni: ${specializations}` : ''}
${parkingInfo ? `- Info Parcheggio: ${parkingInfo}` : ''}
${directionsInfo ? `- Indicazioni per raggiungerci: ${directionsInfo}` : ''}

SCHEDA DEL CLIENTE CON CUI STAI PARLANDO:
- Nome: "${clientFullName}"
- Tipo cliente: ${isKnownClient ? `Cliente abituale registrato in rubrica${isVip ? ' (⭐️ CLIENTE VIP)' : ''}` : 'Nuovo cliente (non ancora in rubrica)'}
${clientNotesFormula ? `- Note tecniche/Abitudini/Formule passate del cliente: "${clientNotesFormula}"` : ''}

MENU DEI SERVIZI E PREZZI:
${servicesList || "Listino trattamenti disponibile in salone."}

PRODOTTI DISPONIBILI IN SALONE:
${productsList || "Prodotti professionali disponibili in negozio."}

REGOLE DI CONVERSAZIONE WHATSAPP:
1. Rispondi con grande calore, cordialità ed educazione, chiamando il cliente per nome se è noto.
2. Rispondi in MASSIMO 2 o 3 frasi brevi, naturali e facili da leggere sullo schermo di uno smartphone.
3. Se chiedono prezzi o servizi, usa ESCLUSIVAMENTE quelli indicati nel listino sopra. Non inventare mai sconti o servizi non presenti.
4. Se il cliente chiede dove siete o orari, fornisci con precisione i dati del salone.`;

            const messagesPayload = [
                { role: "system", content: systemPrompt },
                ...conversationHistory,
                { role: "user", content: messageText }
            ];

            // Chiamata all'Intelligenza Artificiale (Groq - Llama 3.3)
            let aiReply = `Ciao ${clientFullName}! Ti ringraziamo per averci scritto da ${storeName}. Come possiamo aiutarti oggi?`;

            try {
                const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${GROQ_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: "llama-3.3-70b-versatile",
                        messages: messagesPayload,
                        temperature: 0.4,
                        max_tokens: 300
                    })
                });

                if (groqRes.ok) {
                    const groqData = await groqRes.json();
                    aiReply = groqData.choices?.[0]?.message?.content?.trim() || aiReply;
                } else {
                    console.error("[Groq Error]", await groqRes.text());
                }
            } catch (aiErr) {
                console.error("[AutoPilot] Errore chiamata Groq:", aiErr.message);
            }

            // -------------------------------------------------------------
            // 💾 SALVATAGGIO MEMORIA CHAT NELLA CARTELLA DEL SALONE
            // -------------------------------------------------------------
            try {
                const chatDocRef = db.collection('vendors').doc(vendorId).collection('whatsapp_chats').doc(cleanPhone);
                const messagesCol = chatDocRef.collection('messages');

                await Promise.all([
                    messagesCol.add({
                        role: 'user',
                        content: messageText,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    }),
                    messagesCol.add({
                        role: 'assistant',
                        content: aiReply,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    }),
                    chatDocRef.set({
                        phone: cleanPhone,
                        customerName: clientFullName,
                        lastMessage: aiReply,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true })
                ]);
            } catch (memErr) {
                console.warn("[Memoria Chat] Errore salvataggio:", memErr.message);
            }

            // -------------------------------------------------------------
            // 🚀 INVIO RISPOSTA AL SERVER RENDER (IL POSTINO)
            // -------------------------------------------------------------
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
                console.log(`[AutoPilot] 🚀 Risposta inviata al cliente "${clientFullName}" (${cleanPhone})!`);
            } catch (sendErr) {
                console.error("[AutoPilot] Errore invio Gateway Render:", sendErr.message);
            }

            return res.status(200).json({ success: true, client: clientFullName, reply: aiReply });
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
