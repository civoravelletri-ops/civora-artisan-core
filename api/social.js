module.exports = async function handler(req, res) {
    // Permetti al tuo sito di chiamare questa funzione (CORS)
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
        // 🤖 PILOTA AUTOMATICO WHATSAPP 24/7 (INGEGNERIA CIVORA BUSINESS)
        // =========================================================================
        if (body.isWhatsAppAutoPilot && body.vendorId) {
            const vendorId = body.vendorId;
            const senderPhone = body.senderPhone || '';
            const senderJid = body.senderJid || body.senderPhone || '';
            const pushName = (body.pushName || '').trim();
            const messageText = (body.messageText || "").trim();

            // Data e ora passate dal server
            const messageTime = body.messageTime || new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
            const todayRome = body.messageDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
            const todayReadable = body.messageDateReadable || new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });

            if (!messageText) {
                return res.status(200).json({ status: "skipped", reason: "Messaggio vuoto" });
            }

            console.log(`[AutoPilot] 📩 Ricevuta busta da "${pushName}" (${senderPhone}) alle ${messageTime}: "${messageText}"`);

            const API_BASE_URL = 'https://localmente-api.vercel.app/api/get-available-slots';
            const GATEWAY_BASE_URL = (process.env.CIVORA_WHATSAPP_GATEWAY_URL || 'https://civora-whatsapp-gateway.onrender.com').replace(/\/+$/, '');

            // 1. RECUPERO CONTESTO SALONE DAL DATABASE
            let contextData = {
                storeInfo: { name: 'Il nostro salone', address: '', phone: '', opening_hours: '', whatsapp_ai_autopilot: false, whatsapp_connected: false },
                services: [],
                products: [],
                client: { name: '', address: '', isKnown: false, phone: senderPhone },
                chatHistory: []
            };

            try {
                const ctxRes = await fetch(API_BASE_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'get_autopilot_context',
                        vendorId: vendorId,
                        customerPhone: senderPhone
                    })
                });
                if (ctxRes.ok) {
                    const fetchedCtx = await ctxRes.json();
                    if (fetchedCtx.success) {
                        contextData = fetchedCtx;
                    }
                }
            } catch (ctxErr) {
                console.error("[AutoPilot] ⚠️ Eccezione recupero contesto:", ctxErr.message);
            }

            // 🛑 CONTROLLO TELECOMANDO DASHBOARD
            if (contextData.storeInfo.whatsapp_ai_autopilot !== true || contextData.storeInfo.whatsapp_connected !== true) {
                console.log(`[AutoPilot] 🛑 Pilota automatico DISATTIVATO dal negoziante per ${vendorId}.`);
                return res.status(200).json({ status: "skipped", reason: "Pilota automatico non attivo" });
            }

            // Calcolo di Domani
            const tomorrowObj = new Date(todayRome + 'T12:00:00Z');
            tomorrowObj.setUTCDate(tomorrowObj.getUTCDate() + 1);
            const tomorrowRome = tomorrowObj.toISOString().split('T')[0];
            const tomorrowReadable = tomorrowObj.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });

            // Identificazione del Nome del Cliente (priorità: Rubrica Salone -> Profilo WhatsApp)
            const recognizedClientName = contextData.client?.name || pushName || '';
            const isKnownRegular = contextData.client?.isKnown === true;
            const savedClientAddress = contextData.client?.address || '';
            const lastClientService = contextData.client?.lastService || '';
            const salonName = contextData.storeInfo?.name || 'Salone';
            const salonAddress = contextData.storeInfo?.address || '';
            const salonHours = contextData.storeInfo?.opening_hours || 'Orario continuato';
            const hasRecentChatHistory = contextData.chatHistory && Array.isArray(contextData.chatHistory) && contextData.chatHistory.length > 0;

            // 🔍 FILTRO INTELLIGENTE SERVIZI: MOSTRA AL MASSIMO 5-6 SERVIZI PERTINENTI!
            function getMatchingServicesForQuery(text, allServices) {
                const q = (text || "").toLowerCase();
                if (!q) return allServices.slice(0, 5);

                if (q.includes("tagli") || q.includes("capell") || q.includes("sfumat") || q.includes("fade") || q.includes("piega")) {
                    const hair = allServices.filter(s => {
                        const n = (s.name || "").toLowerCase();
                        return n.includes("tagli") || n.includes("sfumat") || n.includes("fade") || n.includes("styling");
                    });
                    if (hair.length > 0) return hair.slice(0, 5);
                }

                if (q.includes("barb") || q.includes("rasatur")) {
                    const beard = allServices.filter(s => (s.name || "").toLowerCase().includes("barb") || (s.name || "").toLowerCase().includes("rasatur"));
                    if (beard.length > 0) return beard.slice(0, 5);
                }

                if (q.includes("color") || q.includes("tinta") || q.includes("balayage") || q.includes("meches")) {
                    const col = allServices.filter(s => {
                        const n = (s.name || "").toLowerCase();
                        return n.includes("color") || n.includes("balayage") || n.includes("meches") || n.includes("tinta");
                    });
                    if (col.length > 0) return col.slice(0, 5);
                }

                return allServices.slice(0, 5);
            }

            const servicesListText = contextData.services.slice(0, 15).map(s => `- ${s.name} (Prezzo: ${s.price}€, ID: "${s.id}")`).join('\n');
            const productsListText = (contextData.products && contextData.products.length > 0)
                ? contextData.products.slice(0, 8).map(p => `- ${p.name} (${p.price}€)`).join('\n')
                : '- Prodotti professionali da asporto.';

            let historyText = "";
            let lastAssistantMsg = "";
            if (hasRecentChatHistory) {
                historyText = "\nSTORICO CHAT RECENTE:\n" +
                    contextData.chatHistory.map(m => {
                        if (m.role === 'assistant') lastAssistantMsg = m.content;
                        return m.role === 'assistant' ? `Tu: ${m.content}` : `Cliente: ${m.content}`;
                    }).join('\n') + "\n";
            }

            // 🔢 RADAR SELEZIONE NUMERICA (es. "37", "il 2", "scelgo 1")
            let numberSelectedServiceName = null;
            let numberSelectedProductName = null;
            const numberMatch = messageText.match(/\b(?:numero|il|scelgo|prendo)?\s*([1-9]|[1-3][0-9]|40|41)\b/i);

            if (numberMatch && lastAssistantMsg) {
                const chosenNum = parseInt(numberMatch[1], 10);
                const emojiNum = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"][chosenNum - 1];
                
                const regexNum = new RegExp(`(?:${emojiNum || chosenNum}\\.?|${chosenNum}\\.|${chosenNum}\\))\\s*\\*?([^*\\n(]+)\\*?`, 'i');
                const foundItem = lastAssistantMsg.match(regexNum);

                if (foundItem && foundItem[1]) {
                    const itemName = foundItem[1].trim();
                    console.log(`[AutoPilot] 🎯 Selezione numerica intercettata: ${chosenNum} -> "${itemName}"`);

                    const matchedServ = contextData.services.find(s => s.name.toLowerCase() === itemName.toLowerCase() || s.name.toLowerCase().includes(itemName.toLowerCase()));
                    const matchedProd = contextData.products && contextData.products.find(p => p.name.toLowerCase() === itemName.toLowerCase() || p.name.toLowerCase().includes(itemName.toLowerCase()));

                    if (matchedServ) numberSelectedServiceName = matchedServ.name;
                    else if (matchedProd) numberSelectedProductName = matchedProd.name;
                }
            }

            // PROMPT DEL DIRETTORE
            const autoPilotSystemPrompt = `Sei l'assistente WhatsApp del salone "${salonName}".
Oggi è ${todayReadable} (${todayRome}), ore ${messageTime}.

DATI ATTIVITÀ:
- Nome Salone: ${salonName}
- Indirizzo: ${salonAddress || 'in salone'}
- Orari: ${salonHours}
${recognizedClientName ? `- Nome Cliente: "${recognizedClientName}" (${isKnownRegular ? 'Cliente abituale' : 'Nuovo contatto'}).` : '- Cliente: Nome non noto.'}
${lastClientService ? `- Ultimo servizio fatto: "${lastClientService}".` : ''}

SERVIZI REALI SALONE:
${servicesListText}

PRODOTTI IN VENDITA:
${productsListText}

${historyText}

🛑 REGOLE WHATSAPP (MASSIMO 2 RIGHE):
1. SE IL CLIENTE CHIEDE CONFERMA IDENTITÀ (es. "siete voi Mr Barber?", "chi siete?"):
   - Conferma con gioia: "Ciao! 👋 Sì, esattamente! Sei in contatto con ${salonName}. Come possiamo aiutarti oggi? ✂️"
2. SE CHIEDE DOVE SIETE O ORARI (es. "dove siete?", "a che ora chiudete?"):
   - Rispondi con via e orari precisi.
3. SE CHIEDE DISPONIBILITÀ A FREDDO (es. "c'è posto oggi?", "posso prenotare?"):
   - Rispondi che c'è disponibilità e chiedi che trattamento vorrebbe fare (senza mostrare elenchi lunghi!).
4. SE CHIEDE DEI PRODOTTI (es. "vendi prodotti", "avete cere?"):
   - intent: "order_product". Elenca 2 o 3 prodotti principali con prezzo.

Rispondi ESCLUSIVAMENTE con questo JSON:
{
 "intent": "ask_availability",
 "customerName": "${recognizedClientName}",
 "productOrdered": "${numberSelectedProductName || ''}",
 "deliveryAddress": "",
 "date": "${todayRome}",
 "time": "",
 "serviceId": "",
 "serviceName": "${numberSelectedServiceName || ''}",
 "replyText": "risposta cortissima per WhatsApp"
}`;

            const groqMessages = [
                { role: "system", content: autoPilotSystemPrompt },
                { role: "user", content: messageText }
            ];

            let extracted = {
                intent: numberSelectedServiceName ? "ask_availability" : (numberSelectedProductName ? "order_product" : "general_greeting"),
                customerName: recognizedClientName,
                productOrdered: numberSelectedProductName || "",
                deliveryAddress: "",
                date: todayRome,
                time: "",
                serviceId: "",
                serviceName: numberSelectedServiceName || "",
                replyText: ""
            };

            const GROQ_CANDIDATES = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
            let aiSuccess = false;

            for (const modelId of GROQ_CANDIDATES) {
                try {
                    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${GROQ_API_KEY}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            model: modelId,
                            messages: groqMessages,
                            temperature: 0.1,
                            max_tokens: 500
                        })
                    });

                    if (groqRes.ok) {
                        const groqData = await groqRes.json();
                        let rawContent = groqData.choices?.[0]?.message?.content || "{}";

                        let cleanJson = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
                        cleanJson = cleanJson.replace(/```json/gi, "").replace(/```/g, "").trim();
                        const firstBrace = cleanJson.indexOf('{');
                        const lastBrace = cleanJson.lastIndexOf('}');
                        if (firstBrace !== -1 && lastBrace !== -1) {
                            cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
                        }

                        const parsed = JSON.parse(cleanJson);
                        extracted = { ...extracted, ...parsed };

                        if (numberSelectedServiceName) {
                            extracted.serviceName = numberSelectedServiceName;
                            extracted.intent = "ask_availability";
                        }
                        aiSuccess = true;
                        break;
                    }
                } catch (pErr) {
                    console.warn(`[AutoPilot] ⚠️ Eccezione su ${modelId}:`, pErr.message);
                }
            }

            // Recupero data/ora se sta confermando
            if (extracted.intent === "confirm_booking" && lastAssistantMsg) {
                const dateMatch = lastAssistantMsg.match(/\b(\d{1,2})\/(\d{1,2})\b/);
                if (dateMatch) {
                    const currentYear = new Date().getFullYear();
                    extracted.date = `${currentYear}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`;
                }
                if (!extracted.time) {
                    const timeMatch = lastAssistantMsg.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/);
                    if (timeMatch) extracted.time = timeMatch[0];
                }
                const serviceNameMatch = lastAssistantMsg.match(/\*([^*\n]+)\*/);
                if (serviceNameMatch && serviceNameMatch[1]) {
                    const foundService = contextData.services.find(s => s.name.toLowerCase().includes(serviceNameMatch[1].trim().toLowerCase()));
                    if (foundService) {
                        extracted.serviceId = foundService.id;
                        extracted.serviceName = foundService.name;
                    }
                }
            }

            let finalReply = extracted.replyText;
            const displayName = extracted.customerName || recognizedClientName || '';
            const lowerMsg = messageText.toLowerCase();

            // =========================================================================
            // 🎯 SMISTAMENTO INTELLIGENTE DEI PRIMI CONTATTI (REALTÀ AL 100%)
            // =========================================================================

            // 1. DOMANDA DI IDENTITÀ ("Siete voi Mr Barber?", "Chi siete?", "È il salone?")
            const asksIdentity = (lowerMsg.includes("siete voi") || lowerMsg.includes("chi sei") || lowerMsg.includes("è il salone") || lowerMsg.includes("parlo con") || lowerMsg.includes("ho preso il numero"));
            
            // 2. DOMANDA DI DOVE SIETE / ORARI
            const asksLocationOrHours = (lowerMsg.includes("dove siete") || lowerMsg.includes("indirizzo") || lowerMsg.includes("a che ora") || lowerMsg.includes("siete aperti") || lowerMsg.includes("quando aprite"));

            // 3. DOMANDA PRODOTTI
            const asksProducts = lowerMsg.includes("prodott") || lowerMsg.includes("compra") || lowerMsg.includes("ordin") || lowerMsg.includes("cera") || lowerMsg.includes("shampoo");

            if (asksIdentity && !lowerMsg.includes("prenotare")) {
                finalReply = `Ciao ${displayName ? displayName + ' ' : ''}! 👋 Sì, esattamente! Sei in contatto con *${salonName}*. Come possiamo aiutarti oggi? ✂️`;
            }
            else if (asksLocationOrHours && !lowerMsg.includes("prenotare")) {
                finalReply = `Siamo in *${salonAddress || 'in salone'}*! 📍\nOrari: ${salonHours}. Ti serviva prenotare un appuntamento? ✂️`;
            }
            else if (asksProducts && !extracted.time) {
                if (lowerMsg.includes("vendi") || lowerMsg.includes("quali") || lowerMsg.includes("avete")) {
                    const prods = (contextData.products || []).slice(0, 3).map((p, idx) => `${idx + 1}️⃣ *${p.name}* (${p.price}€)`).join('\n');
                    finalReply = `Sì! Abbiamo prodotti professionali disponibili:\n\n${prods}\n\nQuale ti interessa provare? 🧴`;
                } else {
                    let deliveryAddress = extracted.deliveryAddress || savedClientAddress || "";
                    const addrMatch = messageText.match(/(?:via|viale|corso|piazza)\s+[^,\n.]+/i);
                    if (addrMatch) deliveryAddress = addrMatch[0].trim();

                    if (deliveryAddress) {
                        finalReply = `Perfetto! Ricevuto ordine per *${deliveryAddress}*. Totale con consegna rapida a Velletri: 2,99€ in contanti al corriere. A presto! 🚚✨`;
                    } else {
                        finalReply = `Ottima scelta! Per la consegna a domicilio a Velletri (2,99€ con pagamento in contanti al rider), a quale indirizzo dobbiamo consegnare? 🛵`;
                    }
                }
            }
            // =========================================================================
            // ✂️ GESTIONE APPUNTAMENTO (CON CONTROLLO DOMANI AUTOMATICO)
            // =========================================================================
            else {
                let matchedService = null;

                if (extracted.serviceName) {
                    matchedService = contextData.services.find(s => s.name.toLowerCase().includes(extracted.serviceName.toLowerCase())) || null;
                }
                if (!matchedService) {
                    matchedService = contextData.services.find(s => lowerMsg.includes(s.name.toLowerCase())) || null;
                }

                const isGenericQuestion = (lowerMsg.includes("prenotare") || lowerMsg.includes("posto") || lowerMsg.includes("appuntamento")) && !matchedService && !lowerMsg.includes("tagli") && !lowerMsg.includes("barb") && !lowerMsg.includes("color");

                // Se chiede solo "posso prenotare", NON vomitare 40 servizi! Chiedi che trattamento vuole
                if (isGenericQuestion) {
                    finalReply = `Ciao ${displayName ? displayName + ' ' : ''}! 👋 Certamente, abbiamo disponibilità. Cosa vorresti fare? (Es. *Taglio*, *Barba*, *Colore* o *Trattamenti*) ✂️`;
                }
                // Se chiede il taglio generico, mostra i 4-5 tagli veri con i numeri
                else if (!matchedService && (lowerMsg.includes("tagli") || lowerMsg.includes("capell") || extracted.intent === "clarify_service")) {
                    const cuts = getMatchingServicesForQuery(messageText, contextData.services);
                    const emojiNums = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
                    const menu = cuts.map((s, idx) => `${emojiNums[idx]} *${s.name}* (${s.price}€)`).join('\n');
                    finalReply = `Per i capelli abbiamo queste opzioni:\n\n${menu}\n\nRispondi con il *numero* (es. 1) o con il nome! ✂️`;
                }
                // Servizio identificato -> Controllo orari
                else if (matchedService) {
                    let targetDate = extracted.date || todayRome;
                    
                    // Se l'assistente aveva detto che oggi era pieno e il cliente dice "sì" o "ok", guarda domani!
                    if ((lowerMsg === "si" || lowerMsg === "sì" || lowerMsg === "ok") && lastAssistantMsg && (lastAssistantMsg.includes("completo") || lastAssistantMsg.includes("pieni"))) {
                        targetDate = tomorrowRome;
                    }

                    let availableSlots = [];
                    try {
                        const slotsRes = await fetch(API_BASE_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                action: 'getAvailableSlots',
                                vendorId: vendorId,
                                serviceId: matchedService.id,
                                date: targetDate
                            })
                        });
                        if (slotsRes.ok) {
                            const slotsJson = await slotsRes.json();
                            availableSlots = slotsJson.slots || [];
                        }
                    } catch (e) {}

                    // CASO A: IL CLIENTE CONFERMA L'ORARIO
                    if (extracted.intent === "confirm_booking" && extracted.time) {
                        try {
                            const durationMins = matchedService.duration || 30;
                            const dummyDate = new Date(`${targetDate}T12:00:00Z`);
                            const romeLoc = dummyDate.toLocaleString("en-US", { timeZone: "Europe/Rome" });
                            const utcLoc = dummyDate.toLocaleString("en-US", { timeZone: "UTC" });
                            const offsetMins = (new Date(utcLoc) - new Date(romeLoc)) / 60000;

                            const startMs = new Date(`${targetDate}T${extracted.time}:00Z`).getTime() + (offsetMins * 60000);
                            const startDateTime = new Date(startMs);
                            const endDateTime = new Date(startMs + durationMins * 60000);

                            const bookPayload = {
                                action: 'save_service_booking',
                                vendorId: vendorId,
                                customerName: displayName || ("Cliente (" + senderPhone.slice(-4) + ")"),
                                customerPhone: senderPhone,
                                serviceId: matchedService.id,
                                bookedServiceName: matchedService.name,
                                bookedServicePrice: matchedService.price || 0,
                                bookedServiceDuration: durationMins,
                                bookedTotalOccupiedTime: durationMins,
                                startDateTime: startDateTime.toISOString(),
                                endDateTime: endDateTime.toISOString(),
                                status: 'confirmed',
                                source: 'whatsapp_ai_autopilot',
                                appointmentCode: 'WA_' + Date.now().toString().slice(-4),
                                type: 'cura_persona'
                            };

                            const saveRes = await fetch(API_BASE_URL, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(bookPayload)
                            });

                            if (saveRes.ok) {
                                finalReply = `🎉 Perfetto! Ti confermo l'appuntamento per *${matchedService.name}* alle *${extracted.time}*. Ti abbiamo inserito in agenda, a presto! ✂️✨`;
                            } else {
                                finalReply = `Purtroppo lo slot delle ${extracted.time} è stato appena occupato. Vuoi un altro orario?`;
                            }
                        } catch (bErr) {
                            finalReply = `Ho preso nota per le ${extracted.time}, ti confermo tutto a breve!`;
                        }
                    }
                    // CASO B: CHIEDE GLI ORARI (SE OGGI È PIENO, CONTROLLA DOMANI IN AUTOMATICO!)
                    else {
                        if (availableSlots.length > 0) {
                            const alts = availableSlots.slice(0, 4).join(', ');
                            finalReply = `Perfetto per *${matchedService.name}*! Ho liberi questi orari: *${alts}*. Quale preferisci? ✂️`;
                        } else {
                            // OGGI È PIENO: CONTROLLA AUTOMATICAMENTE DOMANI SENZA FARE DOMANDE!
                            let tomorrowSlots = [];
                            try {
                                const tomRes = await fetch(API_BASE_URL, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        action: 'getAvailableSlots',
                                        vendorId: vendorId,
                                        serviceId: matchedService.id,
                                        date: tomorrowRome
                                    })
                                });
                                if (tomRes.ok) {
                                    const tomJson = await tomRes.json();
                                    tomorrowSlots = tomJson.slots || [];
                                }
                            } catch (e) {}

                            if (tomorrowSlots.length > 0) {
                                const tomAlts = tomorrowSlots.slice(0, 4).join(', ');
                                finalReply = `Per oggi siamo al completo per *${matchedService.name}*, ma per domani (${tomorrowReadable}) ho liberi: *${tomAlts}*. Ti andrebbe bene uno di questi? ✂️`;
                            } else {
                                finalReply = `Per oggi e domani siamo al completo per *${matchedService.name}*. Per quale data preferisci controllare?`;
                            }
                        }
                    }
                }
            }

            // 3. SALVATAGGIO MEMORIA
            try {
                await fetch(API_BASE_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'save_autopilot_message',
                        vendorId: vendorId,
                        customerPhone: senderPhone,
                        userMessage: messageText,
                        aiReply: finalReply,
                        customerName: displayName
                    })
                });
            } catch (saveMemErr) {}

            // 4. INVIO WHATSAPP VIA GATEWAY ALL'INDIRIZZO ESATTO
            try {
                await fetch(`${GATEWAY_BASE_URL}/send-message`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        vendorId: vendorId,
                        phone: senderJid || senderPhone,
                        message: finalReply
                    })
                });
            } catch (sendErr) {
                console.error("[AutoPilot] ⚠️ Errore invio Gateway:", sendErr.message);
            }

            return res.status(200).json({ success: true, processed: true, reply: finalReply });
        }
        // =========================================================================

        const contesto = body.contesto;
        if (!contesto) {
            return res.status(400).json({ errore: "Dati di contesto mancanti nella richiesta." });
        }

        const isLowStock = contesto.quantita > 0 && contesto.quantita <= 3;
        const hasDiscount = contesto.originalPrice && contesto.originalPrice > (contesto.prezzo || 0);
        const discountPercent = hasDiscount ? Math.round(((contesto.originalPrice - contesto.prezzo) / contesto.originalPrice) * 100) : 0;

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
