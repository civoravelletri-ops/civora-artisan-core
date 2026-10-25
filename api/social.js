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

// 🧠 Motore di chiamata AI: Prova Google Vertex AI (Gemini), con paracadute Groq
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
                } else {
                    const errTxt = await res.text().catch(() => "");
                    console.warn(`[Google Vertex AI] ${model} status ${res.status}:`, errTxt.slice(0, 100));
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
        // 🟢 BLOCCO WHATSAPP AUTOPILOT (POWERED BY GOOGLE VERTEX AI)
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

            // Controllo Permessi Salone
            const vendorDoc = await db.collection('vendors').doc(vendorId).get();
            if (!vendorDoc.exists) {
                return res.status(200).json({ status: "skipped", reason: "Salone inesistente" });
            }

            const vendorData = vendorDoc.data() || {};
            const isWaConnected = vendorData.whatsapp_connected === true;
            const isAutoPilotOn = vendorData.whatsapp_ai_autopilot === true;

            if (!isWaConnected || !isAutoPilotOn) {
                return res.status(200).json({
                    status: "skipped",
                    reason: "Pilota automatico o WhatsApp disattivati dal negoziante"
                });
            }

            let cleanPhone = senderPhone.replace(/\D/g, '');
            if (!cleanPhone.startsWith('39') && cleanPhone.length === 10) cleanPhone = '39' + cleanPhone;

            const phoneVariants = Array.from(new Set([
                senderPhone,
                cleanPhone,
                `+${cleanPhone}`,
                cleanPhone.startsWith('39') ? cleanPhone.substring(2) : cleanPhone
            ].filter(Boolean)));

            let activeUserPrompt = messageText;
            const GATEWAY_BASE_URL = (process.env.CIVORA_WHATSAPP_GATEWAY_URL || 'https://civora-whatsapp-gateway.onrender.com').replace(/\/+$/, '');

            async function sendWhatsAppMessage(replyText) {
                try {
                    await fetch(`${GATEWAY_BASE_URL}/send-message`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            vendorId: vendorId,
                            phone: senderJid || senderPhone,
                            message: replyText
                        })
                    });
                } catch (sendErr) {
                    console.error("[AutoPilot Gateway] Errore invio:", sendErr.message);
                }
            }

            // Raccolta dati in parallelo
            const [clientTipsDoc, servicesSnap, productsSnap, clientSnap, chatHistorySnap, trainingDoc, collaboratorsSnap, chatProfileDoc] = await Promise.all([
                db.collection('vendors').doc(vendorId).collection('consiglicliente').doc('main').get().catch(() => ({ exists: false })),
                db.collection('artisan_services').where('vendorId', '==', vendorId).get().catch(() => ({ docs: [] })),
                db.collection('offers').where('vendorId', '==', vendorId).get().catch(() => ({ docs: [] })),
                db.collection('vendors').doc(vendorId).collection('clients').where('phone', 'in', phoneVariants.slice(0, 10)).limit(1).get().catch(() => ({ empty: true })),
                db.collection('vendors').doc(vendorId).collection('whatsapp_chats').doc(cleanPhone).collection('messages').orderBy('timestamp', 'desc').limit(8).get().catch(() => ({ docs: [] })),
                db.collection('vendors').doc(vendorId).collection('personal_ai_chat').doc('Training').get().catch(() => ({ exists: false })),
                db.collection('vendors').doc(vendorId).collection('collaborators').where('isActive', '==', true).get().catch(() => ({ docs: [] })),
                db.collection('vendors').doc(vendorId).collection('whatsapp_chats').doc(cleanPhone).get().catch(() => ({ exists: false }))
            ]);

            let isKnownClient = false;
            let clientFirstName = "";
            let clientFullName = "";
            let clientNotesFormula = "";
            let isVip = false;

            if (!clientSnap.empty) {
                const cData = clientSnap.docs[0].data();
                isKnownClient = true;
                clientFirstName = (cData.name || "").trim();
                clientFullName = `${clientFirstName} ${cData.surname || ''}`.trim();
                clientNotesFormula = cData.notes || "";
                isVip = Array.isArray(cData.tags) && cData.tags.includes('VIP');
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

                await messagesCol.add({
                    role: 'user',
                    content: messageText,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    dateTimeRome: nowRomeStr
                });

                const greetingName = clientFirstName ? `Ciao ${clientFirstName}! 👋` : `Ciao! 👋`;
                const firstContactMsg = `${greetingName}\nBenvenuto da *${storeName}*! Sono l'assistente virtuale del salone, pronta a darti informazioni e aiutarti a prenotare subito.\n\nCome preferisci procedere?\n1️⃣ Digita *1* per chattare con me subito\n2️⃣ Digita *2* per attendere il titolare di persona`;

                await sendWhatsAppMessage(firstContactMsg);

                await messagesCol.add({
                    role: 'assistant',
                    content: firstContactMsg,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    dateTimeRome: nowRomeStr
                });

                return res.status(200).json({ success: true, status: "consent_requested" });
            }

            // CASO 2: IL CLIENTE RISPONDE 1 o 2
            if (currentConsent === 'pending') {
                const cleanedAnswer = messageText.trim().toLowerCase();
                const isAccept = /^(1|uno|si|sì|ok|accetto|1️⃣)$/i.test(cleanedAnswer) || cleanedAnswer.startsWith('1');
                const isDecline = /^(2|due|no|rifiuto|2️⃣)$/i.test(cleanedAnswer) || cleanedAnswer.startsWith('2');

                await messagesCol.add({
                    role: 'user',
                    content: messageText,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    dateTimeRome: nowRomeStr
                });

                if (isDecline) {
                    await chatDocRef.set({ aiConsentStatus: 'declined', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
                    const declineMsg = `Perfetto! Ho avvisato il titolare che vuoi parlare direttamente con lui: ti risponderà non appena sarà libero dai servizi in salone! 👤\n\n(Se nel frattempo vuoi informazioni o prenotare un posto, premi *1*!)`;
                    await sendWhatsAppMessage(declineMsg);
                    return res.status(200).json({ success: true, status: "consent_declined" });
                }

                if (!isAccept) {
                    const remindMsg = `Per poterti rispondere subito, digita *1* per chattare con l'assistente virtuale oppure *2* per attendere il titolare. 😊`;
                    await sendWhatsAppMessage(remindMsg);
                    return res.status(200).json({ success: true, status: "consent_reminded" });
                }

                await chatDocRef.set({
                    aiConsentStatus: 'accepted',
                    consentAcceptedAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                const originalQuestion = (chatData && chatData.pendingInitialMessage) ? chatData.pendingInitialMessage : "Ciao! Dimmi pure come posso aiutarti.";
                activeUserPrompt = `[ISTRUZIONE DI SISTEMA: Il cliente ha appena accettato di parlare con te. Salutalo con calore e rispondi subito alla domanda che aveva fatto prima: "${originalQuestion}"]`;
            }

            // CASO 3: RIATTIVAZIONE
            if (currentConsent === 'declined') {
                const wantsToReactivate = /^(1|uno|si|sì|ok|1️⃣)$/i.test(messageText.trim().toLowerCase());
                if (wantsToReactivate) {
                    await chatDocRef.set({ aiConsentStatus: 'accepted', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
                    activeUserPrompt = `[ISTRUZIONE: Il cliente è tornato a chattare con l'assistente. Dagli il bentornato calorosamente e chiedigli come puoi aiutarlo oggi.]`;
                } else {
                    return res.status(200).json({ status: "skipped", reason: "Chat gestita manualmente dal titolare" });
                }
            }

            // DATI REALI SALONE
            const storeAddress = vendorData.address || "in salone";
            const storeHours = vendorData.public_opening_hours || vendorData.opening_hours || "Orari standard salone";

            // Catalogo Servizi compatto
            const servicesCatalogDetailed = (servicesSnap.docs || [])
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(s => s.productName && s.isAvailable !== false)
                .map(s => `• [ID: ${s.id}] ${s.productName}: ${parseFloat(s.price) || 0}€ (${s.totalOccupiedTimeMinutes || s.serviceDuration || 30}m)`);

            const servicesListFormatted = servicesCatalogDetailed.join('\n');

            // Prodotti principali
            const productsListFormatted = (productsSnap.docs || [])
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(p => p.productName || p.name)
                .slice(0, 5)
                .map(p => `• [ID: ${p.id}] ${p.productName || p.name}: ${p.price || 0}€`)
                .join('\n');

            // Staff
            const teamEntries = [];
            const ownerName = vendorData.owner_name || vendorData.store_name || "Titolare";
            teamEntries.push(`• 👑 ${ownerName} [Titolare, ID: ${vendorId}]`);
            if (collaboratorsSnap.docs && collaboratorsSnap.docs.length > 0) {
                collaboratorsSnap.docs.forEach(doc => {
                    const c = doc.data();
                    teamEntries.push(`• ✂️ ${c.name} [ID: ${doc.id}]`);
                });
            }
            const teamListFormatted = teamEntries.join('\n');

            // Ultimi messaggi
            let conversationHistory = [];
            if (chatHistorySnap.docs && chatHistorySnap.docs.length > 0) {
                conversationHistory = chatHistorySnap.docs.slice(0, 4).map(doc => ({
                    role: doc.data().role === 'assistant' ? 'assistant' : 'user',
                    content: doc.data().content
                })).reverse();
            }

            // Calendario Reale Dinamico
            const now = new Date();
            const next7DaysFormatted = [];
            for (let i = 0; i < 7; i++) {
                const targetDay = new Date(now.getTime() + (i * 24 * 60 * 60 * 1000));
                const isoDate = targetDay.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
                const readableDay = targetDay.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });
                next7DaysFormatted.push(`- ${readableDay}: ${isoDate}${i === 0 ? ' (OGGI)' : (i === 1 ? ' (DOMANI)' : '')}`);
            }
            const calendarDaysPrompt = next7DaysFormatted.join('\n');

            const nowRome = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
            const todayRome = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });
            const todayIsoDate = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });

            const systemPrompt = `Sei la receptionist di "${storeName}" su WhatsApp.
Oggi è ${todayRome}, ore ${nowRome} (${todayIsoDate}). Cliente: "${clientFullName || clientFirstName || 'Cliente'}".

REGOLE ESSENZIALI:
- Rispondi in 2 frasi cordiali su WhatsApp con prezzi in grassetto (es. *25€*).
- Se chiedono informazioni ("che servizi fate?"), elenca brevemente i servizi con i prezzi. NON interrogare l'agenda!
- Se chiedono disponibilità o orari ("martedì c'è posto?"), usa subito 'controlla_agenda_reale'. Se non specificano il servizio, usa il Taglio Capelli di default!
- Se il cliente vuole più servizi insieme (es. Taglio e Barba), somma tempi e prezzi, e indica in 'serviziInclusi' l'elenco dei servizi per registrare la combo!
- Se accettano l'orario, lancia 'conferma_e_blocca_appuntamento'.

CALENDARIO:
${calendarDaysPrompt}

INFO SALONE:
- Indirizzo: ${storeAddress} | Orari: ${storeHours}
- Staff: ${teamListFormatted}

LISTINO:
${servicesListFormatted || "Taglio Capelli: 20€ (30m)"}
${productsListFormatted ? `\nPRODOTTI:\n${productsListFormatted}` : ''}`;

            const messagesPayload = [
                { role: "system", content: systemPrompt },
                ...conversationHistory,
                { role: "user", content: activeUserPrompt }
            ];

            const salonTools = [
                {
                    type: "function",
                    function: {
                        name: "controlla_agenda_reale",
                        description: "Verifica gli orari liberi nel calendario reale del salone.",
                        parameters: {
                            type: "object",
                            properties: {
                                serviceId: { type: "string", description: "ID del servizio dal listino" },
                                dataRichiesta: { type: "string", description: "Data YYYY-MM-DD" },
                                durataMinuti: { type: "number", description: "Durata in minuti" }
                            },
                            required: ["dataRichiesta"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "conferma_e_blocca_appuntamento",
                        description: "Registra l'appuntamento sul gestionale salone.",
                        parameters: {
                            type: "object",
                            properties: {
                                serviceId: { type: "string", description: "ID servizio" },
                                data: { type: "string", description: "Data YYYY-MM-DD" },
                                ora: { type: "string", description: "Orario HH:MM" },
                                nomeServizio: { type: "string", description: "Nome servizio o combo" },
                                prezzo: { type: "number", description: "Prezzo totale" },
                                durataMinuti: { type: "number", description: "Minuti totali" },
                                note: { type: "string" },
                                serviziInclusi: {
                                    type: "array",
                                    description: "Elenco dei servizi inclusi per tracciare le combo",
                                    items: {
                                        type: "object",
                                        properties: {
                                            id: { type: "string" },
                                            name: { type: "string" },
                                            price: { type: "number" },
                                            duration: { type: "number" }
                                        }
                                    }
                                }
                            },
                            required: ["data", "ora", "nomeServizio", "prezzo"]
                        }
                    }
                }
            ];

            let aiReply = `Ciao ${clientFullName || clientFirstName || ''}! Come posso aiutarti oggi da ${storeName}?`;

            const SLOTS_API_URL = "https://localmente-api.vercel.app/api/get-available-slots";

            // Chiamata AI Principale
            const aiData = await callAiCompletion({
                messages: messagesPayload,
                tools: salonTools,
                tool_choice: "auto",
                temperature: 0.35,
                max_tokens: 450
            });

            if (aiData) {
                const messageObj = aiData.choices?.[0]?.message;

                // SE L'IA HA DECISO DI CHIAMARE UN TOOL
                if (messageObj?.tool_calls && messageObj.tool_calls.length > 0) {
                    const call = messageObj.tool_calls[0];
                    let callArgs = {};
                    try { callArgs = JSON.parse(call.function.arguments); } catch(e) {}

                    let toolResultPayload = {};

                    if (call.function.name === 'controlla_agenda_reale') {
                        const targetServiceId = callArgs.serviceId || (servicesSnap.docs[0]?.id) || "default";
                        const targetDate = callArgs.dataRichiesta || todayIsoDate;
                        const targetDuration = Number(callArgs.durataMinuti) || 30;

                        let realSlots = [];
                        try {
                            const controller = new AbortController();
                            const timer = setTimeout(() => controller.abort(), 3500);

                            const slotFetch = await fetch(SLOTS_API_URL, {
                                method: "POST",
                                signal: controller.signal,
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    action: "getAvailableSlots",
                                    vendorId: vendorId,
                                    serviceId: targetServiceId,
                                    date: targetDate,
                                    totalOccupiedTimeMinutes: targetDuration
                                })
                            });
                            clearTimeout(timer);

                            const slotJson = await slotFetch.json();
                            realSlots = slotJson.slots || [];
                        } catch (slotErr) {
                            console.warn("[Slot Fetch Error]:", slotErr.message);
                        }

                        toolResultPayload = {
                            data: targetDate,
                            orariLiberi: realSlots.length > 0 ? realSlots.slice(0, 5) : "Completo / Chiuso"
                        };
                    }
                    else if (call.function.name === 'conferma_e_blocca_appuntamento') {
                        const targetServiceId = callArgs.serviceId || (servicesSnap.docs[0]?.id) || "default";
                        const bookDateStr = callArgs.data || todayIsoDate;
                        const bookTimeStr = callArgs.ora || "10:00";
                        const bookDur = Number(callArgs.durataMinuti) || 30;
                        const bookServiceName = callArgs.nomeServizio || "Taglio Capelli";
                        const bookPrice = Number(callArgs.prezzo) || 20;

                        const startDateTime = new Date(`${bookDateStr}T${bookTimeStr}:00`);
                        const endDateTime = new Date(startDateTime.getTime() + bookDur * 60000);

                        try {
                            const controller = new AbortController();
                            const timer = setTimeout(() => controller.abort(), 4000);

                            const saveBookingRes = await fetch(SLOTS_API_URL, {
                                method: "POST",
                                signal: controller.signal,
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    action: "save_service_booking",
                                    vendorId: vendorId,
                                    serviceId: targetServiceId,
                                    customerName: clientFullName || pushName || "Cliente WhatsApp",
                                    customerPhone: cleanPhone,
                                    bookedServiceName: bookServiceName,
                                    bookedServicePrice: bookPrice,
                                    bookedServiceDuration: bookDur,
                                    bookedTotalOccupiedTime: bookDur,
                                    bookedServiceItems: callArgs.serviziInclusi || [{ id: targetServiceId, name: bookServiceName, price: bookPrice, duration: bookDur }],
                                    startDateTime: startDateTime.toISOString(),
                                    endDateTime: endDateTime.toISOString(),
                                    status: "confirmed",
                                    source: "whatsapp_autopilot",
                                    bookingOrigin: "manual",
                                    paymentMethod: "cash_in_studio",
                                    paymentStatus: "pending",
                                    bookedForResourceId: vendorId,
                                    appointmentCode: "WA_" + Date.now().toString().slice(-4),
                                    type: "cura_persona",
                                    notes: callArgs.note || null
                                })
                            });
                            clearTimeout(timer);

                            toolResultPayload = saveBookingRes.ok 
                                ? { esito: "CONFERMATO", messaggio: "Appuntamento registrato con successo sul gestionale!" }
                                : { esito: "NON_DISPONIBILE", messaggio: "Orario non più disponibile." };
                        } catch (saveErr) {
                            toolResultPayload = { esito: "ERRORE", messaggio: saveErr.message };
                        }
                    }

                    const clonedMessages = JSON.parse(JSON.stringify(messagesPayload));
                    clonedMessages.push(messageObj);
                    clonedMessages.push({
                        role: "tool",
                        tool_call_id: call.id,
                        content: JSON.stringify(toolResultPayload)
                    });

                    // Seconda chiamata: l'AI formula la risposta finale al cliente
                    const finalAiData = await callAiCompletion({
                        messages: clonedMessages,
                        tools: salonTools,
                        tool_choice: "none",
                        temperature: 0.35,
                        max_tokens: 350
                    });

                    if (finalAiData?.choices?.[0]?.message?.content) {
                        aiReply = finalAiData.choices[0].message.content.trim();
                    }
                } else if (messageObj?.content) {
                    aiReply = messageObj.content.trim();
                }
            }

            // Salvataggio memoria chat
            try {
                await Promise.all([
                    messagesCol.add({
                        role: 'user',
                        content: (currentConsent === 'pending') ? `1 (Consenso Accettato)` : messageText,
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        dateTimeRome: nowRomeStr
                    }),
                    messagesCol.add({
                        role: 'assistant',
                        content: aiReply,
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        dateTimeRome: nowRomeStr
                    }),
                    chatDocRef.set({
                        phone: cleanPhone,
                        customerName: clientFullName || pushName || 'Cliente',
                        lastMessage: aiReply,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        lastActiveDate: nowRomeStr
                    }, { merge: true })
                ]);
            } catch (memErr) {
                console.warn("[Memoria Chat] Errore salvataggio:", memErr.message);
            }

            // Invio risposta a WhatsApp
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
