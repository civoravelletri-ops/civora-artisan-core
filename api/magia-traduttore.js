module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const I18N_LANGS = ["en", "es", "fr", "de", "ru", "ar", "ro", "zh", "sq", "hi", "tr"];
    let testo_italiano = "";

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        testo_italiano = (body.testo_italiano || body.text || "").trim();
        const contesto = body.contesto || "servizio salone";
        const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.GROQ_KEY || process.env.GROQ_AI_KEY || process.env.GROQ_TOKEN;

        if (!testo_italiano) {
            const emptyTranslations = {};
            I18N_LANGS.forEach(lang => emptyTranslations[lang] = "");
            return res.status(200).json(emptyTranslations);
        }

        if (!GROQ_API_KEY) {
            console.error("[magia-traduttore] Manca GROQ_API_KEY su Vercel!");
            const fallback = {};
            I18N_LANGS.forEach(lang => fallback[lang] = testo_italiano);
            return res.status(200).json(fallback);
        }

        const systemPrompt = `Sei un traduttore professionista per attività commerciali. Traduci il testo in 11 lingue ("en", "es", "fr", "de", "ru", "ar", "ro", "zh", "sq", "hi", "tr").
Rispondi ESCLUSIVAMENTE con un JSON puro valido senza tag o commenti:
{"en":"...","es":"...","fr":"...","de":"...","ru":"...","ar":"...","ro":"...","zh":"...","sq":"...","hi":"...","tr":"..."}`;

        const userPrompt = `Contesto: ${contesto}\nTraduci questo testo in italiano:\n"${testo_italiano}"`;

        const GROQ_TEXT_MODELS = [
            "openai/gpt-oss-20b",
            "groq/compound-mini",
            "qwen/qwen3.6-27b",
            "openai/gpt-oss-120b"
        ];

        let traduzioniJSON = null;
        let lastError = null;

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
                            { role: "user", content: userPrompt }
                        ],
                        temperature: 0.1,
                        max_tokens: 800
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
                        console.log(`[magia-traduttore] Successo con: ${modelCandidate}`);
                        break;
                    } catch (parseE) {
                        console.warn(`[magia-traduttore] Parse fallito su ${modelCandidate}:`, content);
                    }
                } else {
                    const errMsg = data.error?.message || `HTTP ${response.status}`;
                    console.warn(`[magia-traduttore] Modello ${modelCandidate} non riuscito: ${errMsg}`);
                    lastError = new Error(errMsg);
                }
            } catch (callErr) {
                lastError = callErr;
            }
        }

        if (!traduzioniJSON) {
            console.warn("[magia-traduttore] Fallback su italiano:", lastError?.message);
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
