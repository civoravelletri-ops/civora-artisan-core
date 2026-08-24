module.exports = async function handler(req, res) {
    // Gestione CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Lingue di destinazione
    const I18N_LANGS = ["en", "es", "fr", "de", "pt", "ru", "ar", "ro", "zh", "sq", "hi", "tr"];
    let testo_italiano = "";

    // Funzione helper per creare un fallback con il testo originale
    const buildFallback = (text = "") => {
        const out = {};
        for (const lang of I18N_LANGS) {
            out[lang] = text;
        }
        return out;
    };

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        testo_italiano = (body.testo_italiano || body.text || "").trim();
        const contesto = body.contesto || "profilo studio";
        
        const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.GROQ_KEY || process.env.GROQ_AI_KEY || process.env.GROQ_TOKEN;

        // Se il testo è vuoto, restituisce chiavi vuote
        if (!testo_italiano) {
            return res.status(200).json(buildFallback(""));
        }

        // Se manca la chiave API
        if (!GROQ_API_KEY) {
            console.error("[magia-traduttore] Errore: Manca la variabile d'ambiente GROQ_API_KEY!");
            return res.status(200).json(buildFallback(testo_italiano));
        }

        const systemPrompt = `Sei un traduttore professionista per attività commerciali e saloni di bellezza.
Traduci il testo fornito in queste lingue esatte: ${JSON.stringify(I18N_LANGS)}.
Mantieni un tono commerciale, elegante ed essenziale.
Se il testo è una lista separata da virgole, mantieni il formato a lista.

Rispondi ESCLUSIVAMENTE con un oggetto JSON valido contenente tutte le 12 chiavi richieste:
{"en":"...","es":"...","fr":"...","de":"...","pt":"...","ru":"...","ar":"...","ro":"...","zh":"...","sq":"...","hi":"...","tr":"..."}`;

        const userPrompt = `Contesto: ${contesto}\nTesto da tradurre:\n"${testo_italiano}"`;

        // Modelli ordinati per efficienza/velocità
        const GROQ_TEXT_MODELS = [
            "openai/gpt-oss-20b",
            "groq/compound-mini",
            "qwen/qwen3.6-27b",
            "openai/gpt-oss-120b"
        ];

        let traduzioniJSON = null;
        let lastError = null;

        for (const modelCandidate of GROQ_TEXT_MODELS) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 9000); // 9 sec timeout per modello

            try {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${GROQ_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    signal: controller.signal,
                    body: JSON.stringify({
                        model: modelCandidate,
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: userPrompt }
                        ],
                        response_format: { type: "json_object" }, // Forza output JSON nativo
                        temperature: 0.1,
                        max_tokens: 2048
                    })
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    lastError = new Error(errData?.error?.message || `HTTP ${response.status}`);
                    continue;
                }

                const data = await response.json();
                let rawContent = data.choices?.[0]?.message?.content?.trim();

                if (rawContent) {
                    // Pulizia tag di ragionamento e markdown code blocks
                    rawContent = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
                    rawContent = rawContent.replace(/```json/gi, "").replace(/```/g, "").trim();

                    const firstBrace = rawContent.indexOf('{');
                    const lastBrace = rawContent.lastIndexOf('}');
                    if (firstBrace !== -1 && lastBrace > firstBrace) {
                        rawContent = rawContent.substring(firstBrace, lastBrace + 1);
                    }

                    const parsed = JSON.parse(rawContent);

                    // Verifica e normalizza le chiavi
                    const finalResult = {};
                    let missingKeys = 0;

                    for (const lang of I18N_LANGS) {
                        if (parsed[lang] && typeof parsed[lang] === 'string' && parsed[lang].trim() !== '') {
                            finalResult[lang] = parsed[lang].trim();
                        } else {
                            finalResult[lang] = testo_italiano; // Fallback per singola lingua mancante
                            missingKeys++;
                        }
                    }

                    // Se ha tradotto la maggior parte delle lingue, consideralo un successo
                    if (missingKeys < I18N_LANGS.length) {
                        traduzioniJSON = finalResult;
                        console.log(`[magia-traduttore] Successo con ${modelCandidate} (${missingKeys} fallback parziali)`);
                        break;
                    }
                }
            } catch (err) {
                clearTimeout(timeoutId);
                lastError = err;
                console.warn(`[magia-traduttore] Fallito con ${modelCandidate}:`, err.message || err);
            }
        }

        // Se tutti i modelli hanno fallito
        if (!traduzioniJSON) {
            console.warn("[magia-traduttore] Tutti i modelli hanno fallito. Ritorno fallback italiano.", lastError?.message);
            return res.status(200).json(buildFallback(testo_italiano));
        }

        return res.status(200).json(traduzioniJSON);

    } catch (error) {
        console.error("[api/magia-traduttore.js] Errore critico non gestito:", error);
        return res.status(200).json(buildFallback(testo_italiano));
    }
};
