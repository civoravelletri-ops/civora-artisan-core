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
        let temperature = 0.5;
        let maxTokensBudget = 800;

        const currentSector = contesto.settore || "";

        if (currentSector === "cura_persona") {
            systemPrompt = `Sei un esperto di marketing per il settore Wellness, Beauty e Salute.
Il tuo obiettivo è trasmettere fiducia, relax e professionalità per un'attività di "${contesto.myTypeStore || 'Cura della Persona'}".
Enfatizza il benessere del cliente e il risultato emozionale. Usa un linguaggio caldo, elegante ed essenziale.`;
        } else if (currentSector === "veterinario") {
            systemPrompt = `Sei un esperto di marketing per cliniche veterinarie e pet care. Trasmetti professionalità, empatia e cura.`;
        } else if (currentSector === "agrigarden") {
            systemPrompt = `Sei l'Assistente Digitale per AgriGarden. Tono rustico, sincero e umano.`;
        } else {
            systemPrompt = `Sei un esperto di marketing per negozi e attività commerciali.`;
        }

        systemPrompt += `\n\nREGOLA TASSATIVA: Rispondi SOLO ed ESCLUSIVAMENTE con il testo finale in italiano. Nessun commento, nessuna spiegazione, nessun ragionamento in inglese.`;

        let userPromptContent = '';

        if (currentSector === "cura_persona") {
            const isProfile = campo.endsWith("_profile");
            const entityName = isProfile ? (contesto.store_name || "questo studio") : (contesto.product_name || "questo servizio");
            const entityType = isProfile ? (contesto.myTypeStore || "attività di cura della persona") : (contesto.product_category || "cura della persona");
            const baseInfo = `Attività: "${entityName}" (${entityType}).`;
            const currentText = (contesto.currentFieldValue || "").trim();

            if (campo === "short_description_profile") {
                userPromptContent = `${baseInfo}\nCrea uno slogan accattivante (max 140 caratteri). Testo di partenza: "${currentText}"`;
                maxTokensBudget = 100;
            } else if (campo === "description_profile") {
                userPromptContent = `${baseInfo}\nScrivi una descrizione calda ed elegante per i clienti di ESATTAMENTE 2 brevi paragrafi (circa 500-600 caratteri in totale). Testo di partenza: "${currentText}"`;
                maxTokensBudget = 400;
            } else if (campo === "tags_profile" || campo === "specializations_profile") {
                userPromptContent = `${baseInfo}\nGenera 6-8 voci separate da virgola. Testo di partenza: "${currentText}"`;
                maxTokensBudget = 150;
            } else {
                userPromptContent = `${baseInfo}\nGenera il contenuto per "${campo}". Testo di partenza: "${currentText}"`;
                maxTokensBudget = 250;
            }
        } else if (currentSector === "veterinario") {
            const currentText = (contesto.currentFieldValue || "").trim();
            if (campo === "short_description_profile_vet") {
                userPromptContent = `Clinica: "${contesto.store_name}". Crea uno slogan conciso (max 140 caratteri).`;
                maxTokensBudget = 100;
            } else if (campo === "description_profile_vet") {
                userPromptContent = `Clinica: "${contesto.store_name}". Scrivi una descrizione di 2 brevi paragrafi (max 600 caratteri).`;
                maxTokensBudget = 400;
            } else {
                userPromptContent = `Genera 5-7 voci separate da virgola per "${campo}".`;
                maxTokensBudget = 150;
            }
        } else if (campo === "storia_azienda") {
            userPromptContent = `Riscrivi questa filosofia aziendale per un vivaio: "${(contesto.testo || '').trim()}".`;
            maxTokensBudget = 500;
        } else if (task === "estimate_shipping_attributes") {
            systemPrompt = `Rispondi ESCLUSIVAMENTE con un JSON valido con: "weight" (kg), "length" (cm), "width" (cm), "height" (cm).`;
            userPromptContent = `Estima peso e dimensioni per: "${contesto.productName || contesto.nome}".`;
            maxTokensBudget = 150;
        } else {
            userPromptContent = `Genera un contenuto commerciale conciso per "${task}" relativo a "${contesto.nome || contesto.productName}".`;
            maxTokensBudget = 300;
        }

        let messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPromptContent }
        ];

        let responseFormat = null;
        if (task === "estimate_shipping_attributes") {
            responseFormat = { "type": "json_object" };
        }

        const candidateModels = [
            "openai/gpt-oss-20b",
            "qwen/qwen3.6-27b",
            "openai/gpt-oss-120b"
        ];

        let testoGenerato = null;
        let lastError = null;

        for (const modelCandidate of candidateModels) {
            try {
                const bodyRequest = {
                    model: modelCandidate,
                    messages: messages,
                    temperature: temperature,
                    max_tokens: maxTokensBudget
                };

                // Configurazione esatta per disattivare i ragionamenti in base al modello
                if (modelCandidate.includes("gpt-oss")) {
                    bodyRequest.include_reasoning = false;
                } else if (modelCandidate.includes("qwen")) {
                    bodyRequest.reasoning_format = "hidden";
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
                        console.log(`[Magia AI] Generato con successo da: ${modelCandidate}`);
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

        // === PULIZIA ROBUSTA DEL TESTO ===
        testoGenerato = testoGenerato.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        testoGenerato = testoGenerato.replace(/<\/?think>/gi, "").trim();

        // Estrazione testo se ci sono sezioni Draft / Mental Refinement
        if (/Draft Generation|Mental Refinement/i.test(testoGenerato)) {
            const splitDraft = testoGenerato.split(/(?:Draft Generation[^\n]*\n|Mental Refinement[^\n]*\n)/i);
            if (splitDraft.length > 1) {
                testoGenerato = splitDraft[splitDraft.length - 1].trim();
            }
        }

        // Rimuove eventuali elenchi numerati o puntati di thinking rimasti
        testoGenerato = testoGenerato.replace(/^\s*\d+\.\s+\*\*[^*]+\*\*[\s\S]*?\n\n/gim, "").trim();
        testoGenerato = testoGenerato.replace(/^\s*-\s+[^\n]+\n/gm, "").trim();
        testoGenerato = testoGenerato.replace(/^["']+|["']+$/g, "").trim();

        // 1. Spedizione JSON
        if (task === "estimate_shipping_attributes") {
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

        // 2. Risposta finale pulita
        return res.status(200).json({ risultato: testoGenerato });

    } catch (error) {
        console.error("[api/magia.js] Errore:", error);
        res.status(500).json({ errore: "Errore: " + error.message });
    }
};
