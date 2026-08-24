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

        const systemPrompt = `You are a professional multilingual translator.
Translate the provided Italian text into these 12 languages: en, es, fr, de, pt, ru, ar, ro, zh, sq, hi, tr.
Keep a commercial, elegant and professional tone.

IMPORTANT INSTRUCTIONS:
- Translate EVERY language. DO NOT return empty strings.
- Output ONLY a flat JSON object without any wrapping or markdown.
Exact JSON format:
{"en":"...","es":"...","fr":"...","de":"...","pt":"...","ru":"...","ar":"...","ro":"...","zh":"...","sq":"...","hi":"...","tr":"..."}`;

        const userPrompt = `Context: ${contesto}\nItalian text to translate:\n"""${testo_italiano}"""`;

        // === AUTO-DISCOVERY MODELLI ===
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
                        .filter(id => {
                            const low = id.toLowerCase();
                            return !low.includes("whisper") &&
                                   !low.includes("guard") &&
                                   !low.includes("embed") &&
                                   !low.includes("vision") &&
                                   !low.includes("orpheus") &&
                                   !low.includes("canopylabs") &&
                                   !low.includes("compound") &&
                                   !low.includes("safeguard") &&
                                   !low.includes("allam");
                        });

                    chatModels.sort((a, b) => {
                        const score = (m) => {
                            const low = m.toLowerCase();
                            if (low.includes("llama-3.3-70b")) return 100;
                            if (low.includes("llama-3.1-8b")) return 90;
                            if (low.includes("gpt-oss-120b")) return 85;
                            if (low.includes("qwen3.6-27b")) return 80;
                            if (low.includes("gpt-oss-20b")) return 75;
                            if (low.includes("gemma2-9b")) return 70;
                            return 10;
                        };
                        return score(b) - score(a);
                    });
                    dynamicModelsList = chatModels;
                }
            }
        } catch (e) {
            console.warn("[magia-traduttore Discovery] Fallback:", e.message);
        }

        const candidateModels = dynamicModelsList.length > 0
            ? dynamicModelsList
            : [
                "llama-3.1-8b-instant",
                "llama-3.3-70b-versatile",
                "openai/gpt-oss-120b",
                "qwen/qwen3.6-27b",
                "openai/gpt-oss-20b"
              ];

        let finalTranslations = null;
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
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: userPrompt }
                        ],
                        temperature: 0.1,
                        max_tokens: 3500
                    })
                });

                const data = await response.json();

                if (response.ok && data.choices && data.choices.length > 0) {
                    const choice = data.choices[0];
                    let content = (choice.message?.content || choice.message?.reasoning_content || "").trim();

                    // Pulizia approfondita
                    content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
                    content = content.replace(/<\/?think>/gi, "").trim();
                    content = content.replace(/```json/gi, "").replace(/```/g, "").trim();

                    const firstBrace = content.indexOf('{');
                    const lastBrace = content.lastIndexOf('}');
                    if (firstBrace !== -1 && lastBrace > firstBrace) {
                        content = content.substring(firstBrace, lastBrace + 1);
                    }

                    let parsed = null;
                    try {
                        parsed = JSON.parse(content);
                    } catch (e1) {
                        let repaired = content.trim();
                        if (!repaired.endsWith('}')) {
                            repaired += repaired.endsWith('"') ? '}' : '"}';
                        }
                        try { parsed = JSON.parse(repaired); } catch (e2) {}
                    }

                    if (parsed && typeof parsed === 'object') {
                        // Scompatta se il modello ha annidato le lingue in "translations", "languages", ecc.
                        let flatObject = parsed;
                        for (const wrapperKey of ["translations", "data", "languages", "traduzioni", "result", "output"]) {
                            if (parsed[wrapperKey] && typeof parsed[wrapperKey] === 'object') {
                                flatObject = parsed[wrapperKey];
                                break;
                            }
                        }

                        // Verifichiamo e normalizziamo le lingue
                        const validKeysCount = I18N_LANGS.filter(lang => flatObject[lang] && typeof flatObject[lang] === 'string' && flatObject[lang].trim() !== '').length;

                        // Se ha tradotto con successo almeno la maggior parte delle lingue
                        if (validKeysCount >= 2) {
                            finalTranslations = {};
                            I18N_LANGS.forEach(lang => {
                                finalTranslations[lang] = (flatObject[lang] && flatObject[lang].trim()) ? flatObject[lang].trim() : testo_italiano;
                            });

                            console.log(`[magia-traduttore] ✅ Traduzione completata con successo usando: ${modelCandidate} (${validKeysCount}/12 lingue validate)`);
                            break;
                        } else {
                            console.warn(`[magia-traduttore] Risposta di ${modelCandidate} conteneva campi vuoti, provo successivo...`);
                        }
                    }
                } else {
                    const msg = data.error?.message || `HTTP ${response.status}`;
                    console.warn(`[magia-traduttore] Fallito con ${modelCandidate}: ${msg}`);
                    lastError = new Error(msg);
                }
            } catch (callErr) {
                console.warn(`[magia-traduttore] Errore con ${modelCandidate}:`, callErr.message);
                lastError = callErr;
            }
        }

        if (!finalTranslations) {
            console.warn("[magia-traduttore] Fallback finale su testo italiano.");
            const fallback = {};
            I18N_LANGS.forEach(lang => fallback[lang] = testo_italiano);
            return res.status(200).json(fallback);
        }

        return res.status(200).json(finalTranslations);

    } catch (error) {
        console.error("[magia-traduttore] Errore critico:", error);
        const fallback = {};
        I18N_LANGS.forEach(lang => fallback[lang] = testo_italiano || "");
        return res.status(200).json(fallback);
    }
};
