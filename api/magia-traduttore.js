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

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const testo_italiano = (body.testo_italiano || body.text || "").trim();
        const contesto = body.contesto || "servizio salone";
        const GROQ_API_KEY = process.env.GROQ_API_KEY;

        if (!testo_italiano) {
            const emptyTranslations = {};
            I18N_LANGS.forEach(lang => emptyTranslations[lang] = "");
            return res.status(200).json(emptyTranslations);
        }

        if (!GROQ_API_KEY) {
            console.error("Manca GROQ_API_KEY su Vercel!");
            const fallback = {};
            I18N_LANGS.forEach(lang => fallback[lang] = testo_italiano);
            return res.status(200).json(fallback);
        }

        const systemPrompt = `Sei un traduttore professionista ed esperto di marketing per attività commerciali locali e saloni di bellezza.
Il tuo compito è prendere il testo in italiano e tradurlo in 11 lingue.
Mantieni un tono commerciale, elegante e naturale. Se il testo è una lista di parole separate da virgola (tags), mantieni la separazione con le virgole.

REGOLA JSON:
- Rispondi ESCLUSIVAMENTE con un oggetto JSON valido.
- Nessun testo fuori dal JSON.

Chiavi richieste: "en", "es", "fr", "de", "ru", "ar", "ro", "zh", "sq", "hi", "tr".`;

        const userPrompt = `Contesto: ${contesto}
Testo in italiano da tradurre:
${testo_italiano}`;

        // MODELLI UFFICIALI AD ALTA VELOCITÀ CERTIFICATI PER JSON MODE (Senza perdite di tempo)
                const GROQ_TEXT_MODELS = [
                    "llama-3.3-70b-versatile",
                    "gemma2-9b-it",
                    "mixtral-8x7b-32768"
                ];

        let traduzioniJSON = null;
        let lastError = null;

        // 2. CICLO DI TENTATIVO SUI MODELLI ATTIVI
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
                        response_format: { type: "json_object" }
                    })
                });

                const data = await response.json();

                if (response.ok && data.choices && data.choices.length > 0 && data.choices[0].message?.content) {
                    const rawContent = data.choices[0].message.content.trim();
                    const cleanJSON = rawContent.replace(/```json/g, "").replace(/```/g, "").trim();
                    traduzioniJSON = JSON.parse(cleanJSON);
                    console.log(`[Magia Traduttore] Successo con modello: ${modelCandidate}`);
                    break;
                } else {
                    const errMsg = data.error?.message || `HTTP ${response.status}`;
                    console.warn(`[Magia Traduttore] Modello ${modelCandidate} fallito (${errMsg}), provo successivo...`);
                    lastError = new Error(errMsg);
                }
            } catch (callErr) {
                lastError = callErr;
            }
        }

        if (!traduzioniJSON) {
            throw new Error("Nessun modello Groq ha risposto: " + (lastError?.message || "Errore sconosciuto"));
        }

        // Restituisci il dizionario tradotto
        return res.status(200).json(traduzioniJSON);

    } catch (error) {
        console.error("[api/magia-traduttore.js] Errore critico:", error.message);
        const fallback = {};
        I18N_LANGS.forEach(lang => fallback[lang] = testo_italiano || "");
        return res.status(200).json(fallback);
    }
};
