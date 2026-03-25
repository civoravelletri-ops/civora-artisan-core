export default async function handler(req, res) {
    // Abilita i CORS per permettere alla tua dashboard di comunicare con Vercel
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const productData = req.body;

        // Assicurati di avere la variabile d'ambiente GROQ_API_KEY impostata su Vercel
        const GROQ_API_KEY = process.env.GROQ_API_KEY;

        if (!GROQ_API_KEY) {
            throw new Error("GROQ_API_KEY mancante nelle variabili d'ambiente di Vercel");
        }

        // Costruiamo il prompt passando i dati del prodotto all'IA
        const promptSystem = `Sei l'AI imparziale e garante di "Civora". Il tuo compito è analizzare i dati di un prodotto caricato da un negoziante e scrivere una recensione/giudizio neutrale, professionale e rassicurante. 
        REGOLE FONDAMENTALI:
        1. Devi agire come un esperto terzo.
        2. Sottolinea sempre che l'acquisto su Civora equivale all'acquisto in negozio fisico (originalità garantita, scontrino, resi sicuri).
        3. Scrivi un breve riassunto (summary), un array di 2 o 3 "Pro" (oggettivi, basati su materiali, marca, utilità) e un array di 1 o 2 "Contro" (cose neutre, es. "Non adatto a chi cerca qualcosa di economico" se costa tanto, o "Design basilare" se è un prodotto semplice).
        4. DEVI RISPONDERE ESATTAMENTE E SOLO CON UN OGGETTO JSON VALIDO, senza altro testo prima o dopo.

        Formato JSON richiesto:
        {
            "summary": "Il tuo testo di riassunto...",
            "pros": ["Pro 1", "Pro 2"],
            "cons": ["Contro 1"]
        }`;

        const promptUser = `Ecco i dati del prodotto da analizzare:
        - Nome: ${productData.productName || 'Non specificato'}
        - Categoria: ${productData.productCategory || 'Non specificato'}
        - Marca: ${productData.brand || 'Non specificato'}
        - Prezzo: €${productData.price || 'Non specificato'}
        - Condizione: ${productData.condition === 'new' ? 'Nuovo' : productData.condition === 'refurbished' ? 'Ricondizionato' : 'Usato'}
        - Descrizione: ${productData.shortDescription || productData.productDescription || 'Nessuna descrizione'}
        - Tag/Keywords: ${(productData.productTags || []).join(', ')}`;

        // Chiamata nativa a Groq (molto veloce)
                const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${GROQ_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'meta-llama/llama-4-scout-17b-16e-instruct', // IL MODELLO LLAMA 4 SCELTO DA TE
                        response_format: { type: "json_object" }, // Forza Groq a restituire SOLO JSON
                        messages: [
                            { role: 'system', content: promptSystem },
                            { role: 'user', content: promptUser }
                        ],
                        temperature: 0.7,
                    })
                });

        if (!groqResponse.ok) {
            const err = await groqResponse.text();
            throw new Error(`Errore da Groq: ${err}`);
        }

        const data = await groqResponse.json();
        
        // Estraiamo il JSON generato dall'IA
        const aiJudgmentString = data.choices[0].message.content;
        const aiJudgmentJSON = JSON.parse(aiJudgmentString);

        // Rispondiamo al frontend
        res.status(200).json(aiJudgmentJSON);

    } catch (error) {
        console.error("Errore nella generazione del giudizio Civora:", error);
        res.status(500).json({ error: error.message });
    }
}
