module.exports = async function handler(req, res) {
    // Permetti al tuo sito e al server Render di chiamare questa funzione (CORS)
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

        // FASE 0: VERIFICA CHIAVE GROQ
        if (!GROQ_API_KEY) {
            return res.status(500).json({ errore: "Manca la chiave GROQ_API_KEY nelle variabili d'ambiente di Vercel." });
        }

        // =========================================================================
        // 🤖 BIVIO 1: PILOTA AUTOMATICO WHATSAPP 24/7 (RECEPTIONIST & COMMESSO AI)
        // Questo blocco si attiva SOLO se il messaggio arriva dal computerino su Render!
        // =========================================================================
        if (body.isWhatsAppAutoPilot && body.vendorId && body.senderPhone) {
            const vendorId = String(body.vendorId);
            const senderPhone = String(body.senderPhone);
            const messageText = (body.messageText || "").trim();
            const pushName = (body.pushName || "").trim();

            if (!messageText) {
                return res.status(200).json({ status: "skipped", reason: "Messaggio vuoto" });
            }

            console.log(`[AutoPilot] 📩 Messaggio da ${pushName || 'Cliente'} (${senderPhone}): "${messageText}"`);

            // Helper fetch con timeout di sicurezza
            const safeFetch = async (url, options = {}, timeoutMs = 8000) => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                try {
                    return await fetch(url, { ...options, signal: controller.signal });
                } catch (e) {
                    console.warn(`[AutoPilot SafeFetch] Timeout/Errore su ${url}:`, e.message);
                    return null;
                } finally {
                    clearTimeout(timer);
                }
            };

            // 1. CHIEDE TUTTA L'ENCICLOPEDIA DEL SALONE A get-available-slots
            const ctxResponse = await safeFetch('https://localmente-api.vercel.app/api/get-available-slots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'get_autopilot_context',
                    vendorId: vendorId,
                    customerPhone: senderPhone
                })
            });

            if (!ctxResponse || !ctxResponse.ok) {
                console.error("[AutoPilot] ⚠️ Impossibile recuperare il contesto del salone da get-available-slots.");
                return res.status(500).json({ error: "Errore recupero dati salone." });
            }

            const salonData = await ctxResponse.json();
            const storeInfo = salonData.storeInfo || {};

            // 🛑 SE IL NEGOZIANTE HA SPENTO L'AUTOPILOTA DALLA DASHBOARD, NON RISPONDERE!
            if (storeInfo.whatsapp_ai_autopilot !== true) {
                console.log(`[AutoPilot] ⏸️ Pilota automatico DISATTIVATO per il salone ${vendorId}. Lascio gestire a mano.`);
                return res.status(200).json({ status: "skipped", reason: "Autopilota spento dal negoziante" });
            }

            const storeName = storeInfo.name || "Salone";
            const storeAddress = storeInfo.address || "In sede";
            const openingHours = storeInfo.opening_hours || "Orari standard";
            const parkingTips = storeInfo.parkingTips || "Parcheggio su strada nelle vicinanze.";
            const directions = storeInfo.directions || "";
            const servicesList = salonData.services || [];
            const productsList = salonData.products || [];
            const clientInfo = salonData.client || {};
            const chatHistory = salonData.chatHistory || [];

            const clientName = clientInfo.name || pushName || "Cliente";
            const clientAddress = clientInfo.address || "";
            const lastService = clientInfo.lastService || "";

            const oggi = new Date().toLocaleDateString('it-IT', {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome'
            });
            const oraAttuale = new Date().toLocaleTimeString('it-IT', {
                hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome'
            });

            // 2. ISTRUZIONI DI PERSONALITÀ PER L'AI (COMPRENDE DIALETTO, SLANG E VENDITA)
            const systemPrompt = `Sei l'assistente virtuale ufficiale e la persona di fiducia alla reception di "${storeName}".
Parli direttamente su WhatsApp con i clienti per aiutarli con il massimo calore e professionalità.

INFORMAZIONI UFFICIALI DEL SALONE:
- Nome: ${storeName}
- Indirizzo: ${storeAddress}
- Orari di Apertura: ${openingHours}
- Parcheggio: ${parkingTips}
- Come Raggiungerci: ${directions}
- Oggi è: ${oggi} (Ore attuali: ${oraAttuale})

LISTINO SERVIZI DISPONIBILI:
${JSON.stringify(servicesList, null, 2)}

PRODOTTI IN VENDITA A DOMICILIO (Consegna comoda a casa, pagamento contanti al rider):
${JSON.stringify(productsList, null, 2)}

CLIENTE:
- Nome: ${clientName}
${clientInfo.isKnown ? `- È un nostro cliente abituale!${lastService ? ` L'ultima volta ha fatto: "${lastService}". Puoi proporgli "il solito" se opportuno!` : ''}` : '- È la prima volta che ci contatta: dagli un caloroso benvenuto!'}
${clientAddress ? `- Indirizzo salvato per le consegne: ${clientAddress}` : ''}

REGOLE TASSATIVE DI COMPORTAMENTO:
1. Sii naturale, caloroso, accogliente e sintetico (è una chat di WhatsApp, usa emoji come ✨, ✂️, 💆‍♂️, 🛵). Non fare papiri noiosi.
2. COMPRENDI QUALSIASI MODO DI PARLARE: dialetti (romano, napoletano, milanese, veneto...), abbreviazioni, slang ("c'hai posto?", "quanto me costa?", "me serve 'na cera", "famo domani verso le tre?").
3. RISPONDI A QUALSIASI DOMANDA: prezzi, dove parcheggiare, se fate barba o trattamenti particolari, prodotti per capelli/barba.
4. PER GLI APPUNTAMENTI:
   - Se chiedono disponibilità o orari, USA LO STRUMENTO 'verifica_orari_disponibili'.
   - Se scelgono data e ora definitiva, USA LO STRUMENTO 'conferma_prenotazione_appuntamento'.
5. PER I PRODOTTI A CASA:
   - Se vogliono comprare o farsi portare prodotti a casa, proponi i nostri prodotti con il prezzo.
   - Chiedi o conferma l'indirizzo e USA LO STRUMENTO 'crea_ordine_prodotti_domicilio' (costo consegna 2,99€, paga alla consegna al rider).
6. Non inventare servizi o prodotti che non sono nell'elenco ufficiale.`;

            // 3. TOOLS CHE L'AI PUÒ ATTIVARE DA SOLA
            const tools = [
                {
                    type: "function",
                    function: {
                        name: "verifica_orari_disponibili",
                        description: "Verifica gli orari e i buchi realmente liberi a calendario in una certa data.",
                        parameters: {
                            type: "object",
                            properties: {
                                data: { type: "string", description: "Data AAAA-MM-GG (es: 2026-03-25)" },
                                nome_servizio: { type: "string", description: "Nome o tipo di servizio richiesto" }
                            },
                            required: ["data"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "conferma_prenotazione_appuntamento",
                        description: "Fissa e blocca definitivamente l'appuntamento nell'agenda del salone.",
                        parameters: {
                            type: "object",
                            properties: {
                                nome_cliente: { type: "string", description: "Nome del cliente" },
                                nome_servizio: { type: "string", description: "Nome esatto del servizio dal listino" },
                                data: { type: "string", description: "Data AAAA-MM-GG" },
                                ora: { type: "string", description: "Orario HH:MM (es: 15:30)" },
                                note: { type: "string", description: "Eventuali richieste particolari" }
                            },
                            required: ["nome_cliente", "nome_servizio", "data", "ora"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "crea_ordine_prodotti_domicilio",
                        description: "Crea l'ordine di prodotti con consegna a domicilio e pagamento alla consegna.",
                        parameters: {
                            type: "object",
                            properties: {
                                nome_cliente: { type: "string", description: "Nome cliente" },
                                indirizzo_consegna: { type: "string", description: "Via, numero civico e città" },
                                prodotti: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            nome: { type: "string" },
                                            quantita: { type: "number" }
                                        },
                                        required: ["nome", "quantita"]
                                    }
                                }
                            },
                            required: ["nome_cliente", "indirizzo_consegna", "prodotti"]
                        }
                    }
                }
            ];

            const messagesForAi = [
                { role: "system", content: systemPrompt },
                ...chatHistory,
                { role: "user", content: messageText }
            ];

            // 4. CHIAMATA A GROQ CON LLAMA 3.3 70B (RISPOSTA IN 800 MILLISECONDI)
            const aiCall = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "llama-3.3-70b-versatile",
                    messages: messagesForAi,
                    tools: tools,
                    tool_choice: "auto",
                    temperature: 0.6
                })
            });

            if (!aiCall.ok) {
                const errTxt = await aiCall.text();
                throw new Error(`Errore Groq API: ${errTxt}`);
            }

            const aiResJson = await aiCall.json();
            const choiceMessage = aiResJson.choices?.[0]?.message || {};
            let finalReplyText = choiceMessage.content || "";

            // 5. SE L'AI DECIDE DI ESEGUIRE UN'AZIONE (CALENDARIO O ORDINE)
            if (choiceMessage.tool_calls && choiceMessage.tool_calls.length > 0) {
                for (const tool of choiceMessage.tool_calls) {
                    const fnName = tool.function.name;
                    let fnArgs = {};
                    try { fnArgs = JSON.parse(tool.function.arguments); } catch(e){}

                    console.log(`[AutoPilot Tool] ⚡ Esecuzione azione: ${fnName}`, fnArgs);
                    let toolResult = {};

                    // A. Controllo orari liberi
                    if (fnName === "verifica_orari_disponibili") {
                        const matchedServ = servicesList.find(s => s.nome.toLowerCase().includes((fnArgs.nome_servizio || '').toLowerCase())) || servicesList[0];
                        const servId = matchedServ ? matchedServ.id : servicesList[0]?.id;

                        const slotsRes = await safeFetch('https://localmente-api.vercel.app/api/get-available-slots', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                action: 'getAvailableSlots',
                                vendorId: vendorId,
                                serviceId: servId,
                                date: fnArgs.data
                            })
                        });

                        const slotsData = slotsRes ? await slotsRes.json() : {};
                        toolResult = {
                            data: fnArgs.data,
                            orari_liberi_trovati: slotsData.slots || ["Nessun orario libero trovato per questo giorno."]
                        };
                    }

                    // B. Conferma prenotazione a calendario
                    else if (fnName === "conferma_prenotazione_appuntamento") {
                        const matchedServ = servicesList.find(s => s.nome.toLowerCase().includes((fnArgs.nome_servizio || '').toLowerCase())) || servicesList[0];
                        const dur = parseInt(matchedServ?.durata) || 30;
                        const startD = new Date(`${fnArgs.data}T${fnArgs.ora}:00`);
                        const endD = new Date(startD.getTime() + dur * 60000);

                        const bookPayload = {
                            action: 'save_service_booking',
                            vendorId: vendorId,
                            customerName: fnArgs.nome_cliente || clientName,
                            customerPhone: senderPhone,
                            serviceId: matchedServ?.id || 'whatsapp_booking',
                            bookedServiceName: matchedServ?.nome || fnArgs.nome_servizio,
                            bookedServicePrice: parseFloat(matchedServ?.prezzo) || 0,
                            bookedServiceDuration: dur,
                            bookedTotalOccupiedTime: dur,
                            startDateTime: startD.toISOString(),
                            endDateTime: endD.toISOString(),
                            status: 'confirmed',
                            source: 'whatsapp_ai_autopilot',
                            bookingOrigin: 'online',
                            platformFee: 0.35,
                            notes: fnArgs.note || 'Prenotato via assistente AI WhatsApp'
                        };

                        const saveRes = await safeFetch('https://localmente-api.vercel.app/api/get-available-slots', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(bookPayload)
                        });

                        toolResult = (saveRes && saveRes.ok)
                            ? { status: 'confermato_in_agenda', giorno: fnArgs.data, ora: fnArgs.ora, servizio: matchedServ?.nome }
                            : { status: 'errore_slot_occupato' };
                    }

                    // C. Creazione ordine prodotti a domicilio
                    else if (fnName === "crea_ordine_prodotti_domicilio") {
                        const orderedItems = (fnArgs.prodotti || []).map(item => {
                            const found = productsList.find(p => p.nome.toLowerCase().includes((item.nome || '').toLowerCase()));
                            return {
                                productName: found ? found.nome : item.nome,
                                price: found ? parseFloat(found.prezzo) : 12,
                                quantity: Number(item.quantita) || 1
                            };
                        });

                        const subtotal = orderedItems.reduce((acc, curr) => acc + (curr.price * curr.quantity), 0);
                        const shipping = 2.99;
                        const total = subtotal + shipping;

                        await safeFetch('https://localmente-api.vercel.app/api/get-available-slots', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                action: 'save_whatsapp_product_order',
                                vendorId: vendorId,
                                customerName: fnArgs.nome_cliente || clientName,
                                customerPhone: senderPhone,
                                deliveryAddress: fnArgs.indirizzo_consegna || clientAddress || 'Da concordare',
                                items: orderedItems,
                                totalPrice: total,
                                shippingCost: shipping
                            })
                        });

                        toolResult = { status: 'ordine_creato', totale_da_pagare_al_rider: `${total.toFixed(2)} €` };
                    }

                    // L'AI formula il messaggio finale conversazionale da inviare al cliente
                    messagesForAi.push(choiceMessage);
                    messagesForAi.push({
                        role: "tool",
                        tool_call_id: tool.id,
                        content: JSON.stringify(toolResult)
                    });

                    const finalCall = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${GROQ_API_KEY}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            model: "llama-3.3-70b-versatile",
                            messages: messagesForAi,
                            temperature: 0.6
                        })
                    });

                    const finalData = await finalCall.json();
                    finalReplyText = finalData.choices?.[0]?.message?.content || finalReplyText;
                }
            }

            // 6. SALVA IL MESSAGGIO NELLA CRONOLOGIA DELLA CHAT
            await safeFetch('https://localmente-api.vercel.app/api/get-available-slots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_autopilot_message',
                    vendorId: vendorId,
                    customerPhone: senderPhone,
                    userMessage: messageText,
                    aiReply: finalReplyText,
                    customerName: clientName
                })
            });

            // 7. INVIA IL MESSAGGIO SU WHATSAPP TRAMITE IL COMPUTERINO SU RENDER
            const gatewayUrl = (process.env.CIVORA_WHATSAPP_GATEWAY_URL || 'https://civora-whatsapp-gateway.onrender.com').replace(/\/+$/, '');
            await safeFetch(`${gatewayUrl}/send-message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vendorId: vendorId,
                    phone: senderPhone,
                    message: finalReplyText
                })
            });

            console.log(`[AutoPilot] 🚀 Risposta inviata con successo a ${senderPhone}!`);
            return res.status(200).json({ success: true, processed: true, reply: finalReplyText });
        }

        // =========================================================================
        // 🛍️ BIVIO 2: IL CODICE SOCIAL / COPYWRITER / IMPORT PRENOTAZIONI ESISTENTE
        // Da qui in giù è il tuo vecchio codice al 100%, non è stato toccato nulla!
        // =========================================================================
        const contesto = body.contesto;
        if (!contesto) {
            return res.status(400).json({ errore: "Dati di contesto mancanti nella richiesta." });
        }

        // Calcolo Urgenza e Sconto (per i post social)
        const isLowStock = contesto.quantita > 0 && contesto.quantita <= 3;
        const hasDiscount = contesto.originalPrice && contesto.originalPrice > (contesto.prezzo || 0);
        const discountPercent = hasDiscount ? Math.round(((contesto.originalPrice - contesto.prezzo) / contesto.originalPrice) * 100) : 0;

        // --- TRASCRIZIONE AUTOMATICA MULTILINGUA DEI VOCALI (Whisper Groq) ---
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

        let systemPrompt = "";
        let userPromptText = "";

        if (contesto.isBookingImport) {
            systemPrompt = `Sei l'assistente di reception virtuale di un salone di bellezza/studio professionale. Il tuo compito è analizzare un messaggio o la trascrizione di un audio informale, abbreviato o in dialetto, inviato da un cliente per prenotare un appuntamento, ed estrarre i dati in formato JSON.

            REGOLE DI ESTRAZIONE E CALCOLO:
            1. Nome: Estrai solo il nome del cliente (es: "Marco", "Giulia"). Se non lo trovi, lascia "".
            2. Data: Calcola la data esatta in formato AAAA-MM-GG basandoti sulla data di oggi che ti viene fornita. Es: se oggi è Domenica 21 Giugno 2026, "domani" sarà "2026-06-22", "mercoledì" o "mercoledì prossimo" sarà il primo mercoledì utile "2026-06-24", ecc.
            3. Ora: Estrai l'ora richiesta in formato HH:MM (es: "17:30"). Se l'ora è generica (es: "pomeriggio"), proponi un orario coerente (es: "17:00").
            4. Servizio: Identifica quale dei servizi reali del negozio (che trovi nella lista fornita) corrisponde di più alla richiesta del cliente. Se non trovi riscontri, lascia "".
            5. Risposta WhatsApp (CONFERMA): Se NON ti viene fornito l'elenco "alternativeSlots", genera una risposta cordiale per confermare la prenotazione richiesta.
            6. Risposta WhatsApp (RIFIUTO E SPOSTAMENTO): Se ti viene fornito l'elenco "alternativeSlots", significa che l'orario richiesto era occupato. Genera un messaggio super diplomatico e amichevole dove spieghi che purtroppo quell'orario/giorno è al completo, ma offri esplicitamente le date/ore alternative dell'elenco.

            Rispondi ESCLUSIVAMENTE con un oggetto JSON pulito e valido, senza formattazione markdown:
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

        // Auto-discovery modelli Groq
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
                            return 10;
                        };
                        return score(b) - score(a);
                    });
                    dynamicModelsList = chatModels;
                }
            }
        } catch (e) {
            console.warn("[Groq Discovery] Uso lista fallback:", e.message);
        }

        const GROQ_TEXT_MODELS = dynamicModelsList.length > 0 ? dynamicModelsList : [
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant"
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
                    break;
                } else {
                    lastChatError = new Error(data.error?.message || `HTTP ${response.status}`);
                }
            } catch (callErr) {
                lastChatError = callErr;
            }
        }

        if (!postGenerato) {
            return res.status(500).json({ errore: "Errore generazione con Groq: " + (lastChatError?.message || "Servizio non disponibile") });
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
