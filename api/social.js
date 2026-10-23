module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    try {
        const body = req.body || {};
        const GROQ_API_KEY = process.env.GROQ_API_KEY;
        if (!GROQ_API_KEY) return res.status(500).json({ errore: "Manca la chiave GROQ_API_KEY." });

        // =========================================================================
        // 🤖 PILOTA AUTOMATICO WHATSAPP 24/7 (CERVELLO LIBERO E INTELLIGENTE)
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

            if (!messageText) return res.status(200).json({ status: "skipped" });

            console.log(`[AutoPilot] 📩 Messaggio da "${pushName}": "${messageText}"`);

            const API_BASE_URL = 'https://localmente-api.vercel.app/api/get-available-slots';
            const GATEWAY_BASE_URL = (process.env.CIVORA_WHATSAPP_GATEWAY_URL || 'https://civora-whatsapp-gateway.onrender.com').replace(/\/+$/, '');

            // 1. RECUPERO CONTESTO
            let contextData = {
                storeInfo: { name: 'Il nostro salone', address: '', opening_hours: '', whatsapp_ai_autopilot: false, whatsapp_connected: false },
                services: [], products: [], client: { name: '', address: '', phone: senderPhone }, chatHistory: []
            };

            try {
                const ctxRes = await fetch(API_BASE_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'get_autopilot_context', vendorId: vendorId, customerPhone: senderPhone })
                });
                if (ctxRes.ok) {
                    const fetched = await ctxRes.json();
                    if (fetched.success) contextData = fetched;
                }
            } catch (e) {}

            if (contextData.storeInfo.whatsapp_ai_autopilot !== true) {
                return res.status(200).json({ status: "skipped" });
            }

            const tomorrowObj = new Date(todayRome + 'T12:00:00Z');
            tomorrowObj.setUTCDate(tomorrowObj.getUTCDate() + 1);
            const tomorrowRome = tomorrowObj.toISOString().split('T')[0];

            const recognizedClientName = contextData.client?.name || pushName || '';
            const salonName = contextData.storeInfo?.name || 'Salone';
            const hasRecentChatHistory = contextData.chatHistory && contextData.chatHistory.length > 0;

            let historyText = "";
            let lastAssistantMsg = "";
            let lastDiscussedService = "";

            if (hasRecentChatHistory) {
                historyText = "\nSTORICO CHAT RECENTE:\n" + contextData.chatHistory.map(m => {
                    if (m.role === 'assistant') lastAssistantMsg = m.content;
                    return m.role === 'assistant' ? `Tu: ${m.content}` : `Cliente: ${m.content}`;
                }).join('\n') + "\n";
                
                // Ricorda di cosa stavamo parlando!
                const serviceNameMatch = lastAssistantMsg.match(/\*([^*\n]+)\*/);
                if (serviceNameMatch) lastDiscussedService = serviceNameMatch[1].trim();
            }

            // LISTE CORTE (Max 15 per far capire all'IA, ma lei ne proporrà massimo 4 o 5)
            const servicesListText = contextData.services.slice(0, 15).map(s => `- ${s.name} (Prezzo: ${s.price}€, ID: "${s.id}")`).join('\n');
            const productsListText = (contextData.products || []).slice(0, 8).map(p => `- ${p.name} (${p.price}€)`).join('\n');

            // IL NUOVO PROMPT INTELLIGENTE (CHE LASCIA RAGIONARE L'IA COME IERI!)
            const autoPilotSystemPrompt = `Sei l'assistente WhatsApp del salone "${salonName}".
Oggi è ${todayReadable}, ore ${messageTime}.
Nome Cliente: "${recognizedClientName}".
Indirizzo Salone: ${contextData.storeInfo.address}
Orari: ${contextData.storeInfo.opening_hours}

LISTINO SERVIZI:
${servicesListText}

CATALOGO PRODOTTI:
${productsListText}

${historyText}

REGOLE COMPORTAMENTALI (MOLTO IMPORTANTI):
1. SEI INTELLIGENTE: Leggi lo storico. Se gli hai appena chiesto "A che ora preferisci?" e lui risponde "9", capisci da solo che intende le 09:00 per il servizio di cui stavate parlando (${lastDiscussedService})! Imposta intent "confirm_booking", time "09:00", serviceName "${lastDiscussedService}".
2. STILE WHATSAPP: Usa massimo 2-3 righe corte. Sii amichevole ma super diretto. 
3. NON FARE LISTONI: Se ti chiede che servizi fai, elenca SOLO i 4-5 più importanti usando i numeri (1️⃣, 2️⃣...).
4. SALUTI: Saluta solo al primissimo messaggio. Se state già chattando, vai dritto al punto!
5. ORDINI PRODOTTI: Se vuole un prodotto, chiedi l'indirizzo per la consegna rapida (+2,99€ in contanti). Se ti dà l'indirizzo, l'intent è "order_product".

SPIEGAZIONE INTENTI JSON (Scegli con intelligenza!):
- "general_greeting": Ciao iniziale o domande su orari/indirizzo.
- "clarify_service": Vuole prenotare ma non sai ancora il servizio esatto, proponi 3-4 opzioni.
- "ask_availability": Ha scelto un servizio preciso, chiedi al database che ore sono libere.
- "confirm_booking": Ha confermato un orario preciso (es. "alle 9", "ok 16:30").
- "order_product": Vuole comprare un prodotto E ti ha dato l'indirizzo.

Rispondi ESCLUSIVAMENTE con questo JSON:
{
 "intent": "ask_availability", 
 "customerName": "${recognizedClientName}",
 "date": "${todayRome}",
 "time": "",
 "serviceName": "",
 "productOrdered": "",
 "deliveryAddress": "",
 "replyText": "testo della tua risposta in 2 righe"
}`;

            const groqMessages = [
                { role: "system", content: autoPilotSystemPrompt },
                { role: "user", content: messageText }
            ];

            let extracted = { intent: "general_greeting", date: todayRome, time: "", serviceName: "", replyText: "" };
            let aiSuccess = false;

            const GROQ_CANDIDATES = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
            for (const modelId of GROQ_CANDIDATES) {
                try {
                    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                        method: "POST",
                        headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
                        body: JSON.stringify({ model: modelId, messages: groqMessages, temperature: 0.1, max_tokens: 500 })
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
                        extracted = { ...extracted, ...JSON.parse(cleanJson) };
                        aiSuccess = true;
                        console.log(`[AutoPilot] 🧠 IA ha scelto Intent: ${extracted.intent}, Service: ${extracted.serviceName}, Time: ${extracted.time}`);
                        break;
                    }
                } catch (e) {}
            }

            let finalReply = extracted.replyText;

            // =========================================================================
            // 🎬 ESECUZIONE AZIONI (L'IA HA RAGIONATO, ORA IL SERVER AGISCE)
            // =========================================================================

            // 1. GESTIONE ORDINE PRODOTTO
            if (extracted.intent === "order_product" && extracted.productOrdered && extracted.deliveryAddress) {
                try {
                    let orderItemsList = [];
                    let subtotal = 0;
                    const prodMatch = contextData.products.find(p => p.name.toLowerCase().includes(extracted.productOrdered.toLowerCase()));
                    
                    if (prodMatch) {
                        orderItemsList.push({ productId: prodMatch.id, productName: prodMatch.name, quantity: 1, price: parseFloat(prodMatch.price) || 0, type: 'offers' });
                        subtotal = parseFloat(prodMatch.price) || 0;
                    }

                    if (orderItemsList.length > 0) {
                        const shippingCost = 2.99;
                        const finalTotal = subtotal + shippingCost;
                        
                        await fetch(API_BASE_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                action: 'save_whatsapp_product_order',
                                vendorId: vendorId,
                                customerName: recognizedClientName || "Cliente WhatsApp",
                                customerPhone: senderPhone,
                                deliveryAddress: extracted.deliveryAddress,
                                deliveryZip: "00049",
                                deliveryCity: "Velletri",
                                orderNotes: 'WhatsApp AI - Pagamento contanti alla consegna',
                                subtotal: subtotal,
                                totalPrice: finalTotal,
                                shippingCost: shippingCost,
                                items: orderItemsList
                            })
                        });
                        finalReply = `Perfetto! ✅ Ordine confermato in salone:\n1x ${prodMatch.name}\n📍 Consegna a: *${extracted.deliveryAddress}*\n💶 *Totale al corriere:* ${finalTotal.toFixed(2)}€ (inclusi 2,99€ spedizione). A presto! 🚚✨`;
                    }
                } catch (e) {}
            }
            
            // 2. GESTIONE APPUNTAMENTO (CERCA SLOT O SALVA)
            else if (extracted.intent === "ask_availability" || extracted.intent === "confirm_booking") {
                const matchedService = contextData.services.find(s => s.name.toLowerCase().includes((extracted.serviceName || '').toLowerCase()));
                
                if (matchedService) {
                    let targetDate = extracted.date || todayRome;

                    // Se il cliente prima ha risposto "ok" al cambio giorno, l'IA forse ha lasciato la data di oggi, forziamo domani.
                    if (messageText.toLowerCase() === "si" || messageText.toLowerCase() === "ok") {
                        if (lastAssistantMsg && (lastAssistantMsg.includes("completo") || lastAssistantMsg.includes("domani"))) targetDate = tomorrowRome;
                    }

                    // Se chiede slot liberi
                    if (extracted.intent === "ask_availability") {
                        try {
                            const slotsRes = await fetch(API_BASE_URL, {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ action: 'getAvailableSlots', vendorId: vendorId, serviceId: matchedService.id, date: targetDate })
                            });
                            if (slotsRes.ok) {
                                const slotsJson = await slotsRes.json();
                                const avSlots = slotsJson.slots || [];
                                
                                if (avSlots.length > 0) {
                                    const alts = avSlots.slice(0, 4).join(', ');
                                    finalReply = `Ho liberi questi orari per *${matchedService.name}*: ${alts}. A che ora preferisci? ✂️`;
                                } else {
                                    // Se oggi è pieno, cerca in automatico per domani
                                    if (targetDate === todayRome) {
                                        const tomRes = await fetch(API_BASE_URL, {
                                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ action: 'getAvailableSlots', vendorId: vendorId, serviceId: matchedService.id, date: tomorrowRome })
                                        });
                                        const tomJson = await tomRes.json();
                                        const tomSlots = tomJson.slots || [];
                                        if (tomSlots.length > 0) {
                                            finalReply = `Per oggi siamo al completo, ma per domani ho liberi: ${tomSlots.slice(0,4).join(', ')}. Ti andrebbe bene uno di questi? ✂️`;
                                        } else {
                                            finalReply = `Oggi e domani siamo pieni per questo servizio. Vuoi controllare per dopodomani?`;
                                        }
                                    } else {
                                        finalReply = `Purtroppo in quella data siamo al completo. Vuoi controllare un altro giorno?`;
                                    }
                                }
                            }
                        } catch (e) {}
                    }
                    
                    // Se ha confermato un orario (es "9")
                    if (extracted.intent === "confirm_booking" && extracted.time) {
                        try {
                            const durationMins = matchedService.duration || 30;
                            const romeLoc = new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" });
                            const utcLoc = new Date().toLocaleString("en-US", { timeZone: "UTC" });
                            const offsetMins = (new Date(utcLoc) - new Date(romeLoc)) / 60000;
                            const startMs = new Date(`${targetDate}T${extracted.time}:00Z`).getTime() + (offsetMins * 60000);
                            const startDateTime = new Date(startMs);
                            const endDateTime = new Date(startMs + durationMins * 60000);

                            const saveRes = await fetch(API_BASE_URL, {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    action: 'save_service_booking', vendorId: vendorId,
                                    customerName: recognizedClientName || "Cliente", customerPhone: senderPhone,
                                    serviceId: matchedService.id, bookedServiceName: matchedService.name,
                                    bookedServicePrice: matchedService.price, bookedTotalOccupiedTime: durationMins,
                                    startDateTime: startDateTime.toISOString(), endDateTime: endDateTime.toISOString(),
                                    status: 'confirmed', source: 'whatsapp_ai_autopilot', type: 'cura_persona'
                                })
                            });

                            if (saveRes.ok) {
                                finalReply = `🎉 Perfetto! Ti confermo l'appuntamento per *${matchedService.name}* alle *${extracted.time}*. Ti abbiamo inserito in agenda, a presto! ✂️✨`;
                            } else {
                                finalReply = `Purtroppo lo slot delle ${extracted.time} è stato appena occupato o non è valido. Puoi dirmi un altro orario?`;
                            }
                        } catch (e) {
                            finalReply = `Ricevuto per le ${extracted.time}, confermo a breve!`;
                        }
                    }
                }
            }

            // 3. SALVA MEMORIA CHAT
            try {
                await fetch(API_BASE_URL, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'save_autopilot_message', vendorId: vendorId, customerPhone: senderPhone, userMessage: messageText, aiReply: finalReply, customerName: recognizedClientName })
                });
            } catch (e) {}

            // 4. INVIO WHATSAPP
            try {
                await fetch(`${GATEWAY_BASE_URL}/send-message`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ vendorId: vendorId, phone: senderJid || senderPhone, message: finalReply })
                });
            } catch (e) {}

            return res.status(200).json({ success: true, processed: true, reply: finalReply });
        }

        res.status(200).json({ status: "ok" });
    } catch (error) {
        res.status(500).json({ errore: error.message });
    }
};
