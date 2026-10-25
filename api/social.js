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

// 🧠 Motore di chiamata AI con supporto ai Tools (Function Calling)
async function callAiCompletion({ messages, tools, tool_choice, temperature, max_tokens }) {
    // 1. TENTATIVO CON GOOGLE VERTEX AI
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
                    return data;
                }
            } catch (vErr) {}
        }
    }

    // 2. PARACADUTE SU GROQ
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
                        max_tokens: max_tokens || 300
                    })
                });

                if (res.ok) {
                    const data = await res.json();
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
        let body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { body = {}; }
        }

        // =========================================================================
        // 🟢 BLOCCO 1: WHATSAPP CONCIERGE & AGENDA REALE
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
                return res.status(200).json({ status: "skipped", reason: "Pilota automatico o WhatsApp disattivati" });
            }

            let cleanPhone = senderPhone.replace(/\D/g, '');
            if (!cleanPhone.startsWith('39') && cleanPhone.length === 10) cleanPhone = '39' + cleanPhone;
            const phoneVariants = Array.from(new Set([senderPhone, cleanPhone, `+${cleanPhone}`]));

            let activeUserPrompt = messageText;
            const GATEWAY_BASE_URL = (process.env.CIVORA_WHATSAPP_GATEWAY_URL || 'https://civora-whatsapp-gateway.onrender.com').replace(/\/+$/, '');
            const SLOTS_API_URL = "https://localmente-api.vercel.app/api/get-available-slots";

            async function sendWhatsAppMessage(replyText) {
                try {
                    await fetch(`${GATEWAY_BASE_URL}/send-message`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ vendorId, phone: senderJid || senderPhone, message: replyText })
                    });
                } catch (sendErr) { console.error("[AutoPilot Gateway] Errore invio:", sendErr.message); }
            }

            // RACCOLTA DATI: Cliente, Chat, Servizi e Staff
            const [clientSnap, chatHistorySnap, chatProfileDoc, servicesSnap, collaboratorsSnap] = await Promise.all([
                db.collection('vendors').doc(vendorId).collection('clients').where('phone', 'in', phoneVariants.slice(0, 10)).limit(1).get().catch(() => ({ empty: true })),
                db.collection('vendors').doc(vendorId).collection('whatsapp_chats').doc(cleanPhone).collection('messages').orderBy('timestamp', 'desc').limit(6).get().catch(() => ({ docs: [] })),
                db.collection('vendors').doc(vendorId).collection('whatsapp_chats').doc(cleanPhone).get().catch(() => ({ exists: false })),
                db.collection('artisan_services').where('vendorId', '==', vendorId).get().catch(() => ({ docs: [] })),
                db.collection('vendors').doc(vendorId).collection('collaborators').where('isActive', '==', true).get().catch(() => ({ docs: [] }))
            ]);

            let clientFirstName = "";
            let clientFullName = "";
            let isVip = false;

            if (!clientSnap.empty) {
                const cData = clientSnap.docs[0].data();
                clientFirstName = (cData.name || "").trim();
                clientFullName = `${clientFirstName} ${cData.surname || ''}`.trim();
                isVip = Array.isArray(cData.tags) && cData.tags.includes('VIP');
            } else if (pushName && pushName.length >= 2 && !pushName.includes("@")) {
                clientFirstName = pushName.trim().split(" ")[0];
                clientFullName = pushName.trim();
            }

            const storeName = vendorData.store_name || vendorData.owner_name || "il nostro salone";
            const storeAddress = vendorData.address || "in sede";
            const storeHours = vendorData.public_opening_hours || vendorData.opening_hours || "Orari standard";

            // Mappa servizi per ID e nome (Nascondendo l'ID al cliente finale)
                        const servicesMap = new Map();
                        const servicesFormatted = (servicesSnap.docs || [])
                            .map(d => {
                                const data = { id: d.id, ...d.data() };
                                servicesMap.set(d.id, data);
                                return data;
                            })
                            .filter(s => s.productName && s.isAvailable !== false)
                            .map(s => `- ${s.productName}: ${parseFloat(s.price) || 0}€ (Durata: ${s.totalOccupiedTimeMinutes || s.serviceDuration || 30} min) [ID_INTERNO:${s.id}]`)
                            .join('\n');

            const teamFormatted = [];
            const ownerName = vendorData.owner_name || vendorData.store_name || "Titolare";
            teamFormatted.push(`- ${ownerName} (Titolare)`);
            (collaboratorsSnap.docs || []).forEach(doc => {
                const c = doc.data();
                teamFormatted.push(`- ${c.name} (${c.role || 'Stilista'})`);
            });

            const chatDocRef = db.collection('vendors').doc(vendorId).collection('whatsapp_chats').doc(cleanPhone);
            const messagesCol = chatDocRef.collection('messages');
            
            // Date e Orari Italiani attuali forzati correttamente su Roma
                        const now = new Date();
                        const formatterDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
                        const todayIsoDate = formatterDate.format(now); // Esempio: 2026-10-25

                        const formatterReadable = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
                        const todayReadable = formatterReadable.format(now); // Esempio: domenica 25 ottobre 2026

                        const nowRomeStr = now.toLocaleString('it-IT', { timeZone: 'Europe/Rome' });

            const chatData = (chatProfileDoc && chatProfileDoc.exists) ? (chatProfileDoc.data() || {}) : null;
            const currentConsent = chatData ? chatData.aiConsentStatus : null;

            // ---------------------------------------------------------
            // CONSENSO INIZIALE (1 o 2)
            // ---------------------------------------------------------
            if (!chatData || !currentConsent) {
                await chatDocRef.set({
                    phone: cleanPhone,
                    customerName: clientFullName || pushName || 'Cliente',
                    firstContactAt: admin.firestore.FieldValue.serverTimestamp(),
                    aiConsentStatus: 'pending',
                    pendingInitialMessage: messageText,
                    lastMessage: messageText,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                await messagesCol.add({ role: 'user', content: messageText, timestamp: admin.firestore.FieldValue.serverTimestamp(), dateTimeRome: nowRomeStr });

                const greetingName = clientFirstName ? `Ciao ${clientFirstName}! 👋` : `Ciao! 👋`;
                const firstContactMsg = `${greetingName}\nBenvenuto da *${storeName}*! Sono l'assistente virtuale del salone.\n\nCome desideri procedere?\n1️⃣ Digita *1* per chattare con me ed avere info o prenotare\n2️⃣ Digita *2* per attendere il titolare di persona`;
                
                await sendWhatsAppMessage(firstContactMsg);
                await messagesCol.add({ role: 'assistant', content: firstContactMsg, timestamp: admin.firestore.FieldValue.serverTimestamp(), dateTimeRome: nowRomeStr });
                return res.status(200).json({ success: true, status: "consent_requested" });
            }

            if (currentConsent === 'pending') {
                const cleanedAnswer = messageText.trim().toLowerCase();
                const isAccept = /^(1|uno|si|sì|ok|accetto|1️⃣)$/i.test(cleanedAnswer) || cleanedAnswer.startsWith('1');
                const isDecline = /^(2|due|no|rifiuto|2️⃣)$/i.test(cleanedAnswer) || cleanedAnswer.startsWith('2');

                await messagesCol.add({ role: 'user', content: messageText, timestamp: admin.firestore.FieldValue.serverTimestamp(), dateTimeRome: nowRomeStr });

                if (isDecline) {
                    await chatDocRef.set({ aiConsentStatus: 'declined', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
                    const declineMsg = `Perfetto! Ho avvisato il titolare. Ti risponderà non appena sarà libero in salone! 👤`;
                    await sendWhatsAppMessage(declineMsg);
                    return res.status(200).json({ success: true, status: "consent_declined" });
                }

                if (!isAccept) {
                    const remindMsg = `Per procedere, digita *1* per chattare con l'assistente virtuale oppure *2* per attendere il titolare. 😊`;
                    await sendWhatsAppMessage(remindMsg);
                    return res.status(200).json({ success: true, status: "consent_reminded" });
                }

                await chatDocRef.set({ aiConsentStatus: 'accepted', consentAcceptedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
                const originalQuestion = (chatData && chatData.pendingInitialMessage) ? chatData.pendingInitialMessage : "Ciao! Dimmi pure come posso aiutarti.";
                activeUserPrompt = `[Il cliente ha accettato di parlare con te. Rispondi alla sua prima domanda in modo naturale: "${originalQuestion}"]`;
            }

            if (currentConsent === 'declined') {
                const wantsToReactivate = /^(1|uno|si|sì|ok|1️⃣)$/i.test(messageText.trim().toLowerCase());
                if (wantsToReactivate) {
                    await chatDocRef.set({ aiConsentStatus: 'accepted', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
                    activeUserPrompt = `[Il cliente è tornato a chattare con te. Dagli il bentornato.]`;
                } else {
                    return res.status(200).json({ status: "skipped", reason: "Chat gestita manualmente dal titolare" });
                }
            }

            // STRUMENTI DI AGENDA (TOOLS): Per leggere gli slot e bloccare l'appuntamento
                        const salonTools = [
                            {
                                type: "function",
                                function: {
                                    name: "controlla_agenda_reale",
                                    description: "Verifica gli orari liberi nel calendario del salone per una data specifica.",
                                    parameters: {
                                        type: "object",
                                        properties: {
                                            serviceId: { type: "string", description: "ID_INTERNO del servizio scelto dal listino" },
                                            dataRichiesta: { type: "string", description: "Data nel formato YYYY-MM-DD" },
                                            durataMinuti: { type: "number", description: "Durata in minuti del servizio" }
                                        },
                                        required: ["dataRichiesta"]
                                    }
                                }
                            },
                            {
                                type: "function",
                                function: {
                                    name: "conferma_e_blocca_appuntamento",
                                    description: "Registra ufficialmente l'appuntamento nel calendario del salone. Da usare SOLO quando il cliente ha scelto un giorno e un orario preciso e ha confermato.",
                                    parameters: {
                                        type: "object",
                                        properties: {
                                            serviceId: { type: "string", description: "ID_INTERNO del servizio" },
                                            data: { type: "string", description: "Data nel formato YYYY-MM-DD" },
                                            ora: { type: "string", description: "Orario nel formato HH:MM (es. 15:30)" },
                                            nomeServizio: { type: "string", description: "Nome del servizio" },
                                            prezzo: { type: "number", description: "Prezzo in euro" },
                                            durataMinuti: { type: "number", description: "Durata in minuti" }
                                        },
                                        required: ["serviceId", "data", "ora", "nomeServizio", "prezzo"]
                                    }
                                }
                            }
                        ];

            let conversationHistory = [];
            if (chatHistorySnap.docs && chatHistorySnap.docs.length > 0) {
                conversationHistory = chatHistorySnap.docs.slice(0, 4).map(doc => ({
                    role: doc.data().role === 'assistant' ? 'assistant' : 'user',
                    content: doc.data().content
                })).reverse();
            }

            const systemPrompt = `Tu sei l'eccellente e cordiale receptionist e concierge di "${storeName}". 
Oggi è ${todayReadable} (${todayIsoDate}).
Il tuo obiettivo è accogliere i clienti, rispondere in modo naturale, e aiutarli a scoprire i servizi, i prodotti, lo staff o a prenotare.

INFORMAZIONI SULL'ATTIVITÀ:
- Indirizzo: ${storeAddress} | Orari: ${storeHours}
- Staff: ${teamFormatted.join(', ') || 'Team Salone'}

LISTINO SERVIZI E PREZZI DISPONIBILI:
${servicesFormatted || "Nessun servizio inserito."}

PROFILO CLIENTE:
- Nome: ${clientFullName || clientFirstName || 'Cliente'}
- VIP: ${isVip ? 'SÌ' : 'No'}

REGOLE PER LA DISPONIBILITÀ E PRENOTAZIONI:
- Non mostrare mai i codici ID interni dei servizi al cliente.
- Se il cliente chiede disponibilità, calcola la data esatta in formato YYYY-MM-DD partendo dal fatto che oggi è ${todayReadable} (${todayIsoDate}).
- Chiama lo strumento 'controlla_agenda_reale' per verificare gli orari.
- **REGOLA FONDAMENTALE:** Quando il cliente sceglie un orario definitivo e dice chiaramente che vuole confermare (es. "Sì, mi va bene alle 15:00", "Fissa pure"), **DEVI chiamare obbligatoriamente lo strumento 'conferma_e_blocca_appuntamento'**. Non dire mai "Ti ho prenotato" se prima non hai eseguito questa funzione di salvataggio!`;

            const messagesPayload = [
                { role: "system", content: systemPrompt },
                ...conversationHistory,
                { role: "user", content: activeUserPrompt }
            ];

            let aiReply = `Ciao ${clientFirstName || ''}! Benvenuto da ${storeName}. Come posso aiutarti oggi?`;

            // Prima chiamata all'AI con supporto ai Tool
            const aiData = await callAiCompletion({
                messages: messagesPayload,
                tools: salonTools,
                tool_choice: "auto",
                temperature: 0.4,
                max_tokens: 450
            });

            if (aiData) {
                const messageObj = aiData.choices?.[0]?.message;

                // SE L'AI VUOLE CONTROLLARE L'AGENDA
                if (messageObj?.tool_calls && messageObj.tool_calls.length > 0) {
                    const call = messageObj.tool_calls[0];
                    let callArgs = {};
                    try { callArgs = JSON.parse(call.function.arguments); } catch(e) {}

                    if (call.function.name === 'controlla_agenda_reale') {
                                            const targetServiceId = callArgs.serviceId || (servicesSnap.docs[0]?.id) || "default";
                                            const targetDate = callArgs.dataRichiesta || todayIsoDate;
                                            
                                            let serviceDuration = 30;
                                            const sFound = servicesMap.get(targetServiceId);
                                            if (sFound) serviceDuration = sFound.totalOccupiedTimeMinutes || sFound.serviceDuration || 30;
                    
                                            let realSlots = [];
                                            try {
                                                const controller = new AbortController();
                                                const timer = setTimeout(() => controller.abort(), 4000);
                    
                                                const slotFetch = await fetch(SLOTS_API_URL, {
                                                    method: "POST",
                                                    signal: controller.signal,
                                                    headers: { "Content-Type": "application/json" },
                                                    body: JSON.stringify({
                                                        action: "getAvailableSlots",
                                                        vendorId: vendorId,
                                                        serviceId: targetServiceId,
                                                        date: targetDate,
                                                        totalOccupiedTimeMinutes: serviceDuration
                                                    })
                                                });
                                                clearTimeout(timer);
                                                const slotJson = await slotFetch.json();
                                                realSlots = slotJson.slots || [];
                                            } catch (slotErr) {
                                                console.warn("[Slot Fetch Error]:", slotErr.message);
                                            }
                    
                                            const toolResultPayload = {
                                                dataVerificata: targetDate,
                                                orariDisponibili: realSlots.length > 0 ? realSlots : "Spiacenti, siamo completi in questa data."
                                            };
                    
                                            const clonedMessages = JSON.parse(JSON.stringify(messagesPayload));
                                            clonedMessages.push(messageObj);
                                            clonedMessages.push({
                                                role: "tool",
                                                tool_call_id: call.id,
                                                content: JSON.stringify(toolResultPayload)
                                            });
                    
                                            const finalAiData = await callAiCompletion({
                                                messages: clonedMessages,
                                                temperature: 0.35,
                                                max_tokens: 350
                                            });
                    
                                            if (finalAiData?.choices?.[0]?.message?.content) {
                                                aiReply = finalAiData.choices[0].message.content.trim();
                                            }
                                        }
                                        else if (call.function.name === 'conferma_e_blocca_appuntamento') {
                                            const targetServiceId = callArgs.serviceId || (servicesSnap.docs[0]?.id) || "default";
                                            const bookDateStr = callArgs.data || todayIsoDate;
                                            const bookTimeStr = callArgs.ora || "10:00";
                                            const bookDur = Number(callArgs.durataMinuti) || 30;
                                            const bookServiceName = callArgs.nomeServizio || "Servizio Salone";
                                            const bookPrice = Number(callArgs.prezzo) || 0;
                    
                                            const startDateTime = new Date(`${bookDateStr}T${bookTimeStr}:00`);
                                            const endDateTime = new Date(startDateTime.getTime() + bookDur * 60000);
                    
                                            let bookingResult = { esito: "ERRORE", messaggio: "Impossibile salvare" };
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
                                                        bookedServiceItems: [{ id: targetServiceId, name: bookServiceName, price: bookPrice, duration: bookDur }],
                                                        startDateTime: startDateTime.toISOString(),
                                                        endDateTime: endDateTime.toISOString(),
                                                        status: "confirmed",
                                                        source: "whatsapp_autopilot",
                                                        bookingOrigin: "manual",
                                                        paymentMethod: "cash_in_studio",
                                                        paymentStatus: "pending",
                                                        bookedForResourceId: vendorId,
                                                        appointmentCode: "WA_" + Date.now().toString().slice(-4),
                                                        type: "cura_persona"
                                                    })
                                                });
                                                clearTimeout(timer);
                    
                                                if (saveBookingRes.ok) {
                                                    bookingResult = { esito: "CONFERMATO", messaggio: "Appuntamento salvato con successo nel calendario!" };
                                                } else {
                                                    bookingResult = { esito: "NON_DISPONIBILE", messaggio: "Orario non più disponibile o occupato." };
                                                }
                                            } catch (saveErr) {
                                                bookingResult = { esito: "ERRORE", messaggio: saveErr.message };
                                            }
                    
                                            const clonedMessages = JSON.parse(JSON.stringify(messagesPayload));
                                            clonedMessages.push(messageObj);
                                            clonedMessages.push({
                                                role: "tool",
                                                tool_call_id: call.id,
                                                content: JSON.stringify(bookingResult)
                                            });
                    
                                            const finalAiData = await callAiCompletion({
                                                messages: clonedMessages,
                                                temperature: 0.35,
                                                max_tokens: 350
                                            });
                    
                                            if (finalAiData?.choices?.[0]?.message?.content) {
                                                aiReply = finalAiData.choices[0].message.content.trim();
                                            }
                                        }
                } else if (messageObj?.content) {
                    aiReply = messageObj.content.trim();
                }
            }

            // Salvataggio memoria e invio
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


        // =========================================================================
        // 🟢 BLOCCO 2: SOCIAL MEDIA COPYWRITER (Per i post dal gestionale)
        // =========================================================================
        const contesto = body.contesto;
        if (!contesto) {
            return res.status(400).json({ errore: "Nessun contesto valido o richiesta non riconosciuta." });
        }

        let socialSystemPrompt = `Sei un Senior Social Media Copywriter da Agenzia di Marketing di Lusso. Crea post magnetici per promuovere servizi e prodotti. Rispondi solo con il testo del post.`;
        let userPromptText = `Dati: Negozio: "${contesto.store_name || 'Salone'}", Servizio: "${contesto.nome || 'Servizio'}", Prezzo: ${contesto.prezzo || '0'}€, Link: ${contesto.link_shop || 'https://www.civora.it'}`;
        
        if (contesto.note_extra) {
            userPromptText += `, Note extra: ${contesto.note_extra}`;
        }

        const postAiData = await callAiCompletion({
            messages: [
                { role: "system", content: socialSystemPrompt },
                { role: "user", content: userPromptText }
            ],
            temperature: 0.3,
            max_tokens: 500
        });

        const postOutput = postAiData?.choices?.[0]?.message?.content || "";
        if (!postOutput) throw new Error("L'IA non ha restituito alcun testo.");

        res.status(200).json({ post: postOutput.trim() });

    } catch (error) {
        console.error("[api/social.js] Errore critico:", error);
        res.status(500).json({ errore: "Errore interno del server: " + error.message });
    }
};
