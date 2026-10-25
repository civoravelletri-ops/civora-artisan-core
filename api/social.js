const admin = require('firebase-admin');

// Inizializzazione ultra-sicura Firebase Admin
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

module.exports = async function handler(req, res) {
    // Permessi CORS universali
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
        // 🟢 BLOCCO WHATSAPP AUTOPILOT (LA RECEPTIONIST PIÙ FORTE AL MONDO)
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

            // 💂‍♂️ Controllo Salone e Permessi Autopilot
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

            // Pulizia del numero telefonico
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

            // 🚀 Raccolta Dati Parallela Ultra-Rapida
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

            // 👤 Riconoscimento Cliente
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

            // 🚦 CASO 1: PRIMISSIMO CONTATTO ASSOLUTO
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

            // 🚦 CASO 2: IL CLIENTE RISPONDE 1 o 2 AL PRIMO MESSAGGIO
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

            // 🚦 CASO 3: RIATTIVAZIONE SE AVEVA SCELTO 2
            if (currentConsent === 'declined') {
                const wantsToReactivate = /^(1|uno|si|sì|ok|1️⃣)$/i.test(messageText.trim().toLowerCase());
                if (wantsToReactivate) {
                    await chatDocRef.set({ aiConsentStatus: 'accepted', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
                    activeUserPrompt = `[ISTRUZIONE: Il cliente è tornato a chattare con l'assistente. Dagli il bentornato calorosamente e chiedigli come puoi aiutarlo oggi.]`;
                } else {
                    return res.status(200).json({ status: "skipped", reason: "Chat gestita manualmente dal titolare" });
                }
            }

            // =========================================================================
            // 🧠 PREPARAZIONE DATI REALI, CATALOGO E CALENDARIO
            // =========================================================================
            const storeAddress = vendorData.address || "in salone";
            const storeHours = vendorData.public_opening_hours || vendorData.opening_hours || "Orari standard salone";
            const specializations = (vendorData.customization_specializations || []).join(', ');

            const tipsData = clientTipsDoc.exists ? clientTipsDoc.data() : {};
            const parkingInfo = tipsData.parkingTips || "";
            const directionsInfo = tipsData.directions || "";

            // Catalogo Servizi dettagliato con ID in chiaro per l'AI
            const servicesMap = new Map();
            const servicesCatalogDetailed = (servicesSnap.docs || [])
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(s => s.productName && s.isAvailable !== false)
                .map(s => {
                    servicesMap.set(s.id, s);
                    const cat = (s.productCategory || 'Generale').trim();
                    const dur = s.totalOccupiedTimeMinutes || s.serviceDuration || 30;
                    const price = parseFloat(s.price) || 0;
                    return `• [ID: ${s.id}] ${s.productName} [Categoria: ${cat}]: ${price}€ (Durata: ${dur} min)`;
                });

            const servicesListFormatted = servicesCatalogDetailed.join('\n');

            // Prodotti in vendita da banco
            const productsListFormatted = (productsSnap.docs || [])
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(p => p.productName || p.name)
                .map(p => `• [ID: ${p.id}] ${p.productName || p.name}${p.brand ? ` (${p.brand})` : ''}: ${p.price || 0}€`)
                .slice(0, 15)
                .join('\n');

            // Squadra e collaboratori
            const teamEntries = [];
            const ownerName = vendorData.owner_name || vendorData.store_name || "Titolare";
            teamEntries.push(`• 👑 ${ownerName} [Titolare Principale, ID: ${vendorId}]`);
            if (collaboratorsSnap.docs && collaboratorsSnap.docs.length > 0) {
                collaboratorsSnap.docs.forEach(doc => {
                    const c = doc.data();
                    teamEntries.push(`• ✂️ ${c.name} (${c.jobTitle || 'Collaboratore'}, ID: ${doc.id})`);
                });
            }
            const teamListFormatted = teamEntries.join('\n');

            // Storico messaggi recenti
            let conversationHistory = [];
            if (chatHistorySnap.docs && chatHistorySnap.docs.length > 0) {
                conversationHistory = chatHistorySnap.docs.map(doc => ({
                    role: doc.data().role === 'assistant' ? 'assistant' : 'user',
                    content: doc.data().content
                })).reverse();
            }

            // 📅 Calendario Reale Dinamico dei Prossimi 7 Giorni (Per eliminare ogni allucinazione di data/giorno!)
            const now = new Date();
            const next7DaysFormatted = [];
            for (let i = 0; i < 7; i++) {
                const targetDay = new Date(now.getTime() + (i * 24 * 60 * 60 * 1000));
                const isoDate = targetDay.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }); // YYYY-MM-DD
                const readableDay = targetDay.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });
                next7DaysFormatted.push(`- ${readableDay}: ${isoDate}${i === 0 ? ' (OGGI)' : (i === 1 ? ' (DOMANI)' : '')}`);
            }
            const calendarDaysPrompt = next7DaysFormatted.join('\n');

            const nowRome = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
            const todayRome = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });
            const todayIsoDate = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });

            // =========================================================================
            // 🌟 PROMPT RECEPTIONIST PROFESSIONALE CIVORA
            // =========================================================================
            const systemPrompt = `Sei la receptionist ufficiale, brillante, solare e super professionale di "${storeName}" su WhatsApp.
Oggi è ${todayRome}, ore ${nowRome} (data esatta: ${todayIsoDate}).
Stai parlando con il cliente: "${clientFullName || clientFirstName || 'un nostro caro cliente'}"${isVip ? ' (Cliente VIP ⭐️)' : ''}.
${clientNotesFormula ? `Note tecniche del cliente in archivio: "${clientNotesFormula}".` : ''}

COME COMUNICHI:
- Parla come una persona reale ed educata su WhatsApp: tono caldo, accogliente e spontaneo.
- Scrivi messaggi chiari e ariosi (2-4 frasi), con emoji sobrie e metti sempre in grassetto prezzi e orari (es. *25€*, *15:30*).
- ZERO RISPONDITORI ROBOTICI: Non imporre elenchi a numeri tipo centralino telefonico ("digita 1, digita 2"). Parla come se il cliente fosse davanti a te al bancone.
- ASCOLTO ATTIVO: Se il cliente dice già cosa vuole (es. "vorrei tagliare i capelli"), hai già capito il servizio! Non chiedergli cosa vuole fare, proponigli subito il Taglio e procedi verso la data e l'orario.

REGOLE DI APPUNTAMENTO E MULTI-SERVIZIO:
1. CONSULTA L'AGENDA: Quando il cliente chiede giorni o orari, usa lo strumento 'controlla_agenda_reale' passando il serviceId del servizio e la data in formato YYYY-MM-DD. Proponigli 2 o 3 orari liberi.
2. COMBO E PIÙ SERVIZI INSIEME: Se il cliente vuole due o più servizi (es. Taglio Capelli + Barba):
   - Somma i tempi e i prezzi.
   - Per lo strumento passa il 'serviceId' del servizio principale, ma imposta la 'durataMinuti' con la somma totale dei minuti e 'nomeServizio' come combo (es. "Taglio Capelli + Cura Barba").
3. CONFERMA E BLOCCO: Quando il cliente accetta un orario specifico, lancia SUBITO lo strumento 'conferma_e_blocca_appuntamento' per registrare la prenotazione sul calendario reale.
4. VENDITA PRODOTTI: Se il cliente vuole anche un prodotto (es. cera, shampoo), puoi riservarlo al banco aggiungendo una nota nell'appuntamento o usare lo strumento dedicato 'riserva_o_ordina_prodotto'.

CALENDARIO DI QUESTA SETTIMANA:
${calendarDaysPrompt}

INFO SALONE:
- Salone: ${storeName}
- Indirizzo: ${storeAddress}
- Orari di apertura: ${storeHours}
${specializations ? `- Specialità: ${specializations}` : ''}
${parkingInfo ? `- Info Parcheggio: ${parkingInfo}` : ''}
${directionsInfo ? `- Indicazioni stradali: ${directionsInfo}` : ''}

STAFF E COLLABORATORI:
${teamListFormatted}

LISTINO SERVIZI DISPONIBILI:
${servicesListFormatted || "Servizi disponibili in sede."}

PRODOTTI DA BANCO:
${productsListFormatted || "Prodotti professionali disponibili in negozio."}`;

            const messagesPayload = [
                { role: "system", content: systemPrompt },
                ...conversationHistory,
                { role: "user", content: activeUserPrompt }
            ];

            // =========================================================================
            // 🛠️ TOOLS COLLEGATI A GET-AVAILABLE-SLOTS
            // =========================================================================
            const salonTools = [
                {
                    type: "function",
                    function: {
                        name: "controlla_agenda_reale",
                        description: "Interroga l'agenda in tempo reale per verificare quali orari sono liberi. Usala quando il cliente chiede disponibilità per oggi o date future.",
                        parameters: {
                            type: "object",
                            properties: {
                                serviceId: {
                                    type: "string",
                                    description: "L'ID esatto del servizio (presente nel catalogo tra [ID: ...])."
                                },
                                dataRichiesta: {
                                    type: "string",
                                    description: `Data in formato YYYY-MM-DD (es. ${todayIsoDate}).`
                                },
                                durataMinuti: {
                                    type: "number",
                                    description: "Durata totale in minuti (somma le durate se sono più servizi insieme)."
                                },
                                operatoreId: {
                                    type: "string",
                                    description: "ID dell'operatore o collaboratore se il cliente lo ha richiesto specificamente."
                                }
                            },
                            required: ["serviceId", "dataRichiesta"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "conferma_e_blocca_appuntamento",
                        description: "Blocca e registra definitivamente l'appuntamento nell'agenda del salone quando il cliente conferma un orario preciso.",
                        parameters: {
                            type: "object",
                            properties: {
                                serviceId: {
                                    type: "string",
                                    description: "L'ID del servizio principale dal catalogo [ID: ...]."
                                },
                                data: {
                                    type: "string",
                                    description: "Data concordata in formato YYYY-MM-DD."
                                },
                                ora: {
                                    type: "string",
                                    description: "Orario scelto in formato HH:MM (es. 15:30)."
                                },
                                nomeServizio: {
                                    type: "string",
                                    description: "Nome esatto del servizio o della combo (es. Taglio Capelli + Barba)."
                                },
                                prezzo: {
                                    type: "number",
                                    description: "Prezzo totale del servizio o della somma dei servizi."
                                },
                                durataMinuti: {
                                    type: "number",
                                    description: "Durata totale complessiva in minuti."
                                },
                                operatoreId: {
                                    type: "string",
                                    description: "ID dell'operatore o del titolare assegnato."
                                },
                                note: {
                                    type: "string",
                                    description: "Eventuali richieste particolari o prodotti riservati al banco."
                                }
                            },
                            required: ["serviceId", "data", "ora", "nomeServizio", "prezzo"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "riserva_o_ordina_prodotto",
                        description: "Riserva un prodotto da banco per il ritiro in salone durante l'appuntamento o registra un ordine con consegna a domicilio.",
                        parameters: {
                            type: "object",
                            properties: {
                                nomeProdotto: { type: "string", description: "Nome del prodotto scelto" },
                                quantita: { type: "number", description: "Numero di pezzi" },
                                prezzoTotale: { type: "number", description: "Costo totale del prodotto" },
                                modalitaRitiro: { type: "string", enum: ["ritiro_in_salone", "consegna_domicilio"], description: "Ritiro al banco oppure consegna a domicilio" },
                                indirizzoSpedizione: { type: "string", description: "Indirizzo completo se consegna a domicilio" }
                            },
                            required: ["nomeProdotto", "quantita", "prezzoTotale", "modalitaRitiro"]
                        }
                    }
                }
            ];

            let aiReply = `Ciao ${clientFullName || clientFirstName || ''}! Come posso aiutarti oggi da ${storeName}?`;

            const GROQ_CANDIDATES = [
                "openai/gpt-oss-20b",
                "qwen/qwen3.6-27b",
                "gemma2-9b-it",
                "llama-3.3-70b-versatile",
                "llama-3.1-8b-instant"
            ];

            const SLOTS_API_URL = "https://localmente-api.vercel.app/api/get-available-slots";

            for (const modelId of GROQ_CANDIDATES) {
                try {
                    const clonedMessages = JSON.parse(JSON.stringify(messagesPayload));

                    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${(GROQ_API_KEY || '').trim()}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            model: modelId,
                            messages: clonedMessages,
                            tools: salonTools,
                            tool_choice: "auto",
                            temperature: 0.35,
                            max_tokens: 800
                        })
                    });

                    if (groqRes.ok) {
                        const groqData = await groqRes.json();
                        const choice = groqData.choices?.[0];
                        const messageObj = choice?.message;

                        // SE L'IA HA DECISO DI CHIAMARE UN TOOL
                        if (messageObj?.tool_calls && messageObj.tool_calls.length > 0) {
                            const call = messageObj.tool_calls[0];
                            let callArgs = {};
                            try { callArgs = JSON.parse(call.function.arguments); } catch(e) {}

                            let toolResultPayload = {};

                            // CASO 1: CONTROLLO AGENDA REALE
                            if (call.function.name === 'controlla_agenda_reale') {
                                // Fallback sul primo servizio se non passato correttamente
                                const targetServiceId = callArgs.serviceId || (servicesSnap.docs[0]?.id) || "default";
                                const targetDate = callArgs.dataRichiesta || todayIsoDate;
                                const targetDuration = Number(callArgs.durataMinuti) || 30;

                                console.log(`[AutoPilot Tool] 🔍 Controllo slot: Servizio=${targetServiceId}, Data=${targetDate}, Durata=${targetDuration}m`);

                                let realSlots = [];
                                try {
                                    const slotPayload = {
                                        action: "getAvailableSlots",
                                        vendorId: vendorId,
                                        serviceId: targetServiceId,
                                        date: targetDate,
                                        totalOccupiedTimeMinutes: targetDuration
                                    };
                                    if (callArgs.operatoreId) {
                                        slotPayload.bookedForResourceId = callArgs.operatoreId;
                                    }

                                    const slotFetch = await fetch(SLOTS_API_URL, {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify(slotPayload)
                                    });

                                    const slotJson = await slotFetch.json();
                                    realSlots = slotJson.slots || [];
                                } catch (slotErr) {
                                    console.warn("[AutoPilot Tool] Errore lettura slot:", slotErr.message);
                                }

                                toolResultPayload = {
                                    dataRichiesta: targetDate,
                                    orariVeramenteLiberi: realSlots.length > 0 ? realSlots : "Completo / Nessuno slot disponibile per questo giorno"
                                };
                            }

                            // CASO 2: CONFERMA E BLOCCO APPUNTAMENTO SUL GESTIONALE
                            else if (call.function.name === 'conferma_e_blocca_appuntamento') {
                                const targetServiceId = callArgs.serviceId || (servicesSnap.docs[0]?.id) || "default";
                                const bookDateStr = callArgs.data || todayIsoDate;
                                const bookTimeStr = callArgs.ora || "10:00";
                                const bookDur = Number(callArgs.durataMinuti) || 30;
                                const bookServiceName = callArgs.nomeServizio || "Servizio Salone";
                                const bookPrice = Number(callArgs.prezzo) || 0;
                                const assignedResource = callArgs.operatoreId || vendorId;
                                const isOwner = (assignedResource === vendorId);

                                const startDateTime = new Date(`${bookDateStr}T${bookTimeStr}:00`);
                                const endDateTime = new Date(startDateTime.getTime() + bookDur * 60000);

                                console.log(`[AutoPilot Tool] 📝 Blocco appuntamento reale: ${bookServiceName} il ${bookDateStr} alle ${bookTimeStr} (${bookPrice}€)`);

                                try {
                                    const saveBookingRes = await fetch(SLOTS_API_URL, {
                                        method: "POST",
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
                                            startDateTime: startDateTime.toISOString(),
                                            endDateTime: endDateTime.toISOString(),
                                            status: "confirmed",
                                            source: "whatsapp_autopilot",
                                            bookingOrigin: "manual",
                                            paymentMethod: "cash_in_studio",
                                            paymentStatus: "pending",
                                            bookedForResourceId: assignedResource,
                                            collaboratorId: isOwner ? null : assignedResource,
                                            appointmentCode: "WA_" + Date.now().toString().slice(-4),
                                            type: "cura_persona",
                                            notes: callArgs.note || null
                                        })
                                    });

                                    if (saveBookingRes.ok) {
                                        const bookJson = await saveBookingRes.json().catch(() => ({}));
                                        toolResultPayload = {
                                            esito: "SUCCESSO_APPUNTAMENTO_BLOCCATO",
                                            bookingId: bookJson.bookingId,
                                            servizio: bookServiceName,
                                            data: bookDateStr,
                                            ora: bookTimeStr,
                                            prezzo: bookPrice,
                                            messaggio: "Appuntamento inserito con successo nel calendario del salone! Posto bloccato."
                                        };
                                        console.log(`[AutoPilot Tool] ✅ Appuntamento bloccato con successo: ID ${bookJson.bookingId}`);
                                    } else {
                                        const errJson = await saveBookingRes.json().catch(() => ({}));
                                        toolResultPayload = {
                                            esito: "ERRORE",
                                            motivo: errJson.error || "Orario non disponibile o già occupato"
                                        };
                                    }
                                } catch (saveErr) {
                                    toolResultPayload = { esito: "ERRORE", motivo: saveErr.message };
                                }
                            }

                            // CASO 3: RISERVA O ORDINA PRODOTTO
                            else if (call.function.name === 'riserva_o_ordina_prodotto') {
                                const pName = callArgs.nomeProdotto || "Prodotto";
                                const pQty = Number(callArgs.quantita) || 1;
                                const pTot = Number(callArgs.prezzoTotale) || 0;
                                const mode = callArgs.modalitaRitiro || "ritiro_in_salone";

                                if (mode === 'consegna_domicilio') {
                                    try {
                                        await fetch(SLOTS_API_URL, {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({
                                                action: "save_whatsapp_product_order",
                                                vendorId: vendorId,
                                                customerName: clientFullName || pushName || "Cliente WhatsApp",
                                                customerPhone: cleanPhone,
                                                deliveryAddress: callArgs.indirizzoSpedizione || "Indirizzo da concordare",
                                                items: [{ productName: pName, quantity: pQty, price: pTot }],
                                                totalPrice: pTot,
                                                orderNotes: "Ordine tramite assistente WhatsApp"
                                            })
                                        });
                                        toolResultPayload = { esito: "SUCCESSO_ORDINE_DOMICILIO", messaggio: "Ordine registrato con successo nel sistema ordini!" };
                                    } catch (ordErr) {
                                        toolResultPayload = { esito: "ERRORE_ORDINE", motivo: ordErr.message };
                                    }
                                } else {
                                    // Messo da parte alla cassa
                                    toolResultPayload = {
                                        esito: "PRODOTTO_MESSO_DA_PARTE",
                                        prodotto: pName,
                                        quantita: pQty,
                                        totale: pTot,
                                        messaggio: `Prodotto messo da parte alla cassa a nome ${clientFullName || cleanPhone}. Il cliente lo ritirerà in salone!`
                                    };
                                }
                            }

                            // Seconda chiamata Groq per formulare la risposta accogliente al cliente
                            clonedMessages.push(messageObj);
                            clonedMessages.push({
                                role: "tool",
                                tool_call_id: call.id,
                                content: JSON.stringify(toolResultPayload)
                            });

                            const finalGroqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                                method: "POST",
                                headers: {
                                    "Authorization": `Bearer ${(GROQ_API_KEY || '').trim()}`,
                                    "Content-Type": "application/json"
                                },
                                body: JSON.stringify({
                                    model: modelId,
                                    messages: clonedMessages,
                                    tools: salonTools,
                                    temperature: 0.35,
                                    max_tokens: 800
                                })
                            });

                            if (finalGroqRes.ok) {
                                const finalData = await finalGroqRes.json();
                                const finalContent = finalData.choices?.[0]?.message?.content?.trim();
                                if (finalContent) {
                                    aiReply = finalContent;
                                    break;
                                }
                            }
                        } else if (messageObj?.content) {
                            aiReply = messageObj.content.trim();
                            break;
                        }
                    }
                } catch (aiErr) {
                    console.warn(`[AutoPilot] Tentativo fallito su ${modelId}:`, aiErr.message);
                }
            }

            // 💾 Salvataggio Storico Conversazione su Firestore
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

            // 🚀 Invio messaggio finale su WhatsApp tramite Gateway Render
            await sendWhatsAppMessage(aiReply);
            return res.status(200).json({ success: true, client: clientFullName, reply: aiReply });
        }

        // =========================================================================
        // 🔒 BLOCCO COPYWRITER MARKETING PER I POST SOCIAL (SIGILLATO AL 100%)
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
