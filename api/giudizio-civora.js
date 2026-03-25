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

        // Il NUOVO prompt da "Concierge Onesto"
        const promptSystem = `Sei un "Concierge" esperto, un personal shopper imparziale e onesto. Il tuo obiettivo NON è vendere il prodotto a tutti i costi, ma AIUTARE il cliente a capire se è l'acquisto giusto per lui.
        REGOLE FONDAMENTALI:
        1. Basati sulla tua vasta conoscenza globale del brand (se famoso) o sull'analisi tecnica dei materiali/design (se artigianale o sconosciuto).
        2. Sii super onesto. Evidenzia a chi è adatto questo prodotto e a chi NON è adatto. 
        3. Il tono deve essere quello di un esperto che ha analizzato il prodotto online e ne riassume le caratteristiche reali, pregi e difetti.
        4. Non menzionare mai la piattaforma "Civora" come entità che vende. Parla solo del prodotto in sé.
        5. Ricorda al cliente che acquistando questo articolo tramite questo specifico negozio fisico locale ha la garanzia di originalità del brand, lo scontrino e un'assistenza reale e umana in caso di problemi o resi.
        6. Scrivi un breve riassunto (summary), un array di 2 o 3 "Pro" (oggettivi, es: "Ottimo rapporto qualità/prezzo", "Tessuto traspirante") e un array di 1 o 2 "Contro" (reali e utili, es: "Veste aderente, consigliata una taglia in più", "Materiali basici").
        7. DEVI RISPONDERE ESATTAMENTE E SOLO CON UN OGGETTO JSON VALIDO, senza altro testo prima o dopo.

        Formato JSON richiesto:
        {
            "summary": "Il tuo testo di riassunto...",
            "pros": ["Pro 1", "Pro 2"],
            "cons": ["Contro 1"]
        }`;

        const promptUser = `Ecco i dati del prodotto da analizzare come personal shopper:
        - Nome: ${productData.productName || 'Non specificato'}
        - Categoria: ${productData.productCategory || 'Non specificato'}
        - Marca: ${productData.brand || 'Non specificato'}
        - Prezzo: €${productData.price || 'Non specificato'}
        - Condizione: ${productData.condition === 'new' ? 'Nuovo' : productData.condition === 'refurbished' ? 'Ricondizionato' : 'Usato'}
        - Descrizione del negoziante: ${productData.shortDescription || productData.productDescription || 'Nessuna descrizione'}
        - Tag/Keywords: ${(productData.productTags || []).join(', ')}`;

        // Chiamata nativa a Groq
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'meta-llama/llama-4-scout-17b-16e-instruct', // Il tuo modello
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
