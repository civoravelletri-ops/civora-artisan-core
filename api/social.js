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

    const { contesto } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    // Il System Prompt trasforma l'AI in un Social Media Manager professionista
    const systemPrompt = `Sei un Social Media Manager esperto specializzato nel promuovere piccole attività locali su Instagram, Facebook e TikTok.
    Il tuo obiettivo è creare post "irresistibili" che spingano i clienti a visitare il negozio o a prenotare il servizio su Civora.
    
    REGOLE DI SCRITTURA:
    1. Usa un tono energico, amichevole e professionale.
    2. Usa molte emoji pertinenti per rendere il post visivamente accattivante.
    3. Usa elenchi puntati per i vantaggi del prodotto/servizio.
    4. Includi sempre una "Call to Action" (Invito all'azione) chiara verso Il nostro Shop.
    5. Aggiungi 5-8 hashtag strategici alla fine (incluso #Civora e hashtag locali).
    
    REGOLA FONDAMENTALE: Rispondi SOLO con il testo del post pronto per essere copiato e incollato.
    NON aggiungere introduzioni come "Ecco il tuo post" o virgolette.`;

    // Costruiamo il contesto basandoci su cosa ci arriva (Prodotto o Servizio)
    const infoBase = `
        Attività: "${contesto.store_name}"
        Prodotto: "${contesto.nome}"
        Prezzo: "${contesto.prezzo}€"
        Descrizione: "${contesto.descrizione || 'Qualità garantita'}"
        LINK DA INSERIRE NEL POST: "${contesto.link_store}"
        `;

    const userPromptContent = `Crea un post social coinvolgente basandoti su queste info: ${infoBase}. 
        IMPORTANTE: Alla fine del post, scrivi una frase tipo "Scopri il nostro shop qui:" seguita esattamente dal LINK DA INSERIRE NEL POST che ti ho fornito. Non inventare altri link.`;

    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant", // Veloce e creativo
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPromptContent }
                ],
                temperature: 0.8, // Più alto per essere più creativo con i post social
                max_tokens: 1000
            })
        });

        const data = await response.json();

        if (data.error) {
            return res.status(500).json({ errore: "Errore da Groq: " + data.error.message });
        }

        const postGenerato = data.choices[0].message.content.trim();
        res.status(200).json({ post: postGenerato });

    } catch (error) {
        res.status(500).json({ errore: "La magia social si è interrotta: " + error.message });
    }
}
