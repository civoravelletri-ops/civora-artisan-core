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

    // Recuperiamo la chiave Groq dalla variabile d'ambiente di Vercel
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    // Prepariamo il messaggio per l'IA, ora generico per "alimentari"
    const systemPrompt = `Sei un esperto di gastronomia e marketing per negozi di alimentari locali. 
    Il tuo compito è aiutare un commerciante a compilare i dati di un prodotto o un "Kit Ricetta" basato su ingredienti freschi e locali.
    Sii creativo, persuasivo, utilizza un linguaggio appetitoso e coinvolgente.
    
    REGOLA FONDAMENTALE: Rispondi SOLO E UNICAMENTE con il testo richiesto per il campo specificato.
    NON includere etichette come "Descrizione breve:", "Tags:", "Nome Kit:", "Istruzioni:", ecc.
    NON usare virgolette all'inizio e alla fine del testo generato.
    Il testo deve essere direttamente il contenuto da inserire nel campo.`;

    let userPromptContent = '';

    // === Logica per KIT RICETTA ===
    if (contesto.type === 'kit') {
        const kitContext = `Il kit ricetta è per un piatto chiamato "${contesto.kitName}". 
        È nella categoria "${contesto.kitCategory}". 
        La difficoltà è "${contesto.difficulty}".
        Gli ingredienti attuali sono: ${contesto.ingredients.map(i => `${i.quantity} di ${i.name}`).join(', ') || 'Nessun ingrediente specificato.'}.`;

        if (campo === "kitName") {
            userPromptContent = kitContext + `\nSuggerisci un nome breve, accattivante e delizioso per questo "Kit Ricetta". Massimo 50 caratteri.`;
        } else if (campo === "description") {
            userPromptContent = kitContext + `\nGenera una descrizione breve ma succulenta (massimo 150 caratteri) che metta in risalto la freschezza e la bontà degli ingredienti locali, invogliando a cucinare questo piatto.`;
        } else if (campo === "recipeText") {
            userPromptContent = kitContext + `\nScrivi delle istruzioni di preparazione passo passo, chiare e semplici, per questo "Kit Ricetta". Dividi in paragrafi o punti numerati. Sottolinea la facilità e il risultato delizioso. Lunghezza massima circa 800-1000 caratteri.`;
        } else if (campo === "kitTags") {
            userPromptContent = kitContext + `\nGenera 5-7 tag pertinenti e appetitosi (es. "km0, biologico, fattoincasa, tradizionale, veloce"), separati da virgola, per questo "Kit Ricetta".`;
        } else if (campo === "ingredientName") {
            userPromptContent = `Il kit ricetta è per un piatto chiamato "${contesto.kitName}". 
            La categoria è "${contesto.kitCategory}". 
            Un ingrediente che il commerciante sta aggiungendo si chiama "${contesto.partialIngredientName}".
            Suggerisci un nome completo e descrittivo per questo ingrediente, evidenziando la qualità o l'origine locale (es. "Guanciale di Amatrice DOP", "Pomodoro San Marzano fresco"). Rispondi solo con il nome suggerito.`;
        }
    }
    // === Logica per PRODOTTI ALIMENTARI (come una normale "merce" venduta) ===
    else if (contesto.type === 'product') {
        const productContext = `Il prodotto alimentare si chiama "${contesto.productName}".
        La marca è "${contesto.productBrand}".
        Si trova nel reparto "${contesto.productCategory}" e sottocategoria "${contesto.productSubcategory}".
        La sua origine è "${contesto.productOrigin}".
        ${contesto.sellingMethodDetails || 'Nessun dettaglio sul metodo di vendita.'}`;

        if (campo === "productNameAlimentari") {
            userPromptContent = productContext + `\nSuggerisci un nome più descrittivo e appetitoso per il prodotto alimentare. Massimo 100 caratteri.`;
        } else if (campo === "productAttributes") {
            userPromptContent = productContext + `\nGenera 3-5 attributi pertinenti per questo prodotto alimentare (es. "Biologico, Senza Glutine, km0, Fresco, Artigianale"), separati da virgola.`;
        } else if (campo === "productIngredients") {
            userPromptContent = productContext + `\nGenera una lista di ingredienti dettagliata per questo prodotto alimentare. Formatta come una lista semplice o un paragrafo.`;
        } else if (campo === "productAllergens") {
            userPromptContent = productContext + `\nIdentifica i principali allergeni presenti in questo prodotto alimentare (es. Glutine, Lattosio, Frutta a guscio), separati da virgola. Se non ce ne sono, rispondi "Nessuno".`;
        } else if (campo === "productDescription") {
            userPromptContent = productContext + `\nGenera una descrizione completa e accattivante per questo prodotto alimentare, evidenziando qualità, origine e consigli d'uso. Circa 3-5 paragrafi.`;
        } else if (campo === "usageTips") {
            userPromptContent = productContext + `\nFornisci consigli pratici su come usare o conservare al meglio questo prodotto alimentare.`;
        }
    }
    // Fallback per campi non riconosciuti (dovrebbe essere raro)
    else {
        userPromptContent = `Genera un contenuto per il campo "${campo}" basandoti sulle informazioni fornite: ${JSON.stringify(contesto)}.`;
    }

    const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPromptContent }
    ];

    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant", // Utilizziamo il modello più recente
                messages: messages, // Ora usiamo la variabile 'messages' che abbiamo creato sopra
                temperature: 0.7,
                max_tokens: 1200 // Aumentiamo i token massimi per le descrizioni lunghe
            })
        });

        const data = await response.json();

        // Gestiamo gli errori da Groq in modo più robusto
        if (data.error) {
            console.error("Errore da Groq API:", data.error);
            return res.status(500).json({ errore: "Errore da Groq: " + data.error.message });
        }

        if (!data.choices || data.choices.length === 0) {
            console.error("Groq API non ha restituito choices:", data);
            return res.status(500).json({ errore: "L'IA non ha restituito risultati validi. Riprova." });
        }

        const testoGenerato = data.choices[0].message.content.trim();
        
        res.status(200).json({ risultato: testoGenerato });
    } catch (error) {
        console.error("Errore nella funzione Vercel magia-kit (o Alimentari):", error);
        res.status(500).json({ errore: "La magia per gli alimentari si è interrotta: " + error.message });
    }
}
