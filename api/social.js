const admin = require('firebase-admin');
const { GoogleAuth } = require('google-auth-library');

// Inizializzazione Firebase Admin
if (!admin.apps.length) {
    try {
        let rawKey = (process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '').trim();
        if (!rawKey.startsWith('{')) {
            rawKey = Buffer.from(rawKey, 'base64').toString('utf8');
        }
        const serviceAccount = JSON.parse(rawKey);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('[Firebase Admin] ✅ Inizializzato con successo su social.js!');
    } catch (err) {
        console.error('[Firebase Admin Error] Errore inizializzazione:', err.message);
    }
}

let db;
try {
    db = admin.firestore();
} catch (dbErr) {
    console.error('[Firebase Admin DB Error]:', dbErr.message);
}

// 🔑 Helper per autenticazione ufficiale con Google Cloud Vertex AI
async function getVertexAuthContext() {
    if (!process.env.GOOGLE_CREDENTIALS) return null;
    try {
        let rawCreds = process.env.GOOGLE_CREDENTIALS.trim();
        if (!rawCreds.startsWith('{')) {
            rawCreds = Buffer.from(rawCreds, 'base64').toString('utf8');
        }
        const credentials = JSON.parse(rawCreds);
        const auth = new GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });
        const client = await auth.getClient();
        const accessToken = (await client.getAccessToken()).token;
        const projectId = credentials.project_id || process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_PROJECT_ID;
        const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
        return { accessToken, projectId, location };
    } catch (e) {
        console.warn('[Vertex Auth Error]:', e.message);
        return null;
    }
}

