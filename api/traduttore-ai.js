export default async function handler(req, res) {
    // Permetti al tuo sito di chiamare questa funzione (CORS)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { testoOriginale, tipoCampo } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    // Prompt strutturato per forzare Groq a restituire un JSON perfetto con le 9 lingue
    const systemPrompt = `Sei un traduttore esperto e un copywriter per attività commerciali locali.
    Il tuo compito è tradurre il testo fornito dall'italiano in 9 lingue: "en" (Inglese), "es" (Spagnolo), "fr" (Francese), "de" (Tedesco), "ru" (Russo), "ar" (Arabo standard), "ma" (Arabo maghrebino/Darija), "ro" (Rumeno), "zh" (Cinese).
    Devi mantenere un tono di voce persuasivo, commerciale e accattivante.
    Se il testo in ingresso è una lista di parole chiave (tipoCampo: array), mantieni il formato a lista separata da virgole in ogni lingua.

    REGOLA FONDAMENTALE: Devi rispondere SOLO ed ESCLUSIVAMENTE con un oggetto JSON valido. 
    Usa esattamente queste chiavi: "en", "es", "fr", "de", "ru", "ar", "ma", "ro", "zh".
    Non aggiungere mai nessun commento o testo fuori dal JSON.`;

    const userPromptContent = `Traduci il seguente testo (tipo: ${tipoCampo}):\n"${testoOriginale}"`;

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
                temperature: 0.3, // Teniamo la creatività bassa per avere traduzioni fedeli
                response_format: { type: "json_object" } // FORZIAMO L'USCITA IN JSON!
            })
        });

        const data = await response.json();

        if (data.error) {
            return res.status(500).json({ errore: data.error.message });
        }

        // Estraiamo il JSON generato da Groq
        const testoGenerato = data.choices[0].message.content.trim();
        const traduzioniJson = JSON.parse(testoGenerato);

        res.status(200).json(traduzioniJson);
    } catch (error) {
        console.error("Errore nella Magia Traduttore:", error);
        res.status(500).json({ errore: "Il traduttore IA si è interrotto: " + error.message });
    }
}
