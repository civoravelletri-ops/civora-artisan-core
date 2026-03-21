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

    const { campo, contesto } = req.body;

    // Recuperiamo la chiave che metteremo tra poco su Vercel
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    // Prepariamo il messaggio per l'IA
    const systemPrompt = `Sei un esperto di marketing per negozi locali. 
    Il tuo compito è aiutare un commerciante a compilare i dati di un prodotto. 
    Sii creativo, persuasivo ma usa un linguaggio semplice. Rispondi SOLO con il testo richiesto, senza commenti.`;

    const userPrompt = `Il prodotto si chiama "${contesto.nome}". 
    Si trova nella categoria "${contesto.categoria}". 
    La marca è "${contesto.marca}". 
    Il prezzo è "${contesto.prezzo}€".
    
    Genera per favore il contenuto per il campo "${campo}".
    - Se il campo è "descrizione_breve", scrivi uno slogan accattivante di max 150 caratteri.
    - Se il campo è "descrizione_completa", scrivi una descrizione emozionante di circa 3-4 frasi che invogli all'acquisto.
    - Se il campo è "tags", scrivi 5-6 parole chiave separate da virgola.
    - Se il campo è "keywords", scrivi termini di ricerca extra separati da virgola.`;

    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama3-8b-8192",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.7
            })
        });

        const data = await response.json();
        const testoGenerato = data.choices[0].message.content.trim();
        
        res.status(200).json({ risultato: testoGenerato });
    } catch (error) {
        res.status(500).json({ errore: "La magia si è interrotta: " + error.message });
    }
}
