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
Enfatizza il benessere del cliente e il risultato emozionale. Usa un linguaggio caldo ed elegante.`;
        } else if (currentSector === "veterinario") {
            systemPrompt = `Sei un esperto di marketing per cliniche veterinarie e pet care. Trasmetti professionalità, empatia e cura.`;
        } else if (currentSector === "agrigarden") {
            systemPrompt = `Sei l'Assistente Digitale per AgriGarden. Tono rustico, sincero e umano.`;
        } else {
            systemPrompt = `Sei un esperto di marketing per negozi e attività commerciali.`;
        }

        systemPrompt += `\n\nREGOLE FONDAMENTALI TASSATIVE:
1. NON scrivere assolutamente il tuo processo di pensiero o frasi come "Here's a thinking process", "Thinking Process", "Analyze User Input", ecc.
2. Inizia la risposta IMMEDIATAMENTE con il testo finale in italiano.
3. NON usare virgolette all'inizio e alla fine.
4. Rispondi ESCLUSIVAMENTE con il testo richiesto.`;

        let userPromptContent = '';

        if (currentSector === "cura_persona") {
            const infoBaseServizio = `Servizio: "${contesto.nome}". Categoria: "${contesto.categoria} / ${contesto.sottocategoria || ''}". Tipo Attività: "${contesto.myTypeStore}". Prezzo: ${contesto.prezzo}€. Durata: ${contesto.durata} min.`;

            if (campo === "titolo_cura") {
                userPromptContent = infoBaseServizio + `\nGenera un titolo professionale (max 60 caratteri).`;
                maxTokensBudget = 80;
            } else if (campo === "descrizione_breve_cura") {
                userPromptContent = infoBaseServizio + `\nGenera una descrizione brevissima (slogan, max 150 caratteri).`;
                maxTokensBudget = 100;
            } else if (campo.endsWith("_profile") || campo.endsWith("_cura_product")) {
                const isProfile = campo.endsWith("_profile");
                const entityName = isProfile ? (contesto.store_name || "questo studio") : (contesto.product_name || "questo prodotto");
                const entityType = isProfile ? (contesto.myTypeStore || "attività di cura della persona") : (contesto.product_category || "prodotto");
                const baseInfo = isProfile ?
                    `Nome Studio: "${entityName}". Tipologia: "${entityType}".` :
                    `Prodotto: "${entityName}". Categoria: "${entityType}".`;

                const currentText = (contesto.currentFieldValue || "").trim();
                let actionPrompt = currentText ?
                    `Migliora e riscrivi questo testo in modo elegante, mantenendo l'intento originale:` :
                    `Genera un testo originale per questo campo:`;

                if (campo === "short_description_profile") {
                    userPromptContent = `${baseInfo}\n${actionPrompt} Crea uno slogan accattivante (max 150 caratteri). Testo di partenza: "${currentText}"`;
                    maxTokensBudget = 100;
                } else if (campo === "description_profile") {
                    userPromptContent = `${baseInfo}\n${actionPrompt} Scrivi una descrizione calda ed elegante di ESATTAMENTE 2 brevi paragrafi (totale 500-700 caratteri). NON superare assolutamente gli 800 caratteri! Inizia direttamente con la prima parola del testo. Testo di partenza: "${currentText}"`;
                    maxTokensBudget = 400;
                } else if (campo === "tags_profile" || campo === "specializations_profile") {
                    userPromptContent = `${baseInfo}\n${actionPrompt} Genera 6-8 voci separate da virgola. Testo di partenza: "${currentText}"`;
                    maxTokensBudget = 150;
                } else {
                    userPromptContent = `${baseInfo}\n${actionPrompt} Genera il contenuto per "${campo}". Testo di partenza: "${currentText}"`;
                    maxTokensBudget = 250;
                }
            }
        } else if (currentSector === "veterinario") {
            const isProfile = campo.endsWith("_profile_vet");
            const entityName = isProfile ? (contesto.store_name || "clinica") : "servizio";
            const entityType = isProfile ? (contesto.myTypeStore || "attività veterinaria") : "servizio";
            const baseInfo = `Entità: "${entityName}". Tipologia: "${entityType}".`;
            const currentText = (contesto.currentFieldValue || "").trim();

            if (campo === "short_description_profile_vet") {
                userPromptContent = `${baseInfo}\nCrea uno slogan conciso (max 150 caratteri). Testo di partenza: "${currentText}"`;
                maxTokensBudget = 100;
            } else if (campo === "description_profile_vet") {
                userPromptContent = `${baseInfo}\nScrivi una descrizione di 2 brevi paragrafi (max 700 caratteri). Testo di partenza: "${currentText}"`;
                maxTokensBudget = 400;
            } else {
                userPromptContent = `${baseInfo}\nGenera 5-7 voci separate da virgola per "${campo}".`;
                maxTokensBudget = 150;
            }
        } else if (campo === "storia_azienda") {
            userPromptContent = `Riscrivi questa filosofia aziendale per un vivaio: "${(contesto.testo || '').trim()}".`;
            maxTokensBudget = 500;
        } else if (task === "estimate_shipping_attributes") {
            systemPrompt = `Rispondi ESCLUSIVAMENTE con un JSON valido con: "weight" (kg), "length" (cm), "width" (cm), "height" (cm). Esempio: {"weight": 3.5, "length": 25, "width": 25, "height": 60}`;
            userPromptContent = `Estima peso e dimensioni imballo per: Nome: "${contesto.productName || contesto.nome}", Prezzo: "${contesto.price || '0'} €"`;
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

        const candidateModels = ["openai/gpt-oss-20b", "qwen/qwen3.6-27b", "openai/gpt-oss-120b"];

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
                    if (testoGenerato) break;
                } else {
                    const errMsg = data.error?.message || `HTTP ${response.status}`;
                    lastError = new Error(errMsg);
                }
            } catch (callErr) {
                lastError = callErr;
            }
        }

        if (!testoGenerato) {
            return res.status(500).json({ errore: "Errore durante la generazione: " + (lastError?.message || "Servizio non disponibile") });
        }

        // === PULIZIA AVANZATA DEI PENSIERI DELL'AI (Anti-Thinking) ===
        testoGenerato = testoGenerato.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        testoGenerato = testoGenerato.replace(/<\/?think>/gi, "").trim();

        // Rimuove blocchi "Here's a thinking process:" o simili generati come testo normale
        const thinkingMatch = testoGenerato.match(/(?:here(?:'s| is) (?:a |my )?(?:thinking|thought) process[\s\S]*?\n\n)([\s\S]+)/i);
        if (thinkingMatch && thinkingMatch[1]) {
            testoGenerato = thinkingMatch[1].trim();
        }

        const analyzeMatch = testoGenerato.match(/(?:analyze user input[\s\S]*?\n\n)([\s\S]+)/i);
        if (analyzeMatch && analyzeMatch[1]) {
            testoGenerato = analyzeMatch[1].trim();
        }

        // Rimuove virgolette iniziali e finali superflue
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

        // 2. Risposta pulita finale
        return res.status(200).json({ risultato: testoGenerato });

    } catch (error) {
        console.error("[api/magia.js] Errore:", error);
        res.status(500).json({ errore: "Errore: " + error.message });
    }
};
