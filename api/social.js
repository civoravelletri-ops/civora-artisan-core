const admin = require('firebase-admin');

// Inizializzazione ultra-sicura: decodifica automaticamente sia JSON normale che Base64 ("ewog...")
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
        // 🟢 BLOCCO WHATSAPP AUTOPILOT (RECEPTIONIST INTELLIGENTE)
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
            // 💂‍♂️ CONTROLLO ABILITAZIONE NEGOZIANTE
            // -------------------------------------------------------------
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

            // -------------------------------------------------------------
            // 🤵 RACCOLTA DATI DEL CLIENTE E DEL NEGOZIO (IN PARALLELO)
            // -------------------------------------------------------------
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

            const [clientTipsDoc, servicesSnap, productsSnap, clientSnap, chatHistorySnap, trainingDoc, collaboratorsSnap, chatProfileDoc] = await Promise.all([
                db.collection('vendors').doc(vendorId).collection('consiglicliente').doc('main').get().catch(() => ({ exists: false })),
                db.collection('artisan_services').where('vendorId', '==', vendorId).get().catch(() => ({ docs: [] })),
                db.collection('offers').where('vendorId', '==', vendorId).get().catch(() => ({ docs: [] })),
                db.collection('vendors').doc(vendorId).collection('clients')
                    .where('phone', 'in', phoneVariants.slice(0, 10))
                    .limit(1).get().catch(() => ({ empty: true })),
                db.collection('vendors').doc(vendorId).collection('whatsapp_chats').doc(cleanPhone)
                    .collection('messages').orderBy('timestamp', 'desc').limit(8).get().catch(() => ({ docs: [] })),
                db.collection('vendors').doc(vendorId).collection('personal_ai_chat').doc('Training').get().catch(() => ({ exists: false })),
                db.collection('vendors').doc(vendorId).collection('collaborators').where('isActive', '==', true).get().catch(() => ({ docs: [] })),
                db.collection('vendors').doc(vendorId).collection('whatsapp_chats').doc(cleanPhone).get().catch(() => ({ exists: false }))
            ]);

            // -------------------------------------------------------------
            // GESTIONE SESSIONE E CONSENSO INIZIALE
            // -------------------------------------------------------------
            const chatData = (chatProfileDoc && chatProfileDoc.exists) ? (chatProfileDoc.data() || {}) : null;
            const currentConsent = chatData ? chatData.aiConsentStatus : null;

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

            // CASO 1: PRIMO CONTATTO ASSOLUTO
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
                const firstContactMsg = `${greetingName}\nBenvenuto da *${storeName}*! Sono l'assistente virtuale del salone, pronta a darti informazioni e aiutarti a prenotare in un istante.\n\nVuoi parlare subito con me o preferisci attendere il titolare?\n1️⃣ Digita *1* per chattare con me subito\n2️⃣ Digita *2* per attendere il titolare di persona`;

                await sendWhatsAppMessage(firstContactMsg);

                await messagesCol.add({
                    role: 'assistant',
                    content: firstContactMsg,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    dateTimeRome: nowRomeStr
                });

                return res.status(200).json({ success: true, status: "consent_requested" });
            }

            // CASO 2: IL CLIENTE STA RISPONDENDO 1 o 2 AL PRIMO MESSAGGIO
            if (currentConsent === 'pending') {
                const cleanedAnswer = messageText.trim().toLowerCase();
                const isAccept = cleanedAnswer === '1' || cleanedAnswer.startsWith('1') || /^(1|uno|si|sì|ok|accetto|1️⃣)$/i.test(cleanedAnswer);
                const isDecline = cleanedAnswer === '2' || cleanedAnswer.startsWith('2') || /^(2|due|no|rifiuto|2️⃣)$/i.test(cleanedAnswer);

                await messagesCol.add({
                    role: 'user',
                    content: messageText,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    dateTimeRome: nowRomeStr
                });

                if (isDecline) {
                    await chatDocRef.set({ aiConsentStatus: 'declined', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
                    const declineMsg = `Perfetto! Ho avvisato il titolare che preferisci parlare direttamente con lui. Ti risponderà non appena si libera dal lavoro in salone! 👤\n\n(Se nel frattempo vuoi chiedermi qualsiasi cosa o prenotare, ti basta premere *1*!)`;
                    await sendWhatsAppMessage(declineMsg);
                    return res.status(200).json({ success: true, status: "consent_declined" });
                }

                if (!isAccept) {
                    const remindMsg = `Per poterti rispondere, dimmi pure se preferisci parlare con me subito (digita *1*) o attendere il titolare (digita *2*). 😊`;
                    await sendWhatsAppMessage(remindMsg);
                    return res.status(200).json({ success: true, status: "consent_reminded" });
                }

                await chatDocRef.set({
                    aiConsentStatus: 'accepted',
                    consentAcceptedAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                const originalQuestion = (chatData && chatData.pendingInitialMessage) ? chatData.pendingInitialMessage : "Ciao! Dimmi pure come posso aiutarti.";
                activeUserPrompt = `[ISTRUZIONE DI SISTEMA: Il cliente ha appena accettato di parlare con te. Salutalo calorosamente e rispondi con empatia alla sua richiesta iniziale: "${originalQuestion}"]`;
            }

            // CASO 3: SE AVEVA DECLINATO MA ORA PREME 1
            if (currentConsent === 'declined') {
                const wantsToReactivate = /^(1|uno|si|sì|ok|1️⃣)$/i.test(messageText.trim().toLowerCase());
                if (wantsToReactivate) {
                    await chatDocRef.set({ aiConsentStatus: 'accepted', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
                    activeUserPrompt = `[ISTRUZIONE: Il cliente è tornato a chattare con l'assistente. Dagli il bentornato e chiedigli come puoi essergli utile oggi.]`;
                } else {
                    return res.status(200).json({ status: "skipped", reason: "Chat gestita manualmente dal titolare" });
                }
            }

            // =========================================================================
            // 🧠 PREPARAZIONE DATI REALI PER L'INTELLIGENZA ARTIFICIALE
            // =========================================================================
            const storeAddress = vendorData.address || "in salone";
            const storeHours = vendorData.public_opening_hours || vendorData.opening_hours || "Orari standard salone";
            const specializations = (vendorData.customization_specializations || []).join(', ');

            const tipsData = clientTipsDoc.exists ? clientTipsDoc.data() : {};
            const parkingInfo = tipsData.parkingTips || "";
            const directionsInfo = tipsData.directions || "";

            // Catalogo Servizi Formattato
            const servicesCatalogDetailed = (servicesSnap.docs || [])
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(s => s.productName && s.isAvailable !== false)
                .map(s => {
                    const cat = (s.productCategory || 'Generale').trim();
                    const dur = s.totalOccupiedTimeMinutes || s.serviceDuration || 30;
                    const price = parseFloat(s.price) || 0;
                    return `• ${s.productName} [${cat}]: ${price}€ (Durata: ${dur} min)`;
                });

            const servicesList = servicesCatalogDetailed.join('\n');

            // Prodotti in vendita
            const productsList = (productsSnap.docs || [])
                .map(d => d.data())
                .filter(p => p.productName || p.name)
                .map(p => `- ${p.productName || p.name}${p.brand ? ` (${p.brand})` : ''}: ${p.price || 0}€`)
                .slice(0, 15)
                .join('\n');

            // Squadra del salone
            const teamEntries = [];
            const ownerName = vendorData.owner_name || vendorData.store_name || "Titolare";
            teamEntries.push(`• 👑 ${ownerName} [Titolare Principale]`);
            if (collaboratorsSnap.docs && collaboratorsSnap.docs.length > 0) {
                collaboratorsSnap.docs.forEach(doc => {
                    const c = doc.data();
                    teamEntries.push(`• ✂️ ${c.name} (${c.jobTitle || 'Collaboratore'})`);
                });
            }
            const teamListFormatted = teamEntries.join('\n');

            // Storico conversazione recente
            let conversationHistory = [];
            if (chatHistorySnap.docs && chatHistorySnap.docs.length > 0) {
                conversationHistory = chatHistorySnap.docs.map(doc => ({
                    role: doc.data().role === 'assistant' ? 'assistant' : 'user',
                    content: doc.data().content
                })).reverse();
            }

            const nowRome = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
            const todayRome = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });

            // =========================================================================
            // 🌟 IL PROMPT DELLA RECEPTIONIST UMANA (SENZA GABBIE NÉ REGOLE RIGIDE)
            // =========================================================================
            const systemPrompt = `Sei la receptionist ufficiale, accogliente, solare e super professionale di "${storeName}" su WhatsApp.
Oggi è ${todayRome}, ore ${nowRome}. Stai parlando con il cliente: "${clientFullName || clientFirstName || 'un nostro caro cliente'}"${isVip ? ' (Cliente VIP ⭐️)' : ''}.

COME TI COMPORTI E COME PARLI:
- Parla come una persona vera in carne e ossa: sii calorosa, amichevole, spontanea e naturale.
- Su WhatsApp sii chiara e ariosa: non scrivere mai muri di testo. Usa frasi brevi, qualche emoji gradevole e metti sempre in grassetto i prezzi e gli orari (es. *25€*, *ore 16:30*).
- ZERO MENU A NUMERI ROBOTICI: Non sembrare MAI un centralino a tasti ("digita 1, digita 2"). Parla come se stessi accogliendo un cliente al bancone del negozio.
- ASCOLTO TOTALE: Se il cliente ti dice già cosa desidera (es. "voglio tagliare i capelli", "vorrei sistemare la barba"), NON mostrargli elenchi infiniti di categorie o servizi a caso! Vai dritta al punto su quello che ha chiesto.
- GESTIONE DISPONIBILITÀ E APPUNTAMENTI:
  * Quando ti chiedono orari, disponibilità per oggi o per i prossimi giorni, usa lo strumento 'controlla_agenda_reale' per vedere gli slot liberi. Proponi 2 o 3 alternative comode.
  * Quando il cliente ti dà conferma per un orario specifico, usa 'conferma_e_blocca_appuntamento' per registrare la prenotazione e rassicuralo calorosamente confermandogli servizio, giorno e ora.

INFORMAZIONI REALI DEL NEGOZIO:
- Nome Salone: ${storeName}
- Indirizzo: ${storeAddress}
- Orari di apertura: ${storeHours}
${specializations ? `- Specialità: ${specializations}` : ''}
${parkingInfo ? `- Info Parcheggio: ${parkingInfo}` : ''}
${directionsInfo ? `- Indicazioni: ${directionsInfo}` : ''}

STAFF:
${teamListFormatted}

LISTINO SERVIZI:
${servicesList || "Servizi disponibili in sede."}

PRODOTTI:
${productsList || "Prodotti professionali disponibili in negozio."}`;

            const todayIsoDate = new Date().toISOString().split('T')[0];

            const messagesPayload = [
                { role: "system", content: systemPrompt },
                ...conversationHistory,
                { role: "user", content: activeUserPrompt }
            ];

            // Strumenti collegati all'agenda reale del salone
            const salonTools = [
                {
                    type: "function",
                    function: {
                        name: "controlla_agenda_reale",
                        description: "Interroga l'agenda in tempo reale per verificare quali orari sono effettivamente liberi. Usala quando il cliente chiede quando venire, orari per oggi, domani o qualsiasi data.",
                        parameters: {
                            type: "object",
                            properties: {
                                dataRichiesta: {
                                    type: "string",
                                    description: `Data in formato YYYY-MM-DD. Oggi è ${todayIsoDate}.`
                                },
                                durataMinuti: {
                                    type: "number",
                                    description: "Durata in minuti del servizio richiesto (default 30 min)."
                                }
                            },
                            required: ["dataRichiesta"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "conferma_e_blocca_appuntamento",
                        description: "Blocca e registra ufficialmente l'appuntamento nell'agenda del salone quando il cliente accetta un orario specifico.",
                        parameters: {
                            type: "object",
                            properties: {
                                data: { type: "string", description: "Data dell'appuntamento YYYY-MM-DD" },
                                ora: { type: "string", description: "Orario scelto HH:MM (es. 16:30)" },
                                nomeServizio: { type: "string", description: "Nome esatto del servizio concordato" },
                                prezzo: { type: "number", description: "Prezzo totale del servizio" },
                                durataMinuti: { type: "number", description: "Durata totale in minuti" }
                            },
                            required: ["data", "ora", "nomeServizio"]
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

            for (const modelId of GROQ_CANDIDATES) {
                try {
                    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${(GROQ_API_KEY || '').trim()}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            model: modelId,
                            messages: messagesPayload,
                            tools: salonTools,
                            tool_choice: "auto",
                            temperature: 0.4,
                            max_tokens: 750 // Spazio abbondante per non troncare mai più le risposte
                        })
                    });

                    if (groqRes.ok) {
                        const groqData = await groqRes.json();
                        const choice = groqData.choices?.[0];
                        const messageObj = choice?.message;

                        if (messageObj?.tool_calls && messageObj.tool_calls.length > 0) {
                            const call = messageObj.tool_calls[0];
                            let callArgs = {};
                            try { callArgs = JSON.parse(call.function.arguments); } catch(e) {}

                            let toolResultPayload = {};

                            // VERIFICA ORARI LIBERI
                            if (call.function.name === 'controlla_agenda_reale') {
                                const targetDate = callArgs.dataRichiesta || todayIsoDate;
                                const targetDuration = callArgs.durataMinuti || 30;

                                let realSlots = [];
                                try {
                                    const slotFetch = await fetch("https://localmente-api.vercel.app/api/get-available-slots", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({
                                            action: "getAvailableSlots",
                                            vendorId: vendorId,
                                            date: targetDate,
                                            totalOccupiedTimeMinutes: targetDuration
                                        })
                                    });
                                    const slotJson = await slotFetch.json();
                                    realSlots = slotJson.slots || [];
                                } catch(slotErr) {
                                    console.warn("[AutoPilot Agenda] Errore slot:", slotErr.message);
                                }

                                toolResultPayload = {
                                    dataRichiesta: targetDate,
                                    orariVeramenteLiberi: realSlots.length > 0 ? realSlots : "Nessuno slot disponibile in questo giorno"
                                };
                            }

                            // REGISTRAZIONE PRENOTAZIONE REALE
                            else if (call.function.name === 'conferma_e_blocca_appuntamento') {
                                const bookDateStr = callArgs.data || todayIsoDate;
                                const bookTimeStr = callArgs.ora || "10:00";
                                const bookDur = Number(callArgs.durataMinuti) || 30;
                                const bookServiceName = callArgs.nomeServizio || "Servizio";
                                const bookPrice = Number(callArgs.prezzo) || 0;

                                const startDateTime = new Date(`${bookDateStr}T${bookTimeStr}:00`);
                                const endDateTime = new Date(startDateTime.getTime() + bookDur * 60000);

                                try {
                                    const saveBookingRes = await fetch("https://localmente-api.vercel.app/api/get-available-slots", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({
                                            action: "save_service_booking",
                                            vendorId: vendorId,
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
                                            bookedForResourceId: vendorId,
                                            appointmentCode: "WA_" + Date.now().toString().slice(-4),
                                            type: "cura_persona"
                                        })
                                    });

                                    if (saveBookingRes.ok) {
                                        toolResultPayload = {
                                            esito: "SUCCESSO",
                                            dettagli: { servizio: bookServiceName, data: bookDateStr, ora: bookTimeStr, prezzo: bookPrice },
                                            messaggio: "Posto bloccato con successo sul calendario!"
                                        };
                                    } else {
                                        toolResultPayload = { esito: "ERRORE", motivo: "Orario non più disponibile" };
                                    }
                                } catch(saveErr) {
                                    toolResultPayload = { esito: "ERRORE", motivo: saveErr.message };
                                }
                            }

                            // Chiamata di sintesi finale dell'AI per parlare al cliente
                            messagesPayload.push(messageObj);
                            messagesPayload.push({
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
                                    messages: messagesPayload,
                                    tools: salonTools,
                                    temperature: 0.4,
                                    max_tokens: 750
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

            // Salvataggio memoria e aggiornamento stato chat
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

            // Invio effettivo del messaggio su WhatsApp
            await sendWhatsAppMessage(aiReply);
            return res.status(200).json({ success: true, client: clientFullName, reply: aiReply });
        }

        // =========================================================================
        // 🔒 BLOCCO COPYWRITER MARKETING PER I POST (SIGILLATO)
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
