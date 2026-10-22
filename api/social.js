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
                // 🤖 PILOTA AUTOMATICO WHATSAPP 24/7 (RICEZIONE, VERIFICA E PRENOTAZIONE REALE)
                // =========================================================================
                if (body.isWhatsAppAutoPilot && body.vendorId && body.senderPhone) {
                    const vendorId = body.vendorId;
                    const senderPhone = body.senderPhone;
                    const messageText = (body.messageText || "").trim();
        
                    if (!messageText) {
                        return res.status(200).json({ status: "skipped", reason: "Messaggio vuoto" });
                    }
        
                    console.log(`[AutoPilot] 🚀 Elaborazione per ${senderPhone} (Salone: ${vendorId}): "${messageText}"`);
        
                    const todayFormatted = new Date().toLocaleDateString('it-IT', {
                        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
                    });
        
                    // 1. Prompt per l'IA: capisce l'intento ed estrae i dati per la prenotazione
                    const autoPilotSystemPrompt = `Sei l'assistente virtuale WhatsApp del salone. Oggi è ${todayFormatted}.
                    Devi analizzare cosa dice il cliente ed estrarre i dati.
                    
                    REGOLE:
                    1. intent: "confirm_booking" (se accetta o conferma l'orario), "booking_request" (se chiede orari o se c'è posto), "general_question" (se saluta o fa domande generiche).
                    2. customerName: estrai il nome se lo menziona, altrimenti "".
                    3. date: formato YYYY-MM-DD relativo a oggi. Se non specificato, usa la data di oggi.
                    4. time: formato HH:MM se richiesto o concordato, altrimenti "".
                    5. serviceName: nome generico del servizio richiesto (es. Taglio, Piega), default "Servizio".
                    6. replyText: Rispondi in modo caldo e breve (con emoji). 
                       - Se saluta e basta, dai il benvenuto. 
                       - Se chiede "c'è posto?" ma NON dice il servizio, chiedigli "Certo! Che servizio desideri fare?".
                       - Se chiede un appuntamento e specifica il servizio, chiedigli a che ora preferisce o proponi tu.
        
                    Rispondi ESCLUSIVAMENTE con un JSON valido (senza markdown o spiegazioni extra):
                    {
                       "intent": "general_question",
                       "customerName": "",
                       "date": "",
                       "time": "",
                       "serviceName": "Servizio",
                       "replyText": "testo risposta WhatsApp"
                    }`;
        
                    // Niente frase fissa di default qui, la mettiamo alla fine come sicurezza
                                let extracted = { intent: "general_question", customerName: "", date: "", time: "", serviceName: "Servizio", replyText: "" };
                    
                                try {
                                    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                                        method: "POST",
                                        headers: {
                                            "Authorization": `Bearer ${GROQ_API_KEY}`,
                                            "Content-Type": "application/json"
                                        },
                                        body: JSON.stringify({
                                            model: "llama-3.3-70b-versatile",
                                            // Tolto response_format perché a volte fa confondere il modello LLaMA
                                            messages: [
                                                { role: "system", content: autoPilotSystemPrompt },
                                                { role: "user", content: `Messaggio cliente (${senderPhone}): "${messageText}"` }
                                            ],
                                            temperature: 0.1,
                                            max_tokens: 350
                                        })
                                    });
                    
                                    if (groqRes.ok) {
                                        const groqData = await groqRes.json();
                                        let rawContent = groqData.choices?.[0]?.message?.content || "";
                                        
                                        // PULIZIA ESTREMA: Cerchiamo e prendiamo solo quello che c'è tra le parentesi graffe { }
                                        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
                                        if (jsonMatch) {
                                            const parsed = JSON.parse(jsonMatch[0]);
                                            // Uniamo i dati trovati dall'IA
                                            extracted = { ...extracted, ...parsed };
                                        } else {
                                            console.warn("[AutoPilot] Nessun JSON trovato in:", rawContent);
                                        }
                                    } else {
                                        const errData = await groqRes.text();
                                        console.error("[AutoPilot] Errore API Groq:", errData);
                                    }
                                } catch (pErr) {
                                    console.warn("[AutoPilot] Errore parsing Groq:", pErr.message);
                                }
                    
                                // Fallback intelligente: se l'IA non ha scritto nulla o si è rotta, usiamo la frase di emergenza
                                let finalReply = extracted.replyText || "Ciao! 👋 Grazie per averci scritto. Come possiamo prenderci cura di te oggi? ✨";
        
                    // 2. SE IL CLIENTE CONFERMA -> PRENOTIAMO FISICAMENTE A DATABASE!
                    if (extracted.intent === "confirm_booking" && extracted.date && extracted.time) {
                        try {
                            // Prende il primo servizio reale dal database del salone per non far fallire l'API
                            const admin = require('firebase-admin');
                            if (!admin.apps.length) {
                                const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
                                admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
                            }
                            const db = admin.firestore();
                            
                            const servicesSnap = await db.collection('artisan_services').where('vendorId', '==', vendorId).limit(1).get();
                            let defaultServiceId = 'whatsapp_ai_slot';
                            if (!servicesSnap.empty) {
                                defaultServiceId = servicesSnap.docs[0].id;
                            }
        
                            const clientName = extracted.customerName || `Cliente WhatsApp (${senderPhone.slice(-4)})`;
                            const startDateTime = new Date(`${extracted.date}T${extracted.time}:00`);
                            const endDateTime = new Date(startDateTime.getTime() + 30 * 60000);
        
                            console.log(`[AutoPilot] 💾 REGISTRAZIONE EFFETTIVA per ${clientName} alle ${extracted.time} del ${extracted.date}...`);
        
                            const bookPayload = {
                                action: 'save_service_booking',
                                vendorId: vendorId,
                                customerName: clientName,
                                customerPhone: senderPhone,
                                serviceId: defaultServiceId,
                                bookedServiceName: extracted.serviceName || 'Servizio',
                                bookedServicePrice: 0,
                                bookedServiceDuration: 30,
                                bookedTotalOccupiedTime: 30,
                                startDateTime: startDateTime.toISOString(),
                                endDateTime: endDateTime.toISOString(),
                                status: 'confirmed',
                                source: 'whatsapp_ai_autopilot',
                                appointmentCode: 'WA_' + Date.now().toString().slice(-4),
                                type: 'cura_persona'
                            };
        
                            const saveRes = await fetch('https://localmente-api.vercel.app/api/get-available-slots', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(bookPayload)
                            });
        
                            if (saveRes.ok) {
                                const dateParts = extracted.date.split('-');
                                const dateReadable = `${dateParts[2]}/${dateParts[1]}`;
                                finalReply = `🎉 Perfetto ${extracted.customerName || ''}! Ti confermo l'appuntamento per ${extracted.serviceName} il ${dateReadable} alle ore ${extracted.time}. Ti abbiamo inserito in agenda, a presto! ✂️`;
                                console.log(`[AutoPilot] ✅ APPUNTAMENTO REGISTRATO IN AGENDA CON SUCCESSO!`);
                            } else {
                                const errBody = await saveRes.json();
                                console.error("[AutoPilot] Errore API:", errBody);
                                finalReply = `Ci dispiace, ma lo slot delle ${extracted.time} non è al momento disponibile! Vuoi che controlliamo un altro orario?`;
                            }
                        } catch (bookErr) {
                            console.error("[AutoPilot] Errore salvataggio agenda:", bookErr);
                            finalReply = `Abbiamo preso la tua richiesta per le ${extracted.time}, ti confermeremo l'orario a brevissimo!`;
                        }
                    }
        
                    // 3. Invio della risposta al cliente su WhatsApp tramite il Gateway Baileys
                    try {
                        const gatewayUrl = (process.env.CIVORA_WHATSAPP_GATEWAY_URL || 'https://civora-whatsapp-gateway.onrender.com').replace(/\/+$/, '');
                        const sendRes = await fetch(`${gatewayUrl}/send-message`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                vendorId: vendorId,
                                phone: senderPhone,
                                message: finalReply
                            })
                        });
                        const sendJson = await sendRes.json();
                        console.log(`[AutoPilot] 📤 Esito invio Gateway a ${senderPhone}:`, JSON.stringify(sendJson));
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
