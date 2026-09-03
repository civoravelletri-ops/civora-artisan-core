module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const { action, contesto } = body;
        const campo = body.campo || "";
        const task = action || campo;

        const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.GROQ_KEY || process.env.GROQ_AI_KEY || process.env.GROQ_TOKEN;

        if (!contesto) {
            return res.status(400).json({ errore: "Dati di contesto mancanti nella richiesta." });
        }

        if (!GROQ_API_KEY) {
            return res.status(500).json({ errore: "Manca GROQ_API_KEY nelle variabili d'ambiente di Vercel." });
        }

        let systemPrompt = "";
        const currentSector = contesto.settore || "";

        if (currentSector === "cura_persona") {
            systemPrompt = `Sei un copywriter e marketing specialist per saloni di bellezza e cura della persona.
Scrivi testi eleganti, caldi, persuasivi e commerciali in lingua italiana.
Rispondi DIRETTAMENTE con il contenuto richiesto senza introduzioni, senza virgolette e senza spiegazioni.`;
        } else if (currentSector === "veterinario") {
            systemPrompt = `Sei un copywriter per cliniche veterinarie. Tono empatico e professionale in lingua italiana.`;
        } else if (currentSector === "agrigarden") {
            systemPrompt = `Sei l'Assistente Digitale per AgriGarden. Tono rustico e umano in lingua italiana.`;
        } else {
            systemPrompt = `Sei un copywriter commerciale in lingua italiana.`;
        }

        let userPromptContent = '';
        const isVisionTask = (task === "importazione_agenda_ia" || campo === "importazione_agenda_ia");
        const rawImageUrl = contesto.imageUrl || contesto.imageBase64 || "";

        let messages = [];

        // 📸 GESTIONE SPECIALE VISION: IMPORTAZIONE VISIVA AGENDA DA FOTO
        if (isVisionTask) {
            const currentYear = contesto.currentYear || new Date().getFullYear();

            systemPrompt = `Sei un assistente esperto di OCR e decifratura di agende e calendari per saloni di bellezza e barbieri.
L'anno corrente di riferimento da usare è il ${currentYear}.

REGOLE CRUCIALI:
1. Estrai TUTTI gli appuntamenti visibili nell'immagine dall'inizio alla fine, SENZA OMETTERNE NESSUNO e senza fermarti a metà lista. Controlla ogni colonna, giorno o sezione.
2. Se sull'agenda è indicata una settimana (es. "Settimana dal 28 Ottobre al 3 Novembre"), calcola con precisione il giorno progressivo per ogni riga della tabella:
   - Lunedì = 28 Ottobre -> ${currentYear}-10-28
   - Martedì = 29 Ottobre -> ${currentYear}-10-29
   - Mercoledì = 30 Ottobre -> ${currentYear}-10-30
   - Giovedì = 31 Ottobre -> ${currentYear}-10-31
   - Venerdì = 01 Novembre -> ${currentYear}-11-01
   - Sabato = 02 Novembre -> ${currentYear}-11-02
3. Usa SEMPRE il formato data "YYYY-MM-DD" e l'ora "HH:MM" a 24 ore.
4. Se per un appuntamento non è scritto il nome del cliente ma solo il servizio/lettera, lascia "cliente": "".

Rispondi ESCLUSIVAMENTE con un oggetto JSON valido contenente la chiave "prenotazioni", strutturato esattamente così:
{
  "prenotazioni": [
    {
      "data": "YYYY-MM-DD",
      "ora": "HH:MM",
      "cliente": "Nome del cliente se presente, altrimenti stringa vuota",
      "telefono": "Numero di telefono se presente, altrimenti stringa vuota",
      "servizio": "Nome o abbreviazione del servizio rilevato",
      "note": "Eventuali note o cancellature rilevate, altrimenti stringa vuota"
    }
  ]
}`;

            messages = [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `Estrai TUTTI gli appuntamenti presenti in questa foto dell'agenda usando l'anno ${currentYear}, calcolando la data esatta per ogni giorno della settimana. Includi ogni singolo cliente fino alla fine della pagina. Restituisci solo JSON.`
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: rawImageUrl
                            }
                        }
                    ]
                }
            ];
        } else if (currentSector === "cura_persona") {
            const isProfile = campo.endsWith("_profile");
            const entityName = isProfile ? (contesto.store_name || "questo studio") : (contesto.product_name || "questo servizio");
            const entityType = isProfile ? (contesto.myTypeStore || "salone di bellezza") : "cura della persona";
            const baseInfo = `Attività: "${entityName}" (${entityType}).`;
            const currentText = (contesto.currentFieldValue || "").trim();

            if (campo === "short_description_profile") {
                userPromptContent = `${baseInfo}\nCrea un breve slogan ad effetto (massimo 120 caratteri) che catturi l'attenzione. Rispondi solo con lo slogan.`;
            } else if (campo === "description_profile") {
                userPromptContent = `${baseInfo}\nScrivi una descrizione accogliente ed elegante per i clienti di ESATTAMENTE 2 brevi paragrafi (circa 500-650 caratteri in totale). Non superare i 750 caratteri totali.`;
            } else if (campo === "tags_profile") {
                userPromptContent = `${baseInfo}\nGenera 7-10 parole chiave (tags) separate ESCLUSIVAMENTE da virgola, senza numeri e senza punti elenco. Esempio: bellezza, relax, cura viso, benessere, trattamenti`;
            } else if (campo === "specializations_profile") {
                userPromptContent = `${baseInfo}\nGenera 5-7 specializzazioni chiave separate ESCLUSIVAMENTE da virgola, senza numeri e senza punti elenco. Esempio: Taglio personalizzato, Trattamenti bio, Colore naturale, Modellatura barba`;
            } else {
                userPromptContent = `${baseInfo}\nGenera il contenuto per "${campo}". Testo base: "${currentText}"`;
            }

            messages = [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPromptContent }
            ];
        } else if (currentSector === "veterinario") {
            const currentText = (contesto.currentFieldValue || "").trim();
            if (campo === "short_description_profile_vet") {
                userPromptContent = `Clinica: "${contesto.store_name}". Crea uno slogan accattivante (max 120 caratteri).`;
            } else if (campo === "description_profile_vet") {
                userPromptContent = `Clinica: "${contesto.store_name}". Scrivi una descrizione di 2 brevi paragrafi (max 650 caratteri).`;
            } else if (campo === "tags_profile_vet" || campo === "specializations_profile_vet") {
                userPromptContent = `Clinica: "${contesto.store_name}". Genera 6-8 voci separate da virgola, senza elenchi numerati.`;
            } else {
                userPromptContent = `Genera il contenuto per "${campo}".`;
            }

            messages = [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPromptContent }
            ];
        } else if (campo === "storia_azienda") {
            userPromptContent = `Riscrivi questa filosofia aziendale per un vivaio: "${(contesto.testo || '').trim()}".`;
            messages = [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPromptContent }
            ];
        } else if (task === "estimate_shipping_attributes") {
            systemPrompt = `Rispondi ESCLUSIVAMENTE con un JSON valido: {"weight": 3.5, "length": 25, "width": 25, "height": 60}`;
            userPromptContent = `Estima peso e dimensioni per: "${contesto.productName || contesto.nome}".`;
            messages = [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPromptContent }
            ];
        } else {
            userPromptContent = `Genera un contenuto conciso per "${task}" relativo a "${contesto.nome || contesto.productName}".`;
            messages = [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPromptContent }
            ];
        }

        let responseFormat = null;
        if (task === "estimate_shipping_attributes" || isVisionTask) {
            responseFormat = { "type": "json_object" };
        }

        const candidateModels = isVisionTask
            ? [
                "qwen/qwen3.6-27b",
                "meta-llama/llama-4-scout-17b-16e-instruct"
              ]
            : [
                "qwen/qwen3.6-27b",
                "openai/gpt-oss-20b",
                "openai/gpt-oss-120b"
              ];

        let testoGenerato = null;
        let lastError = null;

        for (const modelCandidate of candidateModels) {
            try {
                // MODIFICA CRUCIALE: Token generosi e temperatura precisa per l'agenda!
                const bodyRequest = {
                    model: modelCandidate,
                    messages: messages,
                    temperature: isVisionTask ? 0.1 : 0.7,
                    max_tokens: isVisionTask ? 4096 : 800
                };

                // Disattiva il ragionamento su Qwen per evitare consumo inutile di token
                if (modelCandidate.includes("qwen")) {
                    bodyRequest.reasoning_effort = "none";
                } else if (modelCandidate.includes("gpt-oss")) {
                    bodyRequest.include_reasoning = false;
                }

                if (responseFormat) {
                    bodyRequest.response_format = responseFormat;
                }

                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${GROQ_API_KEY.trim()}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(bodyRequest)
                });

                const data = await response.json();

                if (response.ok && data.choices && data.choices.length > 0) {
                    const choice = data.choices[0];
                    testoGenerato = (choice.message?.content || "").trim();
                    if (testoGenerato) {
                        console.log(`[Magia AI] Successo con: ${modelCandidate}`);
                        break;
                    }
                } else {
                    const errMsg = data.error?.message || `HTTP ${response.status}`;
                    console.warn(`[Magia AI] Modello ${modelCandidate} fallito: ${errMsg}`);
                    lastError = new Error(errMsg);
                }
            } catch (callErr) {
                lastError = callErr;
            }
        }

        if (!testoGenerato) {
            return res.status(500).json({ errore: "Errore durante la generazione: " + (lastError?.message || "Servizio non disponibile") });
        }

        // === PULIZIA FINALE SICURA ===
        testoGenerato = testoGenerato.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        testoGenerato = testoGenerato.replace(/<\/?think>/gi, "").trim();

        if (/Draft Generation|Mental Refinement|thinking process/i.test(testoGenerato)) {
            const splitDraft = testoGenerato.split(/(?:Draft Generation[^\n]*\n|Mental Refinement[^\n]*\n|thinking process[^\n]*\n)/i);
            if (splitDraft.length > 1) {
                testoGenerato = splitDraft[splitDraft.length - 1].trim();
            }
        }

        testoGenerato = testoGenerato.replace(/^\s*\d+\.\s+\*\*[^*]+\*\*[\s\S]*?\n\n/gim, "").trim();
        testoGenerato = testoGenerato.replace(/^["']+|["']+$/g, "").trim();

        // Risposte JSON strutturate
        if (task === "estimate_shipping_attributes" || isVisionTask) {
            try {
                const start = testoGenerato.indexOf('{');
                const end = testoGenerato.lastIndexOf('}');
                if (start !== -1 && end !== -1) {
                    testoGenerato = testoGenerato.substring(start, end + 1);
                }
                JSON.parse(testoGenerato);
                return res.status(200).json({ risultato: testoGenerato });
            } catch (e) {
                return res.status(200).json({ risultato: testoGenerato });
            }
        }

        return res.status(200).json({ risultato: testoGenerato });

    } catch (error) {
        console.error("[api/magia.js] Errore:", error);
        res.status(500).json({ errore: "Errore: " + error.message });
    }
};
