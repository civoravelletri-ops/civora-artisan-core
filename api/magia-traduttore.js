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

        const systemPrompt = `Sei un traduttore professionista multilingue per attività commerciali e saloni di bellezza.
Traduci il testo italiano in TUTTE queste 12 lingue:
1. en (Inglese)
2. es (Spagnolo)
3. fr (Francese)
4. de (Tedesco)
5. pt (Portoghese)
6. ru (Russo)
7. ar (Arabo)
8. ro (Rumeno)
9. zh (Cinese)
10. sq (Albanese)
11. hi (Hindi)
12. tr (Turco)

REGOLE TASSATIVE:
- Devi tradurre il testo in ciascuna lingua. Non lasciare il testo in italiano per le lingue straniere!
- Mantieni un tono commerciale, elegante ed essenziale.
- Rispondi ESCLUSIVAMENTE con un oggetto JSON valido racchiuso tra parentesi graffe, senza spiegazioni, senza commenti e senza tag markdown.
Struttura richiesta:
{"en":"...","es":"...","fr":"...","de":"...","pt":"...","ru":"...","ar":"...","ro":"...","zh":"...","sq":"...","hi":"...","tr":"..."}`;

        const userPrompt = `Contesto: ${contesto}\nTraduci questo testo in tutte le 12 lingue:\n"""\n${testo_italiano}\n"""`;

        // === AUTO-DISCOVERY CON FILTRI PULITI ===
        let dynamicModelsList = [];
        try {
            const modelsRes = await fetch("https://api.groq.com/openai/v1/models", {
                headers: { "Authorization": `Bearer ${GROQ_API_KEY.trim()}` }
            });
            if (modelsRes.ok) {
                const modelsData = await modelsRes.json();
                if (modelsData.data && Array.isArray(modelsData.data)) {
                    // Escludiamo modelli vocali, compound, guard, embedding e vision
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

                    // Ordiniamo con priorità ai modelli più affidabili per traduzioni
                    chatModels.sort((a, b) => {
                        const score = (m) => {
                            const low = m.toLowerCase();
                            if (low.includes("llama-3.3-70b")) return 100;
                            if (low.includes("llama-3.1-8b")) return 90;
                            if (low.includes("gpt-oss-120b")) return 85;
                            if (low.includes("gpt-oss-20b")) return 80;
                            if (low.includes("qwen3.6-27b")) return 75;
                            if (low.includes("gemma2-9b")) return 70;
                            return 10;
                        };
                        return score(b) - score(a);
                    });
                    dynamicModelsList = chatModels;
                }
            }
        } catch (e) {
            console.warn("[magia-traduttore Discovery] Uso fallback:", e.message);
        }

        const candidateModels = dynamicModelsList.length > 0
            ? dynamicModelsList
            : [
                "llama-3.1-8b-instant",
                "llama-3.3-70b-versatile",
                "openai/gpt-oss-120b",
                "openai/gpt-oss-20b",
                "qwen/qwen3.6-27b"
              ];

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
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: userPrompt }
                        ],
                        temperature: 0.2,
                        max_tokens: 4096
                    })
                });

                const data = await response.json();

                if (response.ok && data.choices && data.choices[0]?.message?.content) {
                    let content = data.choices[0].message.content.trim();

                    // Pulizia tag <think>, markdown e delimitatori
                    content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
                    content = content.replace(/<\/?think>/gi, "").trim();
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

                    // Verifica che contenga almeno inglese ed un'altra lingua
                    if (traduzioniJSON && typeof traduzioniJSON === 'object' && (traduzioniJSON.en || traduzioniJSON.es)) {
                        console.log(`[magia-traduttore] ✅ Traduzione completata con successo usando: ${modelCandidate}`);
                        break;
                    }
                } else {
                    const msg = data.error?.message || `HTTP ${response.status}`;
                    console.warn(`[magia-traduttore] Modello ${modelCandidate} non riuscito (${msg}), provo il successivo...`);
                    lastError = new Error(msg);
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
        console.error("[magia-traduttore] Errore critico:", error);
        const fallback = {};
        I18N_LANGS.forEach(lang => fallback[lang] = testo_italiano || "");
        return res.status(200).json(fallback);
    }
};
