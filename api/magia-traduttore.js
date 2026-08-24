module.exports = async function handler(req, res) {
    // Intestazioni CORS
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
        const contesto = body.contesto || "servizio commerciale";
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

        const systemPrompt = `Sei un traduttore professionista per attività commerciali.
Il tuo compito è tradurre il testo fornito in 11 lingue ("en", "es", "fr", "de", "ru", "ar", "ro", "zh", "sq", "hi", "tr").
Mantieni un tono commerciale naturale. Se il testo è una lista di parole separate da virgole, mantieni le virgole.

Rispondi ESCLUSIVAMENTE con un oggetto JSON valido, strutturato esattamente così:
{
  "en": "...",
  "es": "...",
  "fr": "...",
  "de": "...",
  "ru": "...",
  "ar": "...",
  "ro": "...",
  "zh": "...",
  "sq": "...",
  "hi": "...",
  "tr": "..."
}`;

        const userPrompt = `Contesto del testo: ${contesto}
Testo in italiano da tradurre:
"${testo_italiano}"`;

        const GROQ_TEXT_MODELS = [
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "gemma2-9b-it",
            "mixtral-8x7b-32768"
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
                        temperature: 0.2,
                        max_tokens: 1500
                    })
                });

                const data = await response.json();

                if (response.ok && data.choices && data.choices.length > 0 && data.choices[0].message?.content) {
                    let content = data.choices[0].message.content.trim();
                    content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
                    content = content.replace(/```json/g, "").replace(/```/g, "").trim();

                    const start = content.indexOf('{');
                    const end = content.lastIndexOf('}');
                    if (start !== -1 && end !== -1) {
                        content = content.substring(start, end + 1);
                    }

                    traduzioniJSON = JSON.parse(content);
                    console.log(`[magia-traduttore] Successo con modello: ${modelCandidate}`);
                    break;
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
            console.warn("[magia-traduttore] Tutti i modelli falliti, uso fallback:", lastError?.message);
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
