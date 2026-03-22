export default async function handler(req, res) {
    // Intestazioni CORS (permettono al tuo sito di comunicare con Vercel)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // Gestione della pre-richiesta OPTIONS
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { testo_italiano, contesto } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    if (!testo_italiano || testo_italiano.trim() === "") {
        return res.status(200).json({
            en: "", es: "", fr: "", de: "", ru: "", ar: "", ma: "", ro: "", zh: ""
        });
    }

    // Diciamo all'IA chi è e cosa deve fare. Le imponiamo di rispondere SOLO in formato JSON.
    const systemPrompt = `Sei un traduttore professionista ed esperto di marketing per attività commerciali locali.
    Il tuo compito è prendere il testo in italiano e tradurlo in 9 lingue.
    Mantieni un tono commerciale, persuasivo e naturale. 
    Se il testo è una lista di parole separate da virgola (tags), mantieni la separazione con le virgole.

    REGOLA FONDAMENTALE: DEVI RISPONDERE SOLO ED ESCLUSIVAMENTE CON UN OGGETTO JSON VALIDO.
    Non aggiungere MAI commenti, saluti o testo fuori dal JSON.
    L'oggetto JSON deve avere ESATTAMENTE queste 10 chiavi:
    "en" (Inglese)
    "es" (Spagnolo)
    "fr" (Francese)
    "de" (Tedesco)
    "ru" (Russo)
    "ar" (Arabo standard)
    "ro" (Rumeno)
    "hi" (Rumeno)
    "sq" (Rumeno)
    "zh" (Cinese semplificato)`;

    const userPromptContent = `Contesto del testo: ${contesto}\n\nTesto in italiano da tradurre:\n"${testo_italiano}"`;

    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPromptContent }
                ],
                temperature: 0.3, // Temperatura bassa per traduzioni precise e non fantasiose
                response_format: { type: "json_object" } // FORZA Groq a sputare fuori un JSON perfetto
            })
        });

        const data = await response.json();

        if (data.error) {
            console.error("Errore da Groq API:", data.error);
            throw new Error(data.error.message);
        }

        if (!data.choices || data.choices.length === 0) {
            throw new Error("L'IA non ha restituito risultati validi.");
        }

        // Il testo restituito è già un JSON perfetto in formato stringa
        const jsonString = data.choices[0].message.content.trim();
        const traduzioni = JSON.parse(jsonString);

        // Inviamo il pacchetto di 10 lingue al sito
        res.status(200).json(traduzioni);

    } catch (error) {
        console.error("Errore magia-traduttore:", error);
        // In caso di errore critico, restituiamo il testo originale in italiano su tutte le lingue per non bloccare il salvataggio
        res.status(200).json({
            en: testo_italiano, es: testo_italiano, fr: testo_italiano, 
            de: testo_italiano, ru: testo_italiano, ar: testo_italiano, 
            ma: testo_italiano, ro: testo_italiano, zh: testo_italiano
        });
    }
}
