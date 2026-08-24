module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const I18N_LANGS = ["en", "es", "fr", "de", "pt", "ru", "ar", "ro", "zh", "sq", "hi", "tr"];
    let testo_italiano = "";

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        testo_italiano = (body.testo_italiano || body.text || "").trim();
        const contesto = body.contesto || "profilo studio";
        const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.GROQ_KEY || process.env.GROQ_AI_KEY || process.env.GROQ_TOKEN;

        if (!testo_italiano) {
            const emptyTranslations = {};
            I18N_LANGS.forEach(lang => emptyTranslations[lang] = "");
            return res.status(200).json(emptyTranslations);
        }

        if (!GROQ_API_KEY) {
            console.error("[magia-traduttore] Manca GROQ_API_KEY nelle variabili d'ambiente!");
            const fallback = {};
            I18N_LANGS.forEach(lang => fallback[lang] = testo_italiano);
            return res.status(200).json(fallback);
        }

        const systemPrompt = `Sei un traduttore professionista per attività commerciali e saloni di bellezza.
Traduci il testo fornito in queste lingue: "en", "es", "fr", "de", "pt", "ru", "ar", "ro", "zh", "sq", "hi", "tr".
Mantieni un tono commerciale, elegante ed essenziale. Se il testo è lungo, mantieni la traduzione concisa e chiara.
Se è una lista separata da virgole, mantieni le virgole.

Rispondi ESCLUSIVAMENTE con un JSON valido strutturato così:
{"en":"...","es":"...","fr":"...","de":"...","pt":"...","ru":"...","ar":"...","ro":"...","zh":"...","sq":"...","hi":"...","tr":"..."}`;

        const userPrompt = `Contesto: ${contesto}\nTesto da tradurre:\n"${testo_italiano}"`;

        // === AUTO-DISCOVERY DEI MODELLI GROQ ATTIVI (uguale a magia.js) ===
        let dynamicModelsList = [];
        try {
            const modelsRes = await fetch("https://api.groq.com/openai/v1/models", {
                headers: { "Authorization": `Bearer ${GROQ_API_KEY.trim()}` }
            });
            if (modelsRes.ok) {
                const modelsData = await modelsRes.json();
                if (modelsData.data && Array.isArray(modelsData.data)) {
                    const chatModels = modelsData.data
                        .map(m => m.id)
                        .filter(id => !id.includes("whisper") && !id.includes("guard") && !id.includes("embed") && !id.includes("vision"));

                    chatModels.sort((a, b) => {
                        const score = (m) => {
                            if (m.includes("llama-3.3")) return 100;
                            if (m.includes("llama-3.1-70b")) return 90;
                            if (m.includes("llama-3.1-8b")) return 80;
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
            console.warn("[magia-traduttore Discovery] Uso lista fallback:", e.message);
        }

        const candidateModels = dynamicModelsList.length > 0
            ? dynamicModelsList
            : ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "gemma2-9b-it"];

        let traduzioniJSON = null;
        let lastError = null;

        for (const modelCandidate of candidateModels) {
            try {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${GROQ_API_KEY.trim()}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: modelCandidate,
                        response_format: { type: "json_object" },
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: userPrompt }
                        ],
                        temperature: 0.1,
                        max_tokens: 2500
                    })
                });

                const data = await response.json();

                if (response.ok && data.choices && data.choices.length > 0 && data.choices[0].message?.content) {
                    let content = data.choices[0].message.content.trim();
                    content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
                    content = content.replace(/```json/gi, "").replace(/```/g, "").trim();

                    const firstBrace = content.indexOf('{');
                    const lastBrace = content.lastIndexOf('}');
                    if (firstBrace !== -1 && lastBrace > firstBrace) {
                        content = content.substring(firstBrace, lastBrace + 1);
                    }

                    try {
                        traduzioniJSON = JSON.parse(content);
                    } catch (e1) {
                        let repaired = content.trim();
                        if (!repaired.endsWith('}')) {
                            repaired += repaired.endsWith('"') ? '}' : '"}';
                        }
                        try {
                            traduzioniJSON = JSON.parse(repaired);
                        } catch (e2) {
                            traduzioniJSON = null;
                        }
                    }

                    if (traduzioniJSON && typeof traduzioniJSON === 'object') {
                        console.log(`[magia-traduttore] ✅ Successo per (${contesto}) con: ${modelCandidate}`);
                        break;
                    }
                } else {
                    const errMsg = data.error?.message || `HTTP ${response.status}`;
                    console.warn(`[magia-traduttore] Modello ${modelCandidate} fallito (${errMsg}), provo successivo...`);
                    lastError = new Error(errMsg);
                }
            } catch (callErr) {
                lastError = callErr;
            }
        }

        if (!traduzioniJSON) {
            console.warn("[magia-traduttore] Fallback su italiano. Ultimo errore:", lastError?.message);
            const fallback = {};
            I18N_LANGS.forEach(lang => fallback[lang] = testo_italiano);
            return res.status(200).json(fallback);
        }

        return res.status(200).json(traduzioniJSON);

    } catch (error) {
        console.error("[api/magia-traduttore.js] Errore critico:", error);
        const fallback = {};
        I18N_LANGS.forEach(lang => fallback[lang] = testo_italiano || "");
        return res.status(200).json(fallback);
    }
};