// 🧠 Motore di chiamata AI
async function callAiCompletion({ messages, tools, tool_choice, temperature, max_tokens }) {
    // 1. TENTATIVO CON GOOGLE VERTEX AI (Ufficiale Google Cloud)
    const vertex = await getVertexAuthContext();
    if (vertex) {
        const { accessToken, projectId, location } = vertex;
        const vertexUrl = `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${projectId}/locations/${location}/endpoints/openapi/chat/completions`;
        const vertexModels = ["google/gemini-1.5-flash", "google/gemini-2.0-flash", "gemini-1.5-flash"];

        for (const model of vertexModels) {
            try {
                const res = await fetch(vertexUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: messages,
                        tools: tools,
                        tool_choice: tool_choice || "auto",
                        temperature: temperature || 0.35,
                        max_tokens: max_tokens || 500
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    console.log(`[Google Vertex AI] ✅ Risposta da ${model}!`);
                    return data;
                }
            } catch (vErr) {
                console.warn(`[Google Vertex AI] Tentativo ${model} fallito:`, vErr.message);
            }
        }
    }

    // 2. PARACADUTE AUTOMATICO SU GROQ
    const groqKey = (process.env.GROQ_API_KEY || '').trim();
    if (groqKey) {
        const groqModels = ["openai/gpt-oss-20b", "openai/gpt-oss-120b"];
        for (const model of groqModels) {
            try {
                const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${groqKey}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: messages,
                        tools: tools,
                        tool_choice: tool_choice || "auto",
                        temperature: temperature || 0.3,
                        max_tokens: Math.min(max_tokens || 300, 300)
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    console.log(`[Groq Fallback] ✅ Risposta da ${model}!`);
                    return data;
                }
            } catch (gErr) {}
        }
    }
    return null;
}

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

        // =========================================================================
        // 🟢 BLOCCO WHATSAPP AUTOPILOT (SEMPLIFICATO - SOLO CHAT E CONSENSO)
        // =========================================================================
        if (body.isWhatsAppAutoPilot && body.vendorId) {
            const vendorId = body.vendorId;
            const senderPhone = body.senderPhone || '';
            const senderJid = body.senderJid || senderPhone;
            const messageText = (body.messageText || "").trim();
            const pushName = (body.pushName || "").trim();

            if (!messageText) return res.status(200).json({ status: "skipped", reason: "Messaggio vuoto" });

            // Controllo Permessi Salone
            const vendorDoc = await db.collection('vendors').doc(vendorId).get();
            if (!vendorDoc.exists) return res.status(200).json({ status: "skipped", reason: "Salone inesistente" });

            const vendorData = vendorDoc.data() || {};
            if (!vendorData.whatsapp_connected || !vendorData.whatsapp_ai_autopilot) {
                return res.status(200).json({ status: "skipped", reason: "Pilota automatico disattivato" });
            }

            let cleanPhone = senderPhone.replace(/\D/g, '');
            if (!cleanPhone.startsWith('39') && cleanPhone.length === 10) cleanPhone = '39' + cleanPhone;
            const phoneVariants = Array.from(new Set([ senderPhone, cleanPhone, `+${cleanPhone}`]));

            let activeUserPrompt = messageText;
            const GATEWAY_BASE_URL = (process.env.CIVORA_WHATSAPP_GATEWAY_URL || 'https://civora-whatsapp-gateway.onrender.com').replace(/\/+$/, '');

            async function sendWhatsAppMessage(replyText) {
                try {
                    await fetch(`${GATEWAY_BASE_URL}/send-message`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ vendorId, phone: senderJid || senderPhone, message: replyText })
                    });
                } catch (sendErr) { console.error("[AutoPilot Gateway] Errore invio:", sendErr.message); }
            }

            // RECUPERO DATI DI BASE (Solo Chat e Profilo Cliente)
            const [clientSnap, chatHistorySnap, chatProfileDoc] = await Promise.all([
                db.collection('vendors').doc(vendorId).collection('clients').where('phone', 'in', phoneVariants.slice(0, 10)).limit(1).get().catch(() => ({ empty: true })),
                db.collection('vendors').doc(vendorId).collection('whatsapp_chats').doc(cleanPhone).collection('messages').orderBy('timestamp', 'desc').limit(8).get().catch(() => ({ docs: [] })),
                db.collection('vendors').doc(vendorId).collection('whatsapp_chats').doc(cleanPhone).get().catch(() => ({ exists: false }))
            ]);

            let clientFirstName = "";
            let clientFullName = "";
            if (!clientSnap.empty) {
                const cData = clientSnap.docs[0].data();
                clientFirstName = (cData.name || "").trim();
                clientFullName = `${clientFirstName} ${cData.surname || ''}`.trim();
            } else if (pushName && pushName.length >= 2 && !pushName.includes("@")) {
                clientFirstName = pushName.trim().split(" ")[0];
                clientFullName = pushName.trim();
            }

            const storeName = vendorData.store_name || vendorData.owner_name || "il nostro salone";
            const chatDocRef = db.collection('vendors').doc(vendorId).collection('whatsapp_chats').doc(cleanPhone);
            const messagesCol = chatDocRef.collection('messages');
            const nowRomeStr = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });

            const chatData = (chatProfileDoc && chatProfileDoc.exists) ? (chatProfileDoc.data() || {}) : null;
            const currentConsent = chatData ? chatData.aiConsentStatus : null;

            // ---------------------------------------------------------
            // GESTIONE CONSENSO (1 per AI, 2 per Umano) - MANTENUTA
            // ---------------------------------------------------------
            
            // CASO 1: PRIMISSIMO CONTATTO
            if (!chatData || !currentConsent) {
                await chatDocRef.set({
                    phone: cleanPhone,
                    customerName: clientFullName || pushName || 'Cliente',
                    firstContactAt: admin.firestore.FieldValue.serverTimestamp(),
                    firstContactDate: nowRomeStr,
                    aiConsentStatus: 'pending',
                    pendingInitialMessage: messageText,
                    lastMessage: messageText,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                await messagesCol.add({ role: 'user', content: messageText, timestamp: admin.firestore.FieldValue.serverTimestamp(), dateTimeRome: nowRomeStr });

                const greetingName = clientFirstName ? `Ciao ${clientFirstName}! 👋` : `Ciao! 👋`;
                const firstContactMsg = `${greetingName}\nBenvenuto da *${storeName}*! Sono l'assistente virtuale del salone.\n\nCome preferisci procedere?\n1️⃣ Digita *1* per chattare con me subito\n2️⃣ Digita *2* per attendere il titolare di persona`;
                await sendWhatsAppMessage(firstContactMsg);

                await messagesCol.add({ role: 'assistant', content: firstContactMsg, timestamp: admin.firestore.FieldValue.serverTimestamp(), dateTimeRome: nowRomeStr });
                return res.status(200).json({ success: true, status: "consent_requested" });
            }

            // CASO 2: IL CLIENTE RISPONDE 1 o 2
            if (currentConsent === 'pending') {
                const cleanedAnswer = messageText.trim().toLowerCase();
                const isAccept = /^(1|uno|si|sì|ok|accetto|1️⃣)$/i.test(cleanedAnswer) || cleanedAnswer.startsWith('1');
                const isDecline = /^(2|due|no|rifiuto|2️⃣)$/i.test(cleanedAnswer) || cleanedAnswer.startsWith('2');

                await messagesCol.add({ role: 'user', content: messageText, timestamp: admin.firestore.FieldValue.serverTimestamp(), dateTimeRome: nowRomeStr });

                if (isDecline) {
                    await chatDocRef.set({ aiConsentStatus: 'declined', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
                    const declineMsg = `Perfetto! Ho avvisato il titolare. Ti risponderà non appena sarà libero! 👤\n\n(Se cambi idea e vuoi parlare con me, premi *1*)`;
                    await sendWhatsAppMessage(declineMsg);
                    return res.status(200).json({ success: true, status: "consent_declined" });
                }

                if (!isAccept) {
                    const remindMsg = `Per poterti rispondere subito, digita *1* per chattare con l'assistente virtuale oppure *2* per attendere il titolare. 😊`;
                    await sendWhatsAppMessage(remindMsg);
                    return res.status(200).json({ success: true, status: "consent_reminded" });
                }

                await chatDocRef.set({ aiConsentStatus: 'accepted', consentAcceptedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
                const originalQuestion = (chatData && chatData.pendingInitialMessage) ? chatData.pendingInitialMessage : "Ciao! Dimmi pure come posso aiutarti.";
                activeUserPrompt = `[ISTRUZIONE DI SISTEMA: Il cliente ha appena accettato di parlare con te. Salutalo e rispondi subito alla sua domanda precedente: "${originalQuestion}"]`;
            }

            // CASO 3: RIATTIVAZIONE
            if (currentConsent === 'declined') {
                const wantsToReactivate = /^(1|uno|si|sì|ok|1️⃣)$/i.test(messageText.trim().toLowerCase());
                if (wantsToReactivate) {
                    await chatDocRef.set({ aiConsentStatus: 'accepted', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
                    activeUserPrompt = `[ISTRUZIONE: Il cliente è tornato a chattare con te. Dagli il bentornato.]`;
                } else {
                    return res.status(200).json({ status: "skipped", reason: "Chat gestita manualmente dal titolare" });
                }
            }

            // ---------------------------------------------------------
            // CREAZIONE RISPOSTA AI (SEMPLIFICATA)
            // ---------------------------------------------------------
            
            let conversationHistory = [];
            if (chatHistorySnap.docs && chatHistorySnap.docs.length > 0) {
                conversationHistory = chatHistorySnap.docs.slice(0, 4).map(doc => ({
                    role: doc.data().role === 'assistant' ? 'assistant' : 'user',
                    content: doc.data().content
                })).reverse();
            }

            // PROMPT PULITO ED ESSENZIALE (Base per i tuoi sviluppi futuri)
            const systemPrompt = `Sei l'assistente virtuale su WhatsApp del salone "${storeName}".
Il tuo compito per ora è essere gentile, accogliente e rispondere in modo semplice.
Il nome del cliente è: ${clientFullName || clientFirstName || 'Cliente'}.
ATTENZIONE: Al momento non sei ancora in grado di vedere i prezzi, controllare l'agenda o fissare appuntamenti.
Se il cliente chiede di prenotare o chiede info specifiche, digli gentilmente che hai preso nota e che il titolare lo contatterà a breve per confermare.`;

            const messagesPayload = [
                { role: "system", content: systemPrompt },
                ...conversationHistory,
                { role: "user", content: activeUserPrompt }
            ];

            let aiReply = `Ciao ${clientFullName || clientFirstName || ''}! Come posso aiutarti oggi da ${storeName}?`;

            // Chiamata AI SENZA TOOLS (molto più veloce ed economica)
            const aiData = await callAiCompletion({
                messages: messagesPayload,
                temperature: 0.4,
                max_tokens: 250 // Abbassato visto che le risposte saranno più brevi
            });

            if (aiData?.choices?.[0]?.message?.content) {
                aiReply = aiData.choices[0].message.content.trim();
            }

            // Salvataggio in memoria e invio
            try {
                await Promise.all([
                    messagesCol.add({ role: 'user', content: (currentConsent === 'pending') ? `1 (Consenso Accettato)` : messageText, timestamp: admin.firestore.FieldValue.serverTimestamp(), dateTimeRome: nowRomeStr }),
                    messagesCol.add({ role: 'assistant', content: aiReply, timestamp: admin.firestore.FieldValue.serverTimestamp(), dateTimeRome: nowRomeStr }),
                    chatDocRef.set({ phone: cleanPhone, customerName: clientFullName || pushName || 'Cliente', lastMessage: aiReply, updatedAt: admin.firestore.FieldValue.serverTimestamp(), lastActiveDate: nowRomeStr }, { merge: true })
                ]);
            } catch (memErr) {}

            await sendWhatsAppMessage(aiReply);
            return res.status(200).json({ success: true, client: clientFullName, reply: aiReply });
        }

        // =========================================================
        // 🔒 BLOCCO COPYWRITER MARKETING PER I POST (SIGILLATO)
        // =========================================================
        const contesto = body.contesto;
        if (!contesto) {
            return res.status(400).json({ errore: "Dati di contesto mancanti nella richiesta." });
        }

        let systemPrompt = `Sei un Senior Social Media Copywriter da Agenzia di Marketing di Lusso. Crea post magnetici per promuovere servizi e prodotti. Rispondi solo con il testo del post.`;
        let userPromptText = `Dati: Negozio: "${contesto.store_name || 'Salone'}", Servizio: "${contesto.nome || 'Servizio'}", Prezzo: ${contesto.prezzo || '0'}€, Link: ${contesto.link_shop || 'https://www.civora.it'}`;

        const postAiData = await callAiCompletion({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPromptText }
            ],
            temperature: 0.2,
            max_tokens: 500
        });

        const postOutput = postAiData?.choices?.[0]?.message?.content || "";
        res.status(200).json({ post: postOutput.trim() });

    } catch (error) {
        console.error("[api/social.js] Errore critico:", error);
        res.status(500).json({ errore: "Errore interno del server: " + error.message });
    }
};
