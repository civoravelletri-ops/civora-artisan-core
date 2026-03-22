// File: api/traduttore-ai.js

export default async function handler(req, res) {
    // Intestazioni CORS (copiate dai tuoi file, perfette)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { testiItaliani } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    // Istruiamo l'IA a fare la traduttrice multilingua e a rispondere in JSON
    const systemPrompt = `Sei un traduttore automatico professionale per una piattaforma e-commerce locale.
    Riceverai un oggetto JSON con dei testi in italiano (titoli, descrizioni, tags).
    Il tuo compito è tradurre OGNI campo in 9 lingue: "en" (Inglese), "es" (Spagnolo), "fr" (Francese), "de" (Tedesco), "ru" (Russo), "ar" (Arabo standard), "ma" (Arabo Marocchino/Darija), "ro" (Rumeno), "zh" (Cinese).
    Mantieni il tono di voce persuasivo e commerciale. Se il campo è un array di tag, mantieni l'array.
    
    REGOLA FONDAMENTALE: Devi rispondere SOLO ed ESCLUSIVAMENTE con un oggetto JSON valido. Niente testo fuori dal JSON.
    
    Formato di risposta richiesto:
    {
      "en": { "nomeCampo1": "traduzione...", "nomeCampo2": ["tag1", "tag2"] },
      "es": { "nomeCampo1": "traduzione...", "nomeCampo2": ["tag1", "tag2"] }
    }`;

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
                    { role: "user", content: JSON.stringify(testiItaliani) } // Mandiamo tutti i testi in un colpo solo
                ],
                temperature: 0.3, // Bassa temperatura = traduzioni più precise e meno "invenzioni"
                response_format: { type: "json_object" } // FORZIAMO IL FORMATO JSON
            })
        });

        const data = await response.json();

        if (data.error) {
            return res.status(500).json({ errore: "Errore da Groq: " + data.error.message });
        }

        const traduzioniJson = JSON.parse(data.choices[0].message.content.trim());
        res.status(200).json(traduzioniJson);

    } catch (error) {
        console.error("Errore traduttore AI:", error);
        res.status(500).json({ errore: "Il traduttore si è inceppato: " + error.message });
    }
}
