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
               // 🤖 PILOTA AUTOMATICO WHATSAPP 24/7 (INGEGNERIA CIVORA BUSINESS: MEMORIA + AGENDA REALE)
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
                               console.log(`[AutoPilot] 🧠 Contesto caricato! Cliente: ${contextData.client?.name || 'Sconosciuto'}, Servizi trovati: ${contextData.services.length}`);
                           }
                       } else {
                           console.error("[AutoPilot] ⚠️ Errore recupero contesto:", await ctxRes.text());
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
                   const servicesListText = contextData.services.length > 0
                       ? contextData.services.map(s => `- ${s.name} (ID: "${s.id}", Prezzo: ${s.price}€, Durata: ${s.duration} min)`).join('\n')
                       : '- Servizio Standard (ID: "default", Prezzo: 0€, Durata: 30 min)';

                   // 2. ISTRUZIONI INTELLIGENZA ARTIFICIALE E STORICO CHAT (BLINDATO)
                               let historyText = "";
                               if (contextData.chatHistory && Array.isArray(contextData.chatHistory) && contextData.chatHistory.length > 0) {
                                   historyText = "\nSTORICO CHAT RECENTE CON QUESTO CLIENTE:\n" +
                                       contextData.chatHistory.map(m => m.role === 'assistant' ? `Tu (Salone): ${m.content}` : `Cliente: ${m.content}`).join('\n') + "\n";
                               }

                               const autoPilotSystemPrompt = `Sei l'assistente virtuale WhatsApp del salone "${salonName}".
                   Oggi è ${todayReadable} (${todayRome}).

                   DATI ATTIVITÀ:
                   - Nome Salone: ${salonName}
                   - Indirizzo esatto: ${salonAddress || 'in salone'}
                   - Telefono: ${salonPhone || ''}
                   ${recognizedClientName ? `- Nome Cliente già noto: "${recognizedClientName}". Salutalo per nome!` : '- Nome Cliente: Non noto. Sii cordiale e chiedi come si chiama se serve.'}

                   LISTINO SERVIZI:
                   ${servicesListText}
                   ${historyText}

                   LINEE GUIDA PER LE RISPOSTE:
                   1. Parla in modo naturale, caldo e amichevole (usa emoji). Tieni conto dello storico chat se presente.
                   2. Se chiedono "dove siete?" o l'indirizzo, rispondi con l'indirizzo esatto ("Ci troviamo in ${salonAddress || 'salone'}") e chiedi subito se vogliono fissare un appuntamento!
                   3. Se chiedono prezzi o durata, fornisci il prezzo e i minuti reali dal listino sopra.
                   4. Riconosci l'intento tra:
                      - "confirm_booking": se accetta, conferma o dice sì/ok a un orario concordato o proposto.
                      - "ask_availability": se chiede se c'è posto, orari liberi o propone data/ora.
                      - "info_question": se chiede dove siete, prezzi, durata o info generali.
                      - "general_greeting": se saluta e basta.
                   5. In "replyText" scrivi SEMPRE la risposta completa pronta per il cliente.

                   Rispondi ESCLUSIVAMENTE con un JSON valido in questo formato esatto:
                   {
                     "intent": "info_question",
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

                               // MODELLI IMMORTALI (Se uno fallisce passa istantaneamente all'altro)
                                           const GROQ_CANDIDATES = [
                                               "llama-3.1-8b-instant",
                                               "llama-3.3-70b-versatile",
                                               "whisper-large-v3-turbo"
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
                                                           temperature: 0.1, // Teniamo la temperatura bassissima per non farlo divagare
                                                           max_tokens: 800
                                                       })
                                                   });

                                                   if (groqRes.ok) {
                                                       const groqData = await groqRes.json();
                                                       let rawContent = groqData.choices?.[0]?.message?.content || "{}";

                                                       // Pulizia antiproiettile del JSON: se l'AI ci scrive testo attorno, noi estraiamo solo l'oggetto
                                                       let cleanJson = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
                                                       cleanJson = cleanJson.replace(/```json/gi, "").replace(/```/g, "").trim();
                                                       const firstBrace = cleanJson.indexOf('{');
                                                       const lastBrace = cleanJson.lastIndexOf('}');
                                                       if (firstBrace !== -1 && lastBrace !== -1) {
                                                           cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
                                                       }

                                                       const parsed = JSON.parse(cleanJson);
                                                       extracted = { ...extracted, ...parsed };
                                                       console.log(`[AutoPilot] ✅ Risposta generata con successo (${modelId}):`, extracted.replyText);
                                                       aiSuccess = true;
                                                       break;
                                                   } else {
                                                       const errBody = await groqRes.text();
                                                       console.warn(`[AutoPilot] ⚠️ Modello ${modelId} ha fallito (${groqRes.status}):`, errBody);
                                                   }
                                               } catch (pErr) {
                                                   console.warn(`[AutoPilot] ⚠️ Eccezione su ${modelId}:`, pErr.message);
                                               }
                                           }

                   let finalReply = extracted.replyText;

                   // Se l'AI fallisce del tutto, mostriamo un messaggio di cortesia
                   if (!aiSuccess || !finalReply) {
                       finalReply = recognizedClientName
                           ? `Ciao ${recognizedClientName}, in questo momento i nostri sistemi sono in aggiornamento. Ti risponderemo a brevissimo! ✨`
                           : `Ciao! Grazie per averci scritto da ${salonName}. I nostri sistemi sono un attimo in aggiornamento, ti risponderemo a breve! ✨`;
                       extracted.intent = "api_error";
                   }

                   const displayName = extracted.customerName || recognizedClientName || '';
                   const matchedService = contextData.services.find(s => s.id === extracted.serviceId)
                       || contextData.services.find(s => s.name.toLowerCase().includes((extracted.serviceName || '').toLowerCase()))
                       || contextData.services[0]
                       || { id: 'default', name: 'Servizio', duration: 30 };

                   const targetDate = extracted.date || todayRome;

                   // 3. SE CHIEDE DISPONIBILITÀ O CONFERMA -> CONTROLLA SUBITO L'AGENDA REALE!
                   if ((extracted.intent === "ask_availability" || extracted.intent === "confirm_booking") && targetDate) {
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
                           } else {
                               console.error("[AutoPilot] ⚠️ Errore API Slots:", await slotsRes.text());
                           }
                       } catch (sErr) {
                           console.error("[AutoPilot] ⚠️ Eccezione controllo slot:", sErr.message);
                       }

                       const dateParts = targetDate.split('-');
                       const dateReadable = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}` : targetDate;

                       // CASO A: IL CLIENTE CONFERMA -> PRENOTIAMO A DATABASE!
                       if (extracted.intent === "confirm_booking" && extracted.time) {
                           try {
                               const startDateTime = new Date(`${targetDate}T${extracted.time}:00`);
                               const durationMins = matchedService.duration || 30;
                               const endDateTime = new Date(startDateTime.getTime() + durationMins * 60000);

                               console.log(`[AutoPilot] 💾 Tentativo salvataggio per le ${extracted.time}...`);

                               const bookPayload = {
                                   action: 'save_service_booking',
                                   vendorId: vendorId,
                                   customerName: displayName || ("Cliente WhatsApp (" + senderPhone.slice(-4) + ")"),
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
                                   finalReply = `🎉 Perfetto ${displayName}! Ti confermo l'appuntamento per *${matchedService.name}* il *${dateReadable}* alle ore *${extracted.time}*. Ti abbiamo inserito in agenda, a presto! ✂️✨`;
                                   console.log(`[AutoPilot] ✅ APPUNTAMENTO REGISTRATO A CALENDARIO CON SUCCESSO!`);
                               } else {
                                   const errJson = await saveRes.json();
                                   console.warn("[AutoPilot] ⚠️ Errore salvataggio:", errJson.error);
                                   finalReply = `Ci dispiace ${displayName}, ma lo slot delle ${extracted.time} non è più disponibile. Vuoi che controlliamo un altro orario?`;
                               }
                           } catch (bErr) {
                               console.error("[AutoPilot] ⚠️ Eccezione salvataggio:", bErr);
                               finalReply = `Abbiamo preso nota della tua richiesta per le ${extracted.time}, ma ho avuto un piccolo problema di linea. Ti confermo tutto a brevissimo!`;
                           }
                       }
                       // CASO B: IL CLIENTE CHIEDE DISPONIBILITÀ ORARIA
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
                                       finalReply = `Purtroppo per il ${dateReadable} siamo completamente al completo per *${matchedService.name}*! Vuoi che controlliamo per un altro giorno?`;
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
                       const sendRes = await fetch(`${GATEWAY_BASE_URL}/send-message`, {
                           method: 'POST',
                           headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify({
                               vendorId: vendorId,
                               phone: senderPhone,
                               message: finalReply
                           })
                       });
                       const sendJson = await sendRes.json();
                       console.log(`[AutoPilot] 📤 Esito invio Gateway:`, JSON.stringify(sendJson));
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

        // FASE 0: VERIFICA PRESENZA CHIAVE API
        if (!GROQ_API_KEY) {
            return res.status(500).json({ errore: "Manca la chiave d'accesso GROQ_API_KEY nelle variabili d'ambiente di Vercel. Configurala nel tuo pannello Vercel!" });
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

        // --- SELEZIONE AUTOMATICA DELLE ISTRUZIONI (SOCIAL vs ESPERTO vs IMPORT PRENOTAZIONE) ---
        let systemPrompt = "";
        let userPromptText = "";

        if (contesto.isBookingImport) {
            // STRADA 3: Importazione e parsing intelligente dell'appuntamento (Supporto alle date alternative)
            systemPrompt = `Sei l'assistente di reception virtuale di un salone di bellezza/studio professionale. Il tuo compito è analizzare un messaggio o la trascrizione di un audio informale, abbreviato o in dialetto, inviato da un cliente per prenotare un appuntamento, ed estrarre i dati in formato JSON.

            REGOLE DI ESTRAZIONE E CALCOLO:
            1. Nome: Estrai solo il nome del cliente (es: "Marco", "Giulia"). Se non lo trovi, lascia "".
            2. Data: Calcola la data esatta in formato AAAA-MM-GG basandoti sulla data di oggi che ti viene fornita. Es: se oggi è Domenica 21 Giugno 2026, "domani" sarà "2026-06-22", "mercoledì" o "mercoledì prossimo" sarà il primo mercoledì utile "2026-06-24", ecc.
            3. Ora: Estrai l'ora richiesta in formato HH:MM (es: "17:30"). Se l'ora è generica (es: "pomeriggio"), proponi un orario coerente (es: "17:00").
            4. Servizio: Identifica quale dei servizi reali del negozio (che trovi nella lista fornita) corrisponde di più alla richiesta del cliente (es: se chiede "baffo" o "radersi" e in listino c'è "Regolazione Barba", seleziona l'ID di quel servizio). Se non trovi riscontri, lascia "".
            5. Risposta WhatsApp (CONFERMA): Se NON ti viene fornito l'elenco "alternativeSlots", genera una risposta cordiale per confermare la prenotazione richiesta (es. "Ciao Marco! Ti confermo l'appuntamento...").
            6. Risposta WhatsApp (RIFIUTO E SPOSTAMENTO): Se ti viene fornito l'elenco "alternativeSlots", significa che l'orario richiesto era occupato. Genera un messaggio super diplomatico e amichevole dove spieghi che purtroppo quell'orario/giorno è al completo, ma offri esplicitamente le date/ore alternative dell'elenco. Mantieni lo stesso identico tono del cliente (es: se scrive in modo scherzoso/amichevole, rispondigli come un amico con "un abbraccio"; se scrive in modo formale/distaccato, mantieni una risposta professionale ed educata).

            Rispondi ESCLUSIVAMENTE con un oggetto JSON pulito e valido, senza formattazione markdown (niente racchiuso in tre apici o scritte come \`\`\`json), strutturato esattamente così:
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
            // STRADA 1: Assistente Esperto del Banco
            systemPrompt = `Sei l'Assistente Esperto di un banco del Mercato Fresco di Civora.
            Il tuo obiettivo è consigliare il cliente, rispondere ai suoi dubbi e aiutarlo a usare al meglio il prodotto.

            REGOLE DI COMPORTAMENTO:
            1. TONO: Amichevole, caloroso e professionale. Usa il "tu".
            2. COMPETENZA: Dai consigli pratici su come cucinare il prodotto, come conservarlo e con cosa abbinarlo.
            3. STORYTELLING: Esalta la provenienza e la freschezza citando i dati forniti.
            4. VENDITA GENTILE: Incoraggia l'acquisto sottolineando la qualità, senza essere insolente.
            5. FORMATTAZIONE: Usa i **grassetti** e le emoji per rendere la lettura piacevole.`;

            userPromptText = `Un cliente ti chiede informazioni su questo prodotto:
            - Nome: "${contesto.nome}"
            - Categoria: "${contesto.categoria || 'Alimentari'}"
            - Provenienza: "${contesto.provenienza || 'Italia'}"
            - Descrizione del Venditore: "${contesto.descrizione || ''}"
            - Dettagli Tecnici: "${contesto.specifiche || ''}"

            DOMANDA DEL CLIENTE: "${contesto.nota_extra}"`;

        } else {
            // STRADA 2: Senior Copywriter per i post social
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

        // Invio sempre come stringa di testo pulita per massima stabilità e velocità
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
                    // Filtra solo i modelli di testo per chat (esclude whisper, guard, embeddings)
                    const chatModels = modelsData.data
                        .map(m => m.id)
                        .filter(id => !id.includes("whisper") && !id.includes("guard") && !id.includes("embed"));

                    // Ordina mettendo in cima i modelli più intelligenti e veloci
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

        // Se la chiamata ai modelli non risponde, usa una lista sicura di fallback
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

        // Filtro di pulizia: elimina qualsiasi tag <think>...</think> o residuo prima dell'invio
        let cleanOutput = postGenerato.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        cleanOutput = cleanOutput.replace(/<\/?think>/gi, "").trim();

        // Se è una richiesta di importazione appuntamento, ripuliamo l'output e restituiamo un JSON strutturato
        if (contesto.isBookingImport) {
            const jsonCleaned = cleanOutput.replace(/```json/g, "").replace(/```/g, "").trim();
            try {
                const parsedJSON = JSON.parse(jsonCleaned);
                return res.status(200).json({ bookingData: parsedJSON });
            } catch (jsonErr) {
                console.error("Errore nel parsing del JSON restituito da Groq:", jsonErr);
                return res.status(200).json({ rawText: cleanOutput, error: "L'IA non ha restituito un formato JSON valido." });
            }
        }

        res.status(200).json({ post: cleanOutput });

    } catch (error) {
        console.error("[api/social.js] Errore critico:", error);
        res.status(500).json({ errore: "Errore interno del server: " + error.message });
    }
};
