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
            console.error("[magia-traduttore] Manca GROQ_API_KEY!");
            const fallback = {};
            I18N_LANGS.forEach(lang => fallback[lang] = testo_italiano);
            return res.status(200).json(fallback);
        }

        const systemPrompt = `You are a professional human translator.
Translate the entire provided Italian text into these 12 languages: en, es, fr, de, pt, ru, ar, ro, zh, sq, hi, tr.

STRICT RULES:
1. Provide the FULL, complete translation for each language.
2. DO NOT use ellipsis, dots ("..."), or placeholders. Write the actual translated sentences.
3. Respond ONLY with a valid JSON object where keys are the 2-letter language codes and values are the complete translated text strings.`;

        const userPrompt = `Context: ${contesto}\nItalian text to translate fully into all 12 languages:\n"""\n${testo_italiano}\n"""`;

        // Modelli attivi e veloci
        const candidateModels = [
            "openai/gpt-oss-20b",
            "qwen/qwen3.6-27b",
            "openai/gpt-oss-120b"
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
                        temperature: 0.2,
                        max_tokens: 2200
                    })
                });

                const data = await response.json();

                if (response.ok && data.choices && data.choices.length > 0) {
                    const choice = data.choices[0];
                    let content = (choice.message?.content || choice.message?.reasoning_content || "").trim();

                    // Pulizia tag e markdown
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
                        let flatObject = parsed;
                        for (const k of ["translations", "data", "languages", "traduzioni", "result"]) {
                            if (parsed[k] && typeof parsed[k] === 'object') {
                                flatObject = parsed[k];
                                break;
                            }
                        }

                        // VALIDATORE: Scarta se il testo è "..." o inferiore a 3 caratteri (quando il testo originale è lungo)
                        const isValidTranslation = (val) => {
                            if (!val || typeof val !== 'string') return false;
                            const t = val.trim();
                            if (t === '...' || t === '..' || t === '.' || t === '') return false;
                            if (testo_italiano.length > 20 && t.length < 5) return false;
                            return true;
                        };

                        const validCount = I18N_LANGS.filter(lang => isValidTranslation(flatObject[lang])).length;

                        if (validCount >= 6) { // Se almeno 6 lingue sono traduzioni valide e reali
                            finalTranslations = {};
                            I18N_LANGS.forEach(lang => {
                                finalTranslations[lang] = isValidTranslation(flatObject[lang])
                                    ? flatObject[lang].trim()
                                    : testo_italiano;
                            });

                            console.log(`[magia-traduttore] ✅ Successo con ${modelCandidate} (${validCount}/12 lingue tradotte per esteso)`);
                            break;
                        } else {
                            console.warn(`[magia-traduttore] Il modello ${modelCandidate} ha restituito puntini o testo non valido, provo successivo...`);
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
            console.warn("[magia-traduttore] Fallback su testo italiano:", lastError?.message);
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
