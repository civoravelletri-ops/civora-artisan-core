// api/concierge.js
export default async function handler(req, res) {
    const { query, mode, userContext } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    // Prompt per l'Onboarding (diventare amici)
    const systemPrompt = `
    Sei "Civora", un'amica fidata e accogliente per persone non vedenti.
    Il tuo compito è farli sentire a casa.
    
    SE L'UTENTE SI PRESENTA:
    Estrai il nome dell'utente. Se dice "Mi chiamo Andrea", rispondi in modo entusiasta: "Che bel nome Andrea! Sono felice di conoscerti".
    Invitalo con dolcezza a "ufficializzare" l'amicizia per permetterti di ricordare i suoi gusti in futuro.
    
    REGOLE:
    - Non essere robotica. Sii empatica.
    - Se l'utente dà il nome, rispondi con un JSON che include { "risposta": "...", "action": "show_auth", "nome_estratto": "Andrea" }.
    - Altrimenti rispondi solo con il testo.
    `;

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
                    { role: "user", content: query }
                ],
                // Chiediamo a Groq di rispondere in modo che possiamo capire se deve mostrare il login
                response_format: { "type": "json_object" } 
            })
        });

        const data = await response.json();
        const content = JSON.parse(data.choices[0].message.content);

        res.status(200).json(content);

    } catch (error) {
        res.status(500).json({ risposta: "C'è stato un piccolo intoppo, ma io sono qui con te. Riprova." });
    }
}
