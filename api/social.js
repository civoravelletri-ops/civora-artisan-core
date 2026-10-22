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
              // 🤖 PILOTA AUTOMATICO WHATSAPP 24/7 (INGEGNERIA CIVORA BUSINESS: MEMORIA + AGENDA + PRODOTTI)
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

                  // 1. RECUPERO CONTESTO COMPLETO DAL MOTORE CENTRALE
                  let contextData = {
                      storeInfo: { name: 'Il nostro salone', address: '', phone: '', opening_hours: '' },
                      services: [],
                      products: [],
                      client: { name: '', isKnown: false, phone: senderPhone },
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
                              console.log(`[AutoPilot] 🧠 Contesto: Cliente "${contextData.client?.name || 'Sconosciuto'}", Servizi: ${contextData.services.length}, Prodotti Salone: ${contextData.products?.length || 0}`);
                          }
                      }
                  } catch (ctxErr) {
                      console.error("[AutoPilot] ⚠️ Eccezione recupero contesto:", ctxErr.message);
                  }

                  const todayRome = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
                  const todayReadable = new Date().toLocaleDateString('it-IT', {
                      timeZone: 'Europe/Rome',
                      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
                  });

                  const recognizedClientName = contextData.client?.name || '';
                  const salonName = contextData.storeInfo?.name || 'Salone';
                  const salonAddress = contextData.storeInfo?.address || '';
                  const salonPhone = contextData.storeInfo?.phone || '';

                  // Lista Servizi (Tagli, Barba, Trattamenti da fare in studio)
                  const servicesListText = contextData.services.length > 0
                      ? contextData.services.map(s => `- ${s.name} (ID: "${s.id}", Prezzo: ${s.price}€, Durata: ${s.duration} min)`).join('\n')
                      : '- Servizio Standard (ID: "default", Prezzo: 0€, Durata: 30 min)';

                  // 🛍️ Lista Prodotti da comprare/portare a casa di QUESTO salone
                  const productsListText = (contextData.products && contextData.products.length > 0)
                      ? contextData.products.map(p => `- ${p.name} ${p.brand ? '(' + p.brand + ')' : ''} - Prezzo: ${p.price}€`).join('\n')
                      : '- Nessun prodotto fisico attualmente a catalogo per la vendita da asporto.';

                  // Cronologia chat
                  let historyText = "";
                  let lastAssistantMsg = "";
                  if (contextData.chatHistory && Array.isArray(contextData.chatHistory) && contextData.chatHistory.length > 0) {
                      historyText = "\nSTORICO CHAT RECENTE:\n" +
                          contextData.chatHistory.map(m => {
                              if (m.role === 'assistant') lastAssistantMsg = m.content;
                              return m.role === 'assistant' ? `Tu (Salone): ${m.content}` : `Cliente: ${m.content}`;
                          }).join('\n') + "\n";
                  }

                  const autoPilotSystemPrompt = `Sei l'assistente virtuale WhatsApp del salone "${salonName}".
       Oggi è ${todayReadable} (${todayRome}).

       DATI ATTIVITÀ:
       - Nome Salone: ${salonName}
       - Indirizzo esatto: ${salonAddress || 'in salone'}
       - Telefono: ${salonPhone || ''}
       ${recognizedClientName ? `- Nome Cliente già noto: "${recognizedClientName}". Salutalo per nome!` : '- Nome Cliente: Non ancora noto.'}

       LISTINO SERVIZI IN SALONE (Tagli, Barbe, Trattamenti):
       ${servicesListText}

       PRODOTTI FISICI IN VENDITA DA ASPORTO (Shampoo, Cere, Lozioni, Cosmetici):
       ${productsListText}

       ${historyText}

       LINEE GUIDA PER LE RISPOSTE:
       1. Parla in modo naturale, caldo e amichevole (usa emoji).
       2. DISTINZIONE IMPORTANTE (PRODOTTI vs SERVIZI):
          - Se il cliente chiede "che prodotti vendete?", "avete una cera?", "quanto costa lo shampoo?", rispondi elencando i PRODOTTI FISICI con i loro prezzi reali. NON confonderli con i tagli o le barbe!
          - Se il cliente chiede tagli, barbe o trattamenti estetici, fai riferimento al LISTINO SERVIZI.
       3. DOVE SIETE: se chiedono l'indirizzo, scrivi chiaramente "${salonAddress || 'in salone'}" e chiedi se vogliono prenotare.
       4. GESTIONE APPUNTAMENTO (STOP AI LOOP):
          - Se il cliente dice "Sì", "Ok", "Confermo", "A quell'ora va bene", l'intento è "confirm_booking". ESTRAI la data e l'ora proposte nell'ultimo messaggio del salone!
          - Se il cliente propone una data/ora ("oggi alle 16", "domani mattina"), l'intento è "ask_availability".
       5. INTENTI:
          - "confirm_booking": vuole bloccare il posto concordato.
          - "ask_availability": chiede orari o date disponibili.
          - "info_question": chiede info su prodotti, prezzi, indirizzo.
          - "general_greeting": saluta e basta.

       Rispondi ESCLUSIVAMENTE con un JSON valido:
       {
        "intent": "ask_availability",
        "customerName": "${recognizedClientName}",
        "date": "${todayRome}",
        "time": "",
        "serviceId": "",
        "serviceName": "",
        "replyText": "risposta dettagliata per WhatsApp"
       }`;

                  const groqMessages = [
                      { role: "system", content: autoPilotSystemPrompt },
                      { role: "user", content: messageText }
                  ];

                  let extracted = {
                      intent: "general_greeting",
                      customerName: recognizedClientName,
                      date: todayRome,
                      time: "",
                      serviceId: contextData.services[0]?.id || "",
                      serviceName: contextData.services[0]?.name || "Servizio",
                      replyText: ""
                  };

                  // I TUOI MODELLI ESATTI INTATTI
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
                                  max_tokens: 800
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
                              console.log(`[AutoPilot] ✅ Risposta (${modelId}):`, extracted.replyText);
                              aiSuccess = true;
                              break;
                          }
                      } catch (pErr) {
                          console.warn(`[AutoPilot] ⚠️ Eccezione su ${modelId}:`, pErr.message);
                      }
                  }

                  // 💡 RECUPERO INTELLIGENTE DI SERVIZIO, DATA E ORA DAL MESSAGGIO PRECEDENTE DEL SALONE
                             if (extracted.intent === "confirm_booking" && lastAssistantMsg) {
                                 // 1. Data
                                 const dateMatch = lastAssistantMsg.match(/\b(\d{1,2})\/(\d{1,2})\b/);
                                 if (dateMatch) {
                                     const currentYear = new Date().getFullYear();
                                     const dayPart = dateMatch[1].padStart(2, '0');
                                     const monthPart = dateMatch[2].padStart(2, '0');
                                     extracted.date = `${currentYear}-${monthPart}-${dayPart}`;
                                     console.log(`[AutoPilot] 💡 Data recuperata dallo storico: ${extracted.date}`);
                                 }

                                 // 2. Orario
                                 if (!extracted.time) {
                                     const timeMatch = lastAssistantMsg.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/);
                                     if (timeMatch) {
                                         extracted.time = timeMatch[0];
                                         console.log(`[AutoPilot] 💡 Orario recuperato dallo storico: ${extracted.time}`);
                                     }
                                 }

                                 // 3. Servizio
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
                                     ? `Ciao ${recognizedClientName}, ti risponderemo a brevissimo con tutti i dettagli! ✨`
                                     : `Ciao! Grazie per averci scritto da ${salonName}. Ti risponderemo a breve! ✨`;
                                 extracted.intent = "api_error";
                             }

                             const displayName = extracted.customerName || recognizedClientName || '';
                             const cleanClientPhone = senderPhone.replace(/@.*$/, '');

                             // =========================================================================
                             // 🛍️ RICONOSCIMENTO AUTOMATICO: CONFERMA ACQUISTO PRODOTTO A DOMICILIO
                             // =========================================================================
                             const isProductOrderConfirmation = (
                                 (extracted.intent === "confirm_booking" || extracted.intent === "info_question") &&
                                 !extracted.time &&
                                 (messageText.toLowerCase().includes("conferma") || messageText.toLowerCase().includes("tutto ok") || messageText.toLowerCase().includes("consegnare") || messageText.toLowerCase().includes("contanti")) &&
                                 lastAssistantMsg.toLowerCase().includes("consegn")
                             );

                             if (isProductOrderConfirmation) {
                                 try {
                                     console.log(`[AutoPilot] 📦 Rilevata conferma ordine prodotto da ${cleanClientPhone}! Estrazione dati in corso...`);

                                     // 1. Estrazione Quantità (es. "3 pezzi", "2 confezioni")
                                                        const qtyMatch = messageText.match(/(\d+)\s*(unità|pezzi|confezioni|pz)/i) || messageText.match(/(\d+)\s*x/i);
                                                        const orderedQty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
                                     
                                                        let orderedProductName = "Prodotto da Asporto";
                                                        let orderedProductPrice = 18;
                                                        let shippingCost = 5;
                                     
                                                        // Cerca il prodotto ordinato nel catalogo reale
                                                        if (contextData.products && contextData.products.length > 0) {
                                                            const foundProd = contextData.products.find(p => messageText.toLowerCase().includes(p.name.toLowerCase()));
                                                            if (foundProd) {
                                                                orderedProductName = foundProd.name;
                                                                orderedProductPrice = parseFloat(foundProd.price) || 18;
                                                            }
                                                        }
                                     
                                                        // CALCOLO MATEMATICO CORRETTO: Prodotto * Quantità + Consegna
                                                        const subtotal = orderedProductPrice * orderedQty;
                                                        const finalTotal = subtotal + shippingCost;

                                     // Estrazione indirizzo (cerca "a: Indirizzo" o "consegnare a...")
                                     let deliveryAddress = "Viale dei Cappuccini 5";
                                     let deliveryZip = "00049";
                                     let deliveryCity = "Velletri";

                                     const addrMatch = lastAssistantMsg.match(/(?:consegnare a|consegneremo a|destinato a)\s*:?\s*\*?([^*\n.]+)/i);
                                     if (addrMatch && addrMatch[1]) {
                                         deliveryAddress = addrMatch[1].trim();
                                     }

                                     const zipMatch = deliveryAddress.match(/\b(00\d{3}|\d{5})\b/);
                                     if (zipMatch) deliveryZip = zipMatch[1];

                                     const orderPayload = {
                                         action: 'save_whatsapp_product_order',
                                         vendorId: vendorId,
                                         customerName: displayName || "Cliente WhatsApp",
                                         customerPhone: cleanClientPhone,
                                         deliveryAddress: deliveryAddress,
                                         deliveryZip: deliveryZip,
                                         deliveryCity: deliveryCity,
                                         orderNotes: 'Ordinato tramite WhatsApp AI - Pagamento in contanti alla consegna',
                                         totalPrice: finalTotal,
                                         shippingCost: shippingCost,
                                         items: [{
                                             productName: orderedProductName,
                                             quantity: 1,
                                             price: orderedProductPrice
                                         }]
                                     };

                                     const orderRes = await fetch(API_BASE_URL, {
                                         method: 'POST',
                                         headers: { 'Content-Type': 'application/json' },
                                         body: JSON.stringify(orderPayload)
                                     });

                                     if (orderRes.ok) {
                                         const orderJson = await orderRes.json();
                                         console.log(`[AutoPilot] 🔔 ORDINE PRODOTTO REGISTRATO SULLA DASHBOARD! ID: ${orderJson.orderId}`);
                                         finalReply = `Ciao ${displayName || 'Marco'}! ✅ Il tuo ordine per **1 unità di ${orderedProductName}** è confermato ed è stato inviato al salone!\n\n📍 Consegna a: *${deliveryAddress}*\n💶 **Totale da pagare al Rider:** ${finalTotal} € (contanti alla consegna).\n\nGrazie mille e a presto! ✂️🚚`;
                                     }
                                 } catch (ordErr) {
                                     console.error("[AutoPilot] ⚠️ Errore creazione ordine prodotto:", ordErr);
                                 }
                             }

                             // 3. GESTIONE APPUNTAMENTO (SE NON È UN ORDINE PRODOTTO)
                             const matchedService = contextData.services.find(s => s.id === extracted.serviceId)
                                 || contextData.services.find(s => s.name.toLowerCase().includes((extracted.serviceName || '').toLowerCase()))
                                 || contextData.services[0]
                                 || { id: 'default', name: 'Servizio', duration: 30 };

                             const targetDate = extracted.date || todayRome;
                             const dateParts = targetDate.split('-');
                             const dateReadable = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}` : targetDate;

                             if (!isProductOrderConfirmation && (extracted.intent === "ask_availability" || extracted.intent === "confirm_booking") && targetDate) {
                                 let availableSlots = [];
                                 try {
                                     console.log(`[AutoPilot] 📅 Controllo slot per ${targetDate} - Servizio: ${matchedService.id}`);
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

                                         console.log(`[AutoPilot] 💾 Salvataggio appuntamento per ${targetDate} alle ${extracted.time} (Servizio: ${matchedService.name})...`);

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
                                             finalReply = `🎉 Perfetto ${displayName}! Ti confermo l'appuntamento per *${matchedService.name}* in data *${dateReadable}* alle ore *${extracted.time}*.\nTi abbiamo inserito in agenda, a presto! ✂️✨`;
                                             console.log(`[AutoPilot] ✅ APPUNTAMENTO REGISTRATO A CALENDARIO CON SUCCESSO!`);
                                         } else {
                                             const errJson = await saveRes.json().catch(() => ({}));
                                             console.warn("[AutoPilot] ⚠️ Errore salvataggio:", errJson.error);
                                             finalReply = `Ci dispiace ${displayName}, ma lo slot delle ${extracted.time} del ${dateReadable} non è più disponibile. Vuoi che controlliamo un altro orario?`;
                                         }
                                     } catch (bErr) {
                                         console.error("[AutoPilot] ⚠️ Eccezione salvataggio:", bErr);
                                         finalReply = `Abbiamo preso nota della tua richiesta per le ${extracted.time}, ti confermo tutto a brevissimo!`;
                                     }
                                 }
                                 // CASO B: IL CLIENTE CHIEDE DISPONIBILITÀ
                                 else if (extracted.intent === "ask_availability") {
                                     if (extracted.time) {
                                         const isTimeFree = availableSlots.includes(extracted.time);
                                         if (isTimeFree) {
                                             finalReply = `Sì ${displayName}! Alle *${extracted.time}* del ${dateReadable} siamo liberi per *${matchedService.name}*. Ti blocco il posto in agenda? ✂️`;
                                         } else {
                                             if (availableSlots.length > 0) {
                                                 const alternatives = availableSlots.slice(0, 3).join(', ');
                                                 finalReply = `Purtroppo alle ${extracted.time} siamo al completo! Però per *${matchedService.name}* ho liberi questi orari: *${alternatives}*. Ti andrebbe bene uno di questi?`;
                                             } else {
                                                 finalReply = `Purtroppo per il ${dateReadable} siamo al completo per *${matchedService.name}*. Vuoi che controlliamo per un altro giorno?`;
                                             }
                                         }
                                     } else {
                                         if (availableSlots.length > 0) {
                                             const alternatives = availableSlots.slice(0, 3).join(', ');
                                             finalReply = `Certo ${displayName}! Per *${matchedService.name}* (${dateReadable}) ho liberi questi orari: *${alternatives}*. A che ora preferisci? ✂️`;
                                         } else {
                                             finalReply = `Ciao ${displayName}! Purtroppo per il ${dateReadable} non ci sono orari disponibili. Ti controllo un'altra data?`;
                                         }
                                     }
                                 }
                             }

                  // 4. SALVA LA MEMORIA DELLA CONVERSAZIONE
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

                  // 5. INVIA LA RISPOSTA SU WHATSAPP TRAMITE IL GATEWAY
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

        // --- TRASCRIZIONE AUTOMATICA MULTILINGUA DEI VOCALI (Whisper Groq con Auto-Detect) ---
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

        // --- SELEZIONE AUTOMATICA DELLE ISTRUZIONI ---
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

        // FASE 3: AUTO-DISCOVERY DEI MODELLI GROQ ATTIVI IN TEMPO REALE
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

        // TUA LISTA ORIGINALE DI FALLBACK INTATTA
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
