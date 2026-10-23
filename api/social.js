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

        // FASE 0: VERIFICA PRESENZA CHIAVE API
        if (!GROQ_API_KEY) {
            return res.status(500).json({ errore: "Manca la chiave d'accesso GROQ_API_KEY nelle variabili d'ambiente di Vercel." });
        }

        // =========================================================================
        // 🤖 PILOTA AUTOMATICO WHATSAPP 24/7 (INGEGNERIA CIVORA BUSINESS)
        // =========================================================================
        if (body.isWhatsAppAutoPilot && body.vendorId && body.senderPhone) {
            const vendorId = body.vendorId;
            const senderPhone = body.senderPhone;
            const messageText = (body.messageText || "").trim();

            if (!messageText) {
                return res.status(200).json({ status: "skipped", reason: "Messaggio vuoto" });
            }

            console.log(`[AutoPilot] 🚀 Nuovo messaggio da ${senderPhone}: "${messageText}"`);

            const API_BASE_URL = 'https://localmente-api.vercel.app/api/get-available-slots';
            const GATEWAY_BASE_URL = (process.env.CIVORA_WHATSAPP_GATEWAY_URL || 'https://civora-whatsapp-gateway.onrender.com').replace(/\/+$/, '');

            // 1. RECUPERO CONTESTO SALONE DAL MOTORE CENTRALE
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
                        console.log(`[AutoPilot] 🧠 Contesto: Cliente "${contextData.client?.name || 'Nuovo'}", Servizi attivi: ${contextData.services.length}, Prodotti: ${contextData.products?.length || 0}`);
                    }
                }
            } catch (ctxErr) {
                console.error("[AutoPilot] ⚠️ Eccezione recupero contesto:", ctxErr.message);
            }

            // 🛑 CONTROLLO TELECOMANDO DASHBOARD
            if (contextData.storeInfo.whatsapp_ai_autopilot !== true || contextData.storeInfo.whatsapp_connected !== true) {
                console.log(`[AutoPilot] 🛑 Pilota automatico DISATTIVATO dal negoziante per ${vendorId}. L'AI tace.`);
                return res.status(200).json({ status: "skipped", reason: "Pilota automatico o WhatsApp non attivo" });
            }

            const todayRome = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
            const todayReadable = new Date().toLocaleDateString('it-IT', {
                timeZone: 'Europe/Rome',
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
            });

            const recognizedClientName = contextData.client?.name || '';
            const savedClientAddress = contextData.client?.address || '';
            const lastClientService = contextData.client?.lastService || '';
            const salonName = contextData.storeInfo?.name || 'Salone';
            const salonAddress = contextData.storeInfo?.address || '';
            const hasRecentChatHistory = contextData.chatHistory && Array.isArray(contextData.chatHistory) && contextData.chatHistory.length > 0;

            // 🔍 FUNZIONE INTELLIGENTE: TROVA TUTTI I SERVIZI PERTINENTI ALLA RICHIESTA
            function getMatchingServicesForQuery(text, allServices) {
                const q = (text || "").toLowerCase();
                if (!q) return allServices;

                // Se chiede di capelli, tagli o styling
                if (q.includes("tagli") || q.includes("capell") || q.includes("sfumat") || q.includes("fade") || q.includes("rasat") || q.includes("piega") || q.includes("pettin")) {
                    const hairServices = allServices.filter(s => {
                        const n = (s.name || "").toLowerCase();
                        const c = (s.category || "").toLowerCase();
                        return n.includes("tagli") || n.includes("capell") || n.includes("sfumat") || n.includes("fade") || n.includes("styling") || c.includes("capell") || c.includes("styling") || c.includes("tagli");
                    });
                    if (hairServices.length > 0) return hairServices;
                }

                // Se chiede di barba o rasatura
                if (q.includes("barb") || q.includes("rasatur") || q.includes("panno cald") || q.includes("baff")) {
                    const beardServices = allServices.filter(s => {
                        const n = (s.name || "").toLowerCase();
                        const c = (s.category || "").toLowerCase();
                        return n.includes("barb") || n.includes("rasatur") || c.includes("barb");
                    });
                    if (beardServices.length > 0) return beardServices;
                }

                // Se chiede di colore, mèches o balayage
                if (q.includes("color") || q.includes("tinta") || q.includes("balayage") || q.includes("meches") || q.includes("mèches") || q.includes("shatush") || q.includes("schiarit") || q.includes("platin")) {
                    const colorServices = allServices.filter(s => {
                        const n = (s.name || "").toLowerCase();
                        const c = (s.category || "").toLowerCase();
                        return n.includes("color") || n.includes("tinta") || n.includes("balayage") || n.includes("meches") || n.includes("shatush") || n.includes("schiarit") || c.includes("color");
                    });
                    if (colorServices.length > 0) return colorServices;
                }

                return allServices;
            }

            // Lista Servizi e Prodotti formattata per l'AI
            const servicesListText = contextData.services.length > 0
                ? contextData.services.map(s => `- ${s.name} (ID: "${s.id}", Prezzo: ${s.price}€, Durata: ${s.duration} min)`).join('\n')
                : '- Servizio Standard (ID: "default", Prezzo: 0€, Durata: 30 min)';

            const productsListText = (contextData.products && contextData.products.length > 0)
                ? contextData.products.map(p => `- ${p.name} ${p.brand ? '(' + p.brand + ')' : ''} - Prezzo: ${p.price}€`).join('\n')
                : '- Nessun prodotto fisico attualmente a catalogo per la vendita da asporto.';

            // Cronologia chat
            let historyText = "";
            let lastAssistantMsg = "";
            if (hasRecentChatHistory) {
                historyText = "\nSTORICO CHAT RECENTE:\n" +
                    contextData.chatHistory.map(m => {
                        if (m.role === 'assistant') lastAssistantMsg = m.content;
                        return m.role === 'assistant' ? `Tu (Salone): ${m.content}` : `Cliente: ${m.content}`;
                    }).join('\n') + "\n";
            }

            // PROMPT DEL DIRETTORE: MASSIMA CONCISIONE E VELOCITÀ WHATSAPP
            const autoPilotSystemPrompt = `Sei l'assistente virtuale WhatsApp del salone "${salonName}".
Oggi è ${todayReadable} (${todayRome}).

DATI ATTIVITÀ E CLIENTE:
- Salone: ${salonName} (${salonAddress || 'in salone'})
${recognizedClientName ? `- Cliente noto: "${recognizedClientName}".` : '- Cliente: Nome non noto.'}
${lastClientService ? `- Ultimo servizio fatto dal cliente: "${lastClientService}".` : ''}
${savedClientAddress ? `- Indirizzo salvato in Rubrica: "${savedClientAddress}".` : ''}

LISTINO DEI NOSTRI SERVIZI REALI:
${servicesListText}

CATALOGO PRODOTTI IN VENDITA DA ASPORTO:
${productsListText}

${historyText}

🛑 REGOLE FERREE DI SCRITTURA (STILE WHATSAPP REALE):
1. BREVITÀ ESTREMA: Rispondi in MASSIMO 2 o 3 righe corte. Niente poemi, niente frasi lunghe. Diretto e veloce come un vero negoziante al cellulare.
2. SALUTI:
   ${hasRecentChatHistory 
     ? "- LA CONVERSAZIONE È GIÀ AVVIATA: NON DIRE MAI 'Ciao', 'Buongiorno' o 'Ciao [Nome]' all'inizio del messaggio! Rispondi direttamente alla domanda."
     : `- È IL PRIMO MESSAGGIO: Saluta brevemente con emoji.${recognizedClientName ? ` "Ciao ${recognizedClientName}! 👋"` : ' "Ciao! 👋"'}`
   }
3. RICHIESTE SERVIZI GENERICHE:
   - Se il cliente chiede genericamente un servizio (es. "tagliare i capelli", "fare il colore") e ci sono più opzioni nel listino:
     Usa intent "clarify_service". Elenca SOLO i servizi pertinenti con il prezzo in modo compatto (es. "Abbiamo: • Taglio Classico (20€) • Taglio & Styling (25€). Quale preferisci? ✂️").
   - Se il cliente è noto e ha fatto "${lastClientService || ''}", chiedigli brevemente se vuole fare il solito.
   - Se specifica il servizio esatto (es. "Taglio Uomo"), allora l'intent è "ask_availability" o "confirm_booking".
4. ORDINI PRODOTTI:
   - Se chiede di comprare un prodotto fisico: intent "order_product".
   - Se MANCA l'indirizzo: chiedi semplicemente via, civico e città per la consegna rapida (+2,99€ in contanti). NON dire che l'ordine è confermato finché non hai l'indirizzo!

INTENTI:
- "order_product": vuole comprare prodotti fisici o ha dato l'indirizzo per riceverli.
- "clarify_service": richiesta di servizio generica da chiarire mostrando le opzioni pertinenti.
- "ask_availability": chiede orari o date per un servizio preciso.
- "confirm_booking": vuole bloccare il posto ("Sì", "Ok", "Confermo", "Va bene alle 16").
- "info_question": info generali brevi.
- "general_greeting": saluta e basta.

Rispondi ESCLUSIVAMENTE con questo JSON compatto:
{
 "intent": "ask_availability",
 "customerName": "${recognizedClientName}",
 "productOrdered": "",
 "deliveryAddress": "",
 "date": "${todayRome}",
 "time": "",
 "serviceId": "",
 "serviceName": "",
 "replyText": "risposta brevissima di 2 righe per WhatsApp"
}`;

            const groqMessages = [
                { role: "system", content: autoPilotSystemPrompt },
                { role: "user", content: messageText }
            ];

            let extracted = {
                intent: "general_greeting",
                customerName: recognizedClientName,
                productOrdered: "",
                deliveryAddress: "",
                date: todayRome,
                time: "",
                serviceId: "",
                serviceName: "",
                replyText: ""
            };

            const GROQ_CANDIDATES = [
                "llama-3.3-70b-versatile",
                "llama-3.1-8b-instant",
                "openai/gpt-oss-120b"
            ];
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
                            max_tokens: 600
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
                        console.log(`[AutoPilot] ✅ Risposta (${modelId}) [Intent: ${extracted.intent}]:`, extracted.replyText);
                        aiSuccess = true;
                        break;
                    }
                } catch (pErr) {
                    console.warn(`[AutoPilot] ⚠️ Eccezione su ${modelId}:`, pErr.message);
                }
            }

            // 💡 RECUPERO INTELLIGENTE DI DATA E ORA DAL MESSAGGIO PRECEDENTE DEL SALONE
            if (extracted.intent === "confirm_booking" && lastAssistantMsg) {
                const dateMatch = lastAssistantMsg.match(/\b(\d{1,2})\/(\d{1,2})\b/);
                if (dateMatch) {
                    const currentYear = new Date().getFullYear();
                    const dayPart = dateMatch[1].padStart(2, '0');
                    const monthPart = dateMatch[2].padStart(2, '0');
                    extracted.date = `${currentYear}-${monthPart}-${dayPart}`;
                    console.log(`[AutoPilot] 💡 Data recuperata dallo storico: ${extracted.date}`);
                }

                if (!extracted.time) {
                    const timeMatch = lastAssistantMsg.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/);
                    if (timeMatch) {
                        extracted.time = timeMatch[0];
                        console.log(`[AutoPilot] 💡 Orario recuperato dallo storico: ${extracted.time}`);
                    }
                }

                const serviceNameMatch = lastAssistantMsg.match(/\*([^*\n]+)\*/);
                if (serviceNameMatch && serviceNameMatch[1]) {
                    const prevServiceName = serviceNameMatch[1].trim().toLowerCase();
                    const foundService = contextData.services.find(s => s.name.toLowerCase() === prevServiceName || s.name.toLowerCase().includes(prevServiceName));
                    if (foundService) {
                        extracted.serviceId = foundService.id;
                        extracted.serviceName = foundService.name;
                        console.log(`[AutoPilot] 💡 Servizio recuperato dallo storico: ${foundService.name}`);
                    }
                }
            }

            let finalReply = extracted.replyText;

            if (!aiSuccess || !finalReply) {
                finalReply = recognizedClientName
                    ? `Ti risponderemo a brevissimo con tutti i dettagli! ✨`
                    : `Grazie per averci scritto da ${salonName}. Ti risponderemo a breve! ✨`;
                extracted.intent = "api_error";
            }

            const displayName = extracted.customerName || recognizedClientName || '';
            const cleanClientPhone = senderPhone.replace(/@.*$/, '');

            // =========================================================================
            // 🛍️ 1. SALVATAGGIO ORDINI PRODOTTI IN DASHBOARD
            // =========================================================================
            const wantsProduct = (
                extracted.intent === "order_product" ||
                (extracted.intent === "confirm_booking" && !extracted.time) ||
                messageText.toLowerCase().includes("compra") ||
                messageText.toLowerCase().includes("ordinare") ||
                messageText.toLowerCase().includes("ordino") ||
                messageText.toLowerCase().includes("prendo") ||
                messageText.toLowerCase().includes("spedisc") ||
                messageText.toLowerCase().includes("portamelo") ||
                (lastAssistantMsg && lastAssistantMsg.toLowerCase().includes("consegn") && (messageText.toLowerCase().includes("via") || messageText.toLowerCase().includes("corso") || messageText.toLowerCase().includes("piazza") || messageText.toLowerCase().includes("viale") || messageText.toLowerCase().includes("confermo")))
            );

            let productOrderProcessed = false;

            if (wantsProduct && !extracted.time) {
                try {
                    console.log(`[AutoPilot] 📦 Rilevata richiesta prodotti da ${cleanClientPhone}! Analisi carrello...`);

                    const fullConversationText = (historyText + " " + messageText).toLowerCase();
                    let orderItemsList = [];
                    let subtotal = 0;

                    if (contextData.products && contextData.products.length > 0) {
                        contextData.products.forEach(prod => {
                            const prodNameLower = prod.name.toLowerCase();
                            const cleanName = prodNameLower.split('(')[0].trim();
                            if (fullConversationText.includes(prodNameLower) || (cleanName.length > 3 && fullConversationText.includes(cleanName))) {
                                let itemQty = 1;
                                const qtyMatch = fullConversationText.match(/(\d+)\s*(?:unità|pezzi|confezioni|pz|x|boccette)/i);
                                if (qtyMatch && qtyMatch[1]) {
                                    itemQty = parseInt(qtyMatch[1], 10) || 1;
                                }

                                const itemPrice = parseFloat(prod.price) || 0;
                                orderItemsList.push({
                                    docId: prod.id,
                                    productId: prod.id,
                                    productName: prod.name,
                                    name: prod.name,
                                    quantity: itemQty,
                                    price: itemPrice,
                                    type: 'offers'
                                });
                                subtotal += (itemPrice * itemQty);
                            }
                        });
                    }

                    // Calcolo Spedizione Velletri reale: 2,99€ (+0,20€ per ogni pezzo in più)
                    let totalItemsCount = 0;
                    orderItemsList.forEach(it => { totalItemsCount += (it.quantity || 1); });
                    const baseShipping = 2.99;
                    const extraItemCost = 0.20;
                    const shippingCost = totalItemsCount > 1 ? (baseShipping + ((totalItemsCount - 1) * extraItemCost)) : baseShipping;

                    // Estrazione Indirizzo Reale (dalla rubrica, dall'estrazione AI o dal testo del cliente)
                    let deliveryAddress = extracted.deliveryAddress || savedClientAddress || "";
                    
                    if (!deliveryAddress) {
                        const addrRegex = /(?:via|viale|corso|piazza|largo|strada)\s+[^,\n.]+(?:,?\s*\d+)?(?:\s*,\s*[^,\n.]+)?/i;
                        const matchInUserMsg = messageText.match(addrRegex);
                        if (matchInUserMsg) {
                            deliveryAddress = matchInUserMsg[0].trim();
                        }
                    }

                    // Se abbiamo trovato sia il prodotto che l'indirizzo -> SALVA NELLA DASHBOARD!
                    if (orderItemsList.length > 0 && deliveryAddress) {
                        let deliveryZip = "00049";
                        let deliveryCity = "Velletri";
                        const zipMatch = deliveryAddress.match(/\b(00\d{3}|\d{5})\b/);
                        if (zipMatch) deliveryZip = zipMatch[1];

                        const finalTotal = subtotal + shippingCost;

                        const orderPayload = {
                            action: 'save_whatsapp_product_order',
                            vendorId: vendorId,
                            customerName: displayName || "Cliente WhatsApp",
                            customerPhone: cleanClientPhone,
                            deliveryAddress: deliveryAddress,
                            deliveryZip: deliveryZip,
                            deliveryCity: deliveryCity,
                            orderNotes: 'Ordinato tramite WhatsApp AI - Pagamento in contanti alla consegna',
                            subtotal: subtotal,
                            totalPrice: finalTotal,
                            shippingCost: shippingCost,
                            items: orderItemsList
                        };

                        const orderRes = await fetch(API_BASE_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(orderPayload)
                        });

                        if (orderRes.ok) {
                            const orderJson = await orderRes.json();
                            console.log(`[AutoPilot] 🔔 ORDINE SALVATO IN DASHBOARD CON SUCCESSO! ID: ${orderJson.orderId}`);
                            const itemsListText = orderItemsList.map(it => `• ${it.quantity}x ${it.productName} (${(it.price * it.quantity).toFixed(2)}€)`).join('\n');
                            finalReply = `Perfetto! ✅ Ordine confermato in salone:\n${itemsListText}\n📍 Consegna a: *${deliveryAddress}*\n💶 *Totale al corriere:* ${finalTotal.toFixed(2)}€ (inclusi ${shippingCost.toFixed(2)}€ consegna rapida). A presto! 🚚✨`;
                            productOrderProcessed = true;
                        }
                    } else if (orderItemsList.length > 0 && !deliveryAddress) {
                        finalReply = `Perfetto! Per la consegna a domicilio a Velletri (2,99€ con pagamento in contanti al rider), a quale indirizzo dobbiamo consegnare? 🛵`;
                        productOrderProcessed = true;
                    }
                } catch (ordErr) {
                    console.error("[AutoPilot] ⚠️ Errore salvataggio ordine prodotto:", ordErr);
                }
            }

            // =========================================================
            // ✂️ 2. GESTIONE APPUNTAMENTO (FILTRO INTELLIGENTE SERVIZI)
            // =========================================================
            if (!productOrderProcessed) {
                let matchedService = null;

                if (extracted.serviceId) {
                    matchedService = contextData.services.find(s => s.id === extracted.serviceId) || null;
                }

                if (!matchedService && extracted.serviceName) {
                    const searchName = extracted.serviceName.toLowerCase().trim();
                    matchedService = contextData.services.find(s => s.name.toLowerCase().trim() === searchName)
                        || contextData.services.find(s => s.name.toLowerCase().includes(searchName))
                        || null;
                }

                // Cerca corrispondenza diretta nel testo del cliente (es. se ha scritto "Taglio & Styling" o "Taglio Classico")
                if (!matchedService) {
                    const msgLower = messageText.toLowerCase();
                    const sortedServices = [...contextData.services].sort((a, b) => (b.name || '').length - (a.name || '').length);
                    matchedService = sortedServices.find(s => msgLower.includes((s.name || '').toLowerCase())) || null;
                }

                // Se la richiesta è generica o il servizio non è specificato in modo univoco
                if (extracted.intent === "clarify_service" || (!matchedService && (extracted.intent === "ask_availability" || extracted.intent === "confirm_booking"))) {
                    console.log(`[AutoPilot] 🛡️ Richiesta generica. Filtro i servizi pertinenti per: "${messageText}"`);

                    // 🎯 Trova TUTTI i servizi pertinenti (es. tutti i tagli veri del salone!)
                    const relevantServices = getMatchingServicesForQuery(messageText, contextData.services);
                    const opzioniServizi = relevantServices.map(s => `• *${s.name}* (${s.price}€)`).join('\n');

                    finalReply = `Per i capelli abbiamo queste opzioni:\n${opzioniServizi}\n\nQuale preferisci prenotare? ✂️`;
                } 
                else if (matchedService && (extracted.intent === "ask_availability" || extracted.intent === "confirm_booking")) {
                    const targetDate = extracted.date || todayRome;
                    const dateParts = targetDate.split('-');
                    const dateReadable = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}` : targetDate;

                    let availableSlots = [];
                    try {
                        console.log(`[AutoPilot] 📅 Controllo slot per ${targetDate} - Servizio: ${matchedService.name} (${matchedService.id})`);
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
                    } catch (sErr) {
                        console.error("[AutoPilot] ⚠️ Eccezione controllo slot:", sErr.message);
                    }

                    // CASO A: IL CLIENTE CONFERMA -> PRENOTIAMO A DATABASE!
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

                            console.log(`[AutoPilot] 💾 Salvataggio appuntamento per ${targetDate} alle ${extracted.time} (${matchedService.name})...`);

                            const bookPayload = {
                                action: 'save_service_booking',
                                vendorId: vendorId,
                                customerName: displayName || ("Cliente WhatsApp (" + cleanClientPhone.slice(-4) + ")"),
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
                                finalReply = `🎉 Appuntamento confermato! Ti ho inserito in agenda per *${matchedService.name}* in data *${dateReadable}* alle ore *${extracted.time}*. Ti aspettiamo! ✂️✨`;
                                console.log(`[AutoPilot] ✅ APPUNTAMENTO REGISTRATO A CALENDARIO CON SUCCESSO!`);
                            } else {
                                const errJson = await saveRes.json().catch(() => ({}));
                                console.warn("[AutoPilot] ⚠️ Errore salvataggio:", errJson.error);
                                finalReply = `Purtroppo lo slot delle ${extracted.time} del ${dateReadable} è stato appena occupato. Vuoi che controlliamo un altro orario?`;
                            }
                        } catch (bErr) {
                            console.error("[AutoPilot] ⚠️ Eccezione salvataggio:", bErr);
                            finalReply = `Ho preso nota della tua richiesta per le ${extracted.time}, ti confermo tutto a brevissimo!`;
                        }
                    }
                    // CASO B: IL CLIENTE CHIEDE DISPONIBILITÀ
                    else if (extracted.intent === "ask_availability") {
                        if (extracted.time) {
                            const isTimeFree = availableSlots.includes(extracted.time);
                            if (isTimeFree) {
                                finalReply = `Sì! Alle *${extracted.time}* del ${dateReadable} siamo liberi per *${matchedService.name}*. Ti blocco il posto? ✂️`;
                            } else {
                                if (availableSlots.length > 0) {
                                    const alternatives = availableSlots.slice(0, 3).join(', ');
                                    finalReply = `Alle ${extracted.time} siamo pieni! Per *${matchedService.name}* ho liberi: *${alternatives}*. Ti andrebbe bene uno di questi?`;
                                } else {
                                    finalReply = `Per il ${dateReadable} siamo al completo per *${matchedService.name}*. Vuoi che controlliamo un'altra data?`;
                                }
                            }
                        } else {
                            if (availableSlots.length > 0) {
                                const alternatives = availableSlots.slice(0, 4).join(', ');
                                finalReply = `Per *${matchedService.name}* (${dateReadable}) ho liberi questi orari: *${alternatives}*. Quale preferisci? ✂️`;
                            } else {
                                finalReply = `Per il ${dateReadable} non ci sono orari disponibili. Ti controllo un'altra data?`;
                            }
                        }
                    }
                }
            }

            // 3. SALVA LA MEMORIA DELLA CONVERSAZIONE
            if (extracted.intent !== "api_error") {
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
                } catch (saveMemErr) {
                    console.warn("[AutoPilot] Errore salvataggio memoria:", saveMemErr.message);
                }
            }

            // 4. INVIA LA RISPOSTA SU WHATSAPP TRAMITE IL GATEWAY
            try {
                await fetch(`${GATEWAY_BASE_URL}/send-message`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        vendorId: vendorId,
                        phone: senderPhone,
                        message: finalReply
                    })
                });
            } catch (sendErr) {
                console.error("[AutoPilot] ⚠️ Errore invio Gateway:", sendErr.message);
            }

            return res.status(200).json({ success: true, processed: true, intent: extracted.intent, reply: finalReply });
        }
        // =========================================================================

        const contesto = body.contesto;
        if (!contesto) {
            return res.status(400).json({ errore: "Dati di contesto mancanti nella richiesta." });
        }

        // Calcolo Urgenza e Sconto (per i post social)
        const isLowStock = contesto.quantita > 0 && contesto.quantita <= 3;
        const hasDiscount = contesto.originalPrice && contesto.originalPrice > (contesto.prezzo || 0);
        const discountPercent = hasDiscount ? Math.round(((contesto.originalPrice - contesto.prezzo) / contesto.originalPrice) * 100) : 0;

        // --- TRASCRIZIONE AUTOMATICA DEI VOCALI ---
        if (contesto.isBookingImport && contesto.isAudioTranscription && contesto.audioBase64) {
            const audioBuffer = Buffer.from(contesto.audioBase64, 'base64');
            const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });

            const WHISPER_FALLBACK_MODELS = ['whisper-large-v3-turbo', 'whisper-large-v3'];
            let audioTranscriptionResult = null;
            let lastWhisperError = null;

            for (const wModel of WHISPER_FALLBACK_MODELS) {
                try {
                    const formData = new FormData();
                    formData.append('file', blob, contesto.audioFilename || 'audio.mp3');
                    formData.append('model', wModel);

                    const whisperResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${GROQ_API_KEY}`
                        },
                        body: formData
                    });

                    const whisperData = await whisperResponse.json();
                    if (whisperResponse.ok && whisperData.text) {
                        audioTranscriptionResult = whisperData.text;
                        break;
                    } else {
                        lastWhisperError = new Error(whisperData.error?.message || "Errore Whisper");
                    }
                } catch (wErr) {
                    lastWhisperError = wErr;
                }
            }

            if (!audioTranscriptionResult) {
                throw new Error(lastWhisperError?.message || "Errore durante la trascrizione dell'audio.");
            }

            contesto.messageText = audioTranscriptionResult;
        }

        // --- SELEZIONE AUTOMATICA DELLE ISTRUZIONI SOCIAL / BOOKING ---
        let systemPrompt = "";
        let userPromptText = "";

        if (contesto.isBookingImport) {
            systemPrompt = `Sei l'assistente di reception virtuale di un salone di bellezza/studio professionale. Il tuo compito è analizzare un messaggio o la trascrizione di un audio informale, abbreviato o in dialetto, inviato da un cliente per prenotare un appuntamento, ed estrarre i dati in formato JSON.

            REGOLE DI ESTRAZIONE E CALCOLO:
            1. Nome: Estrai solo il nome del cliente (es: "Marco", "Giulia"). Se non lo trovi, lascia "".
            2. Data: Calcola la data esatta in formato AAAA-MM-GG basandoti sulla data di oggi che ti viene fornita.
            3. Ora: Estrai l'ora richiesta in formato HH:MM (es: "17:30"). Se l'ora è generica (es: "pomeriggio"), proponi un orario coerente (es: "17:00").
            4. Servizio: Identifica quale dei servizi reali del negozio corrisponde di più alla richiesta del cliente. Se non trovi riscontri, lascia "".
            5. Risposta WhatsApp (CONFERMA): Se NON ti viene fornito l'elenco "alternativeSlots", genera una risposta cordiale per confermare la prenotazione richiesta.
            6. Risposta WhatsApp (RIFIUTO E SPOSTAMENTO): Se ti viene fornito l'elenco "alternativeSlots", genera un messaggio super diplomatico e amichevole dove spieghi che purtroppo quell'orario è al completo e offri esplicitamente le date/ore alternative.

            Rispondi ESCLUSIVAMENTE con un oggetto JSON pulito e valido:
            {
              "customerName": "Nome",
              "date": "YYYY-MM-DD",
              "time": "HH:MM",
              "serviceId": "ID_DEL_SERVIZIO",
              "suggestedReply": "Messaggio di risposta"
            }`;

            userPromptText = `Contesto temporale (Oggi è): ${contesto.currentDate}
            Listino Servizi reali del Negozio:
            ${JSON.stringify(contesto.servicesList)}

            ${contesto.isAlternativeProposal ? `!!! ATTENZIONE: IL GIORNO RICHIESTO È COMPLETAMENTE OCCUPATO !!!
            Proponi al cliente queste date/ore alternative libere reali:
            ${JSON.stringify(contesto.alternativeSlots)}` : ''}

            Messaggio del cliente da analizzare: "${contesto.messageText}"`;

        } else if (contesto.isAIAssistant || contesto.nota_extra?.includes("Agisci come un esperto")) {
            systemPrompt = `Sei l'Assistente Esperto di un banco del Mercato Fresco di Civora.
            Il tuo obiettivo è consigliare il cliente, rispondere ai suoi dubbi e aiutarlo a usare al meglio il prodotto.
            1. TONO: Amichevole, caloroso e professionale. Usa il "tu".
            2. COMPETENZA: Dai consigli pratici su come cucinare il prodotto, conservarlo e abbinarlo.
            3. FORMATTAZIONE: Usa i **grassetti** e le emoji per rendere la lettura piacevole.`;

            userPromptText = `Un cliente ti chiede informazioni su questo prodotto:
            - Nome: "${contesto.nome}"
            - Categoria: "${contesto.categoria || 'Alimentari'}"
            - Provenienza: "${contesto.provenienza || 'Italia'}"
            - Descrizione del Venditore: "${contesto.descrizione || ''}"
            - Dettagli Tecnici: "${contesto.specifiche || ''}"

            DOMANDA DEL CLIENTE: "${contesto.nota_extra}"`;

        } else {
            systemPrompt = `Sei un Senior Social Media Copywriter da Agenzia di Marketing di Lusso. Il tuo compito è creare post ad ALTO IMPATTO magnetici per promuovere servizi e prodotti.
            REGOLE: Inizia con un TITOLO IN GRASSETTO MAIUSCOLO tra emoji. Usa elenchi puntati eleganti. Usa i grassetti per prezzi e urgenza. Crea FOMO se disponibilità limitata.
            Rispondi SOLO con il testo finale del post pronto da copiare, senza premesse, commenti o spiegazioni.`;

            userPromptText = `Dati per il post social:
            - Negozio: "${contesto.store_name || 'Salone'}"
            - Servizio/Prodotto: "${contesto.nome || 'Servizio Esclusivo'}"
            - Prezzo: ${contesto.prezzo || '0'}€ ${hasDiscount ? `(Sconto del ${discountPercent}%)` : ''}
            - Durata/Quantità: ${contesto.durata ? `${contesto.durata} minuti` : (contesto.quantita || 'Disponibile')}
            - Descrizione: "${contesto.descrizione || 'Trattamento professionale di alta qualità'}"
            - Note Extra richieste: "${contesto.note_extra || 'Creatività libera'}"
            - Link di Prenotazione Diretta: ${contesto.link_shop || 'https://www.civora.it'}

            ${isLowStock ? '!!! CREA URGENZA: POSTI / SCORTE IN ESAURIMENTO !!!' : ''}`;
        }

        const messageContent = userPromptText;

        // FASE 3: AUTO-DISCOVERY DEI MODELLI GROQ ATTIVI
        let dynamicModelsList = [];
        try {
            const modelsRes = await fetch("https://api.groq.com/openai/v1/models", {
                headers: { "Authorization": `Bearer ${GROQ_API_KEY}` }
            });
            if (modelsRes.ok) {
                const modelsData = await modelsRes.json();
                if (modelsData.data && Array.isArray(modelsData.data)) {
                    const chatModels = modelsData.data
                        .map(m => m.id)
                        .filter(id => !id.includes("whisper") && !id.includes("guard") && !id.includes("embed"));

                    chatModels.sort((a, b) => {
                        const score = (m) => {
                            if (m.includes("llama-3.3")) return 100;
                            if (m.includes("llama-3.1-70b")) return 90;
                            if (m.includes("llama-3.1-8b")) return 80;
                            if (m.includes("gpt-oss")) return 70;
                            if (m.includes("qwen")) return 60;
                            if (m.includes("mixtral")) return 50;
                            if (m.includes("gemma")) return 40;
                            return 10;
                        };
                        return score(b) - score(a);
                    });
                    dynamicModelsList = chatModels;
                }
            }
        } catch (e) {
            console.warn("[Groq Discovery] Impossibile recuperare lista dinamica, uso lista fallback:", e.message);
        }

        const GROQ_TEXT_MODELS = dynamicModelsList.length > 0 ? dynamicModelsList : [
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "openai/gpt-oss-20b",
            "qwen/qwen3.6-27b",
            "gemma2-9b-it"
        ];

        let postGenerato = null;
        let lastChatError = null;

        for (const modelCandidate of GROQ_TEXT_MODELS) {
            try {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${GROQ_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: modelCandidate,
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: messageContent }
                        ],
                        temperature: 0.2,
                        max_tokens: 1200
                    })
                });

                const data = await response.json();

                if (response.ok && data.choices && data.choices.length > 0 && data.choices[0].message?.content) {
                    postGenerato = data.choices[0].message.content.trim();
                    console.log(`[Groq AI] Successo con modello: ${modelCandidate}`);
                    break;
                } else {
                    const errDetail = data.error?.message || `HTTP ${response.status}`;
                    console.warn(`[Groq AI] Modello ${modelCandidate} ha risposto con errore (${errDetail}), provo successivo...`);
                    lastChatError = new Error(errDetail);
                }
            } catch (callErr) {
                lastChatError = callErr;
            }
        }

        if (!postGenerato) {
            return res.status(500).json({ errore: "Errore durante la generazione con Groq: " + (lastChatError?.message || "Servizio non disponibile") });
        }

        let cleanOutput = postGenerato.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        cleanOutput = cleanOutput.replace(/<\/?think>/gi, "").trim();

        if (contesto.isBookingImport) {
            const jsonCleaned = cleanOutput.replace(/```json/g, "").replace(/```/g, "").trim();
            try {
                const parsedJSON = JSON.parse(jsonCleaned);
                return res.status(200).json({ bookingData: parsedJSON });
            } catch (jsonErr) {
                return res.status(200).json({ rawText: cleanOutput, error: "L'IA non ha restituito un formato JSON valido." });
            }
        }

        res.status(200).json({ post: cleanOutput });

    } catch (error) {
        console.error("[api/social.js] Errore critico:", error);
        res.status(500).json({ errore: "Errore interno del server: " + error.message });
    }
};
