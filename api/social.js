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

            const messageTime = body.messageTime || new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
            const todayRome = body.messageDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
            const todayReadable = body.messageDateReadable || new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });

            if (!messageText) {
                return res.status(200).json({ status: "skipped", reason: "Messaggio vuoto" });
            }

            console.log(`[AutoPilot] 📩 Ricevuto da "${pushName}" (${senderPhone}) alle ${messageTime}: "${messageText}"`);

            const API_BASE_URL = 'https://localmente-api.vercel.app/api/get-available-slots';
            const GATEWAY_BASE_URL = (process.env.CIVORA_WHATSAPP_GATEWAY_URL || 'https://civora-whatsapp-gateway.onrender.com').replace(/\/+$/, '');

            // 1. RECUPERO CONTESTO SALONE DAL MOTORE CENTRALE
            let contextData = {
                storeInfo: { 
                    name: 'Il nostro salone', 
                    address: '', 
                    phone: '', 
                    opening_hours: '',
                    public_opening_hours_structured: [],
                    special_opening_hours: [],
                    specializations: [],
                    parkingTips: '',
                    directions: '',
                    whatsapp_ai_autopilot: false, 
                    whatsapp_connected: false 
                },
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

            // 🛑 CONTROLLO TELECOMANDO
            if (contextData.storeInfo.whatsapp_ai_autopilot !== true || contextData.storeInfo.whatsapp_connected !== true) {
                console.log(`[AutoPilot] 🛑 Pilota automatico DISATTIVATO dal negoziante per ${vendorId}.`);
                return res.status(200).json({ status: "skipped", reason: "Pilota automatico non attivo" });
            }

            // 📅 FUNZIONI CALENDARIO E CHIUSURE SALONE
            const daysMap = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
            const hoursSource = contextData.storeInfo.public_opening_hours_structured || contextData.storeInfo.opening_hours_structured || [];
            const specialHoursList = contextData.storeInfo.special_opening_hours || [];

            function isSalonClosedOnDate(dateStr) {
                const dObj = new Date(dateStr + "T12:00:00Z");
                const dayShort = daysMap[dObj.getUTCDay()];
                const specialMatch = specialHoursList.find(s => s.startDate <= dateStr && s.endDate >= dateStr);
                if (specialMatch) {
                    return specialMatch.isClosedAllDay === true;
                }
                if (hoursSource.length > 0) {
                    const dayConfig = hoursSource.find(d => d.day === dayShort);
                    if (dayConfig && (dayConfig.isOpen === false || !dayConfig.slots || dayConfig.slots.length === 0)) {
                        return true;
                    }
                }
                return false;
            }

            function getNextOpenDate(fromDateStr) {
                const baseDate = new Date(fromDateStr + "T12:00:00Z");
                for (let i = 1; i <= 7; i++) {
                    const testD = new Date(baseDate);
                    testD.setUTCDate(baseDate.getUTCDate() + i);
                    const testDateStr = testD.toISOString().split('T')[0];

                    if (!isSalonClosedOnDate(testDateStr)) {
                        const readable = testD.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });
                        return { dateStr: testDateStr, dayName: daysMap[testD.getUTCDay()], readable: readable, daysAhead: i };
                    }
                }
                const tomorrowD = new Date(baseDate);
                tomorrowD.setUTCDate(baseDate.getUTCDate() + 1);
                return { dateStr: tomorrowD.toISOString().split('T')[0], dayName: 'Domani', readable: 'domani', daysAhead: 1 };
            }

            const nextOpen = getNextOpenDate(todayRome);

            const recognizedClientName = contextData.client?.name || pushName || '';
            const isKnownRegular = contextData.client?.isKnown === true;
            const savedClientAddress = contextData.client?.address || '';
            const lastClientService = contextData.client?.lastService || '';
            const salonName = contextData.storeInfo?.name || 'Salone';
            const salonAddress = contextData.storeInfo?.address || '';
            const salonHours = contextData.storeInfo?.opening_hours || 'Orario continuato';
            const salonSpecs = (contextData.storeInfo?.specializations || []).join(', ');
            const salonParking = contextData.storeInfo?.parkingTips || '';
            const hasRecentChatHistory = contextData.chatHistory && Array.isArray(contextData.chatHistory) && contextData.chatHistory.length > 0;

            // 🔍 FILTRO INTELLIGENTE SERVIZI (MAX 5 OPZIONI PERTINENTI)
            function getMatchingServicesForQuery(text, allServices) {
                const q = (text || "").toLowerCase();
                if (!q) return allServices.slice(0, 5);

                if (q.includes("tagli") || q.includes("capell") || q.includes("sfumat") || q.includes("fade") || q.includes("piega") || q.includes("al volo")) {
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
                ? contextData.products.slice(0, 6).map(p => `- ${p.name} (${p.price}€)`).join('\n')
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
Il prossimo giorno di apertura è ${nextOpen.readable} (${nextOpen.dateStr}).

DATI ATTIVITÀ:
- Nome Salone: ${salonName}
- Indirizzo esatto: ${salonAddress || 'in salone'}
- Orari apertura: ${salonHours}
- Specializzazioni del salone: ${salonSpecs || 'Tagli moderni, sfumature, barba e trattamenti capelli'}
${salonParking ? `- Consigli parcheggio: ${salonParking}` : ''}
${recognizedClientName ? `- Nome Cliente: "${recognizedClientName}" (${isKnownRegular ? 'Cliente abituale' : 'Nuovo contatto'}).` : '- Cliente: Nuovo.'}
${lastClientService ? `- Ultimo servizio fatto: "${lastClientService}".` : ''}

SERVIZI SALONE:
${servicesListText}

PRODOTTI IN VENDITA:
${productsListText}

${historyText}

🛑 REGOLE RIGIDE DI CONVERSAZIONE (MAX 2 RIGHE):
1. COMPRENDI SLANG E DIALETTO: Capisci espressioni colloquiali ("al volo", "me poi prenota", "wee bella", "un buco"). Rispondi con calore e naturalezza.
2. BREVITÀ: Rispondi in MASSIMO 2 o 3 righe corte.
3. DOMANDE DI IDENTITÀ (es. "siete voi Mr Barber?", "chi sei?"):
   - Conferma subito: "Ciao! 👋 Sì, esattamente! Sei in contatto con ${salonName}. Come possiamo aiutarti? ✂️"
4. DOMANDE MULTIPLE (es. "dove siete, in cosa siete specializzati, avete posto?"):
   - Rispondi in un solo messaggio sintetico toccando tutti i punti.

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
 "replyText": "risposta brevissima per WhatsApp"
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

            // Recupero data/ora dal messaggio precedente se sta confermando
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

            // 🧹 Puliamo la risposta togliendo eventuali spazi vuoti che causavano l'errore del Ciao!
            let finalReply = (extracted.replyText || "").trim();
            const displayName = extracted.customerName || recognizedClientName || '';
            const lowerMsg = messageText.toLowerCase();
            const cleanText = lowerMsg.replace(/[^\w\s]/gi, '').trim();

            // =========================================================================
            // 🎯 SMISTAMENTO NATURALE DEI MESSAGGI REALI
            // =========================================================================

            // 0. SALUTI PURI E SEMPLICI ("Ciao", "Buongiorno", "Salve")
            const isJustGreeting = cleanText === "ciao" || cleanText === "buongiorno" || cleanText === "buonasera" || cleanText === "salve" || cleanText === "hey" || cleanText === "ehi";

            // 1. IDENTITÀ
            const asksIdentity = (lowerMsg.includes("siete voi") || lowerMsg.includes("chi sei") || lowerMsg.includes("è il salone") || lowerMsg.includes("parlo con") || lowerMsg.includes("ho preso il numero"));

            // 2. ORARI E INFO
            const asksWhereOrWhen = (lowerMsg.includes("dove siete") || lowerMsg.includes("indirizzo") || lowerMsg.includes("a che ora") || lowerMsg.includes("aperti") || lowerMsg.includes("parcheggi") || lowerMsg.includes("specializzat"));

            // 3. PRODOTTI
            const asksProducts = lowerMsg.includes("prodott") || lowerMsg.includes("compra") || lowerMsg.includes("ordin") || lowerMsg.includes("cera") || lowerMsg.includes("shampoo");

            if (isJustGreeting) {
                finalReply = `Ciao ${displayName ? displayName + ' ' : ''}! 👋 Benvenuto da ${salonName}. Come possiamo aiutarti oggi? (Vuoi prenotare un appuntamento o ti servono info?) ✂️`;
            }
            else if (asksIdentity && !lowerMsg.includes("prenot") && !lowerMsg.includes("tagli")) {
                finalReply = `Ciao! 👋 Sì, esattamente! Sei in contatto con *${salonName}*. Come possiamo aiutarti oggi? ✂️`;
            }
            else if (asksWhereOrWhen && !lowerMsg.includes("prenot") && !lowerMsg.includes("posto") && !lowerMsg.includes("tagli")) {
                let infoParts = [];
                if (lowerMsg.includes("dove") || lowerMsg.includes("indirizzo")) infoParts.push(`📍 Siamo in *${salonAddress || 'in salone'}*`);
                if (lowerMsg.includes("ora") || lowerMsg.includes("apert")) infoParts.push(`🕒 Orari: ${salonHours}`);
                if (lowerMsg.includes("parchegg") && salonParking) infoParts.push(`🚗 Parcheggio: ${salonParking}`);
                if (lowerMsg.includes("specializzat") && salonSpecs) infoParts.push(`✨ Specialità: ${salonSpecs}`);

                finalReply = infoParts.length > 0 ? infoParts.join('\n') + `\nTi serviva fissare un appuntamento? ✂️` : finalReply;
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
            // ✂️ GESTIONE APPUNTAMENTO
            // =========================================================================
            else {
                let matchedService = null;

                if (extracted.serviceName) {
                    matchedService = contextData.services.find(s => s.name.toLowerCase().includes(extracted.serviceName.toLowerCase())) || null;
                }
                if (!matchedService) {
                    matchedService = contextData.services.find(s => lowerMsg.includes(s.name.toLowerCase())) || null;
                }

                const isGenericQuestion = (lowerMsg.includes("prenotare") || lowerMsg.includes("posto") || lowerMsg.includes("appuntamento") || lowerMsg.includes("c'è posto") || lowerMsg.includes("ce posto")) && !matchedService && !lowerMsg.includes("tagli") && !lowerMsg.includes("barb") && !lowerMsg.includes("color") && !lowerMsg.includes("al volo");

                if (isGenericQuestion) {
                    finalReply = `Ciao ${displayName ? displayName + ' ' : ''}! 👋 Certamente, abbiamo disponibilità. Cosa vorresti fare? (Es. *Taglio*, *Barba* o *Trattamenti*) ✂️`;
                }
                else if (!matchedService && (lowerMsg.includes("tagli") || lowerMsg.includes("capell") || lowerMsg.includes("al volo") || extracted.intent === "clarify_service")) {
                    const cuts = getMatchingServicesForQuery(messageText, contextData.services);
                    const emojiNums = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
                    const menu = cuts.map((s, idx) => `${emojiNums[idx]} *${s.name}* (${s.price}€)`).join('\n');
                    finalReply = `Per i capelli abbiamo queste opzioni:\n\n${menu}\n\nRispondi con il *numero* (es. 1 o 2) o con il nome! ✂️`;
                }
                else if (matchedService) {
                    let targetDate = extracted.date || todayRome;
                    
                    if ((lowerMsg === "si" || lowerMsg === "sì" || lowerMsg === "ok") && lastAssistantMsg && (lastAssistantMsg.includes("completo") || lastAssistantMsg.includes("pieni") || lastAssistantMsg.includes("chiusi"))) {
                        targetDate = nextOpen.dateStr;
                    }

                    if (isSalonClosedOnDate(targetDate)) {
                        finalReply = `Il salone è chiuso in quella data per riposo! 🛋️ Riapriamo *${nextOpen.readable}*: vuoi che ti controlli gli orari per quel giorno? ✂️`;
                    } else {
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
                                    customerName: displayName || ("Cliente (" + cleanClientPhone.slice(-4) + ")"),
                                    customerPhone: cleanClientPhone,
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
                        else {
                            if (availableSlots.length > 0) {
                                const alts = availableSlots.slice(0, 4).join(', ');
                                const alVoloText = lowerMsg.includes("al volo") ? `Al volo per oggi ho liberi: *${alts}*. Ti blocco il primo? ✂️` : `Perfetto per *${matchedService.name}*! Ho liberi questi orari: *${alts}*. Quale preferisci? ✂️`;
                                finalReply = alVoloText;
                            } else {
                                let nextDaySlots = [];
                                try {
                                    const nextRes = await fetch(API_BASE_URL, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            action: 'getAvailableSlots',
                                            vendorId: vendorId,
                                            serviceId: matchedService.id,
                                            date: nextOpen.dateStr
                                        })
                                    });
                                    if (nextRes.ok) {
                                        const nextJson = await nextRes.json();
                                        nextDaySlots = nextJson.slots || [];
                                    }
                                } catch (e) {}

                                if (nextDaySlots.length > 0) {
                                    const nextAlts = nextDaySlots.slice(0, 4).join(', ');
                                    finalReply = `Per oggi siamo al completo per *${matchedService.name}*!\nPer *${nextOpen.readable}* ho liberi: *${nextAlts}*. Ti andrebbe bene uno di questi? ✂️`;
                                } else {
                                    finalReply = `Siamo al completo per *${matchedService.name}*. Per quale giorno preferisci che ti controlli? ✂️`;
                                }
                            }
                        }
                    }
                } else {
                    // SE L'UTENTE DICE COSE A CASO E NON SCATTANO LE ALTRE REGOLE
                    if (!finalReply) {
                        finalReply = `Scusami, non ho capito bene! Puoi dirmi cosa vorresti fare? (Es. Prenotare un *Taglio*, *Barba* o avere info sulle *Promozioni*) ✂️`;
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

            // 4. INVIO WHATSAPP VIA GATEWAY
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
