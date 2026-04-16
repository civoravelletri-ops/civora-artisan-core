// api/shopping-assistant.js

export default async function handler(req, res) {
    // Gestione CORS: Necessaria per le chiamate dal browser
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*'); // Risponde con l'origine della richiesta, o '*'
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
    res.setHeader('Vary', 'Origin');

    // Gestione preflight (richiesta OPTIONS)
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Assicurati che sia una richiesta POST
    if (req.method !== 'POST') {
        return res.status(405).json({ errore: "Metodo non consentito. Richiesta POST attesa." });
    }

    const { contesto } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY; // La tua chiave API Groq

    if (!GROQ_API_KEY) {
        console.error("GROQ_API_KEY non configurata nelle variabili d'ambiente di Vercel.");
        return res.status(500).json({ errore: "Chiave API Groq non configurata sul server." });
    }

    // Parametri specifici per la Spesa Intelligente
    const richiestaUtente = contesto.richiestaUtente;
    const listaProdotti = contesto.prodotti;
    const storeName = contesto.store_name;

    if (!richiestaUtente || !listaProdotti || !storeName) {
        return res.status(400).json({ errore: "Richiesta incompleta. Mancano richiestaUtente, prodotti o store_name." });
    }

    // Prompt per l'AI
    const systemPrompt = `Sei il Personal Shopper esperto del banco "${storeName}" di Civora.
    Il tuo compito è creare 3 proposte di carrello uniche e ottimizzate basate sulla richiesta del cliente.

    REGOLE FONDAMENTALI:
    1. Utilizza SOLO i prodotti inclusi nella LISTA PRODOTTI DISPONIBILI. NON INVENTARE PRODOTTI.
    2. Per ogni prodotto suggerito, indica l'ID del prodotto (campo 'id') esattamente come fornito nella lista. Questo è CRUCIALE.
    3. Crea 3 carrelli diversi per stile e scopo (es: "Carrello Risparmio", "Carrello Gourmet", "Carrello Veloce", "Carrello Settimanale per Famiglia"). Inventa nomi creativi e pertinenti in base alla richiesta.
    4. Per ogni prodotto all'interno di un carrello, specifica una quantità (\`qty\`) numerica (es. 1, 2, 500) adeguata alla richiesta dell'utente. Se il prodotto è venduto a peso, la quantità sarà in grammi (es. 500).
    5. La 'descrizione' di ogni carrello deve essere breve, informativa e accattivante, spiegando il focus del carrello.
    6. RISPONDI ESCLUSIVAMENTE con un oggetto JSON valido. NESSUN TESTO AGGIUNTIVO, INTRODUZIONI O CONCLUSIONI FUORI DAL JSON.
    7. Includi il 'prezzo' di ogni prodotto all'interno dell'oggetto del prodotto nel carrello.

    FORMATO JSON RICHIESTO (ARRAY DI OGGETTI CARRELLO):
    {
      "carrelli": [
        {
          "nome": "Nome Carrello 1 (es. Per la tua Grigliata!)",
          "descrizione": "Una breve frase che descrive il carrello (es. La selezione perfetta per 2 persone amanti della carne per 3 giorni).",
          "prodotti": [
            { "id": "ID_PRODOTTO_DA_LISTA_1", "nome": "Nome Prodotto 1 (come da lista)", "qty": 1, "prezzo": 10.50 },
            { "id": "ID_PRODOTTO_DA_LISTA_2", "nome": "Nome Prodotto 2 (come da lista)", "qty": 2, "prezzo": 5.00 }
          ]
        },
        {
          "nome": "Nome Carrello 2 (es. Settimana Leggera e Gustosa)",
          "descrizione": "Un'altra breve frase descrittiva.",
          "prodotti": [
            { "id": "ID_PRODOTTO_DA_LISTA_3", "nome": "Nome Prodotto 3", "qty": 1, "prezzo": 8.20 },
            { "id": "ID_PRODOTTO_DA_LISTA_4", "nome": "Nome Prodotto 4", "qty": 3, "prezzo": 3.75 }
          ]
        },
        {
          "nome": "Nome Carrello 3 (es. Cena Veloce e Semplice)",
          "descrizione": "Un'ultima breve frase descrittiva.",
          "prodotti": [
            { "id": "ID_PRODOTTO_DA_LISTA_1", "nome": "Nome Prodotto 1", "qty": 1, "prezzo": 10.50 },
            { "id": "ID_PRODOTTO_5", "nome": "Nome Prodotto 5", "qty": 1, "prezzo": 12.00 }
          ]
        }
      ]
    }`;

    const userPromptText = `RICHIESTA UTENTE: "${richiestaUtente}"
    LISTA PRODOTTI DISPONIBILI (ID, NOME, PREZZO, UNITA, CATEGORIA, SPECIFICHE):
    ${JSON.stringify(listaProdotti)}`;

    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "meta-llama/llama-4-scout-17b-16e-instruct",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: [{ type: "text", text: userPromptText }] } // Groq non analizza immagini in modalità JSON
                ],
                temperature: 0.7,
                max_tokens: 2000,
                response_format: { type: "json_object" }
            })
        });
        const data = await response.json();

        if (data.error) {
            console.error("Errore da Groq:", data.error);
            return res.status(500).json({ errore: "Errore da Groq: " + (data.error.message || "Errore sconosciuto") });
        }

        const generatedContent = data.choices[0].message.content.trim();

        try {
            const parsedContent = JSON.parse(generatedContent);
            res.status(200).json(parsedContent);
        } catch (parseError) {
            console.error("Errore nel parsing JSON da Groq:", parseError, "Contenuto ricevuto:", generatedContent);
            res.status(500).json({ errore: "L'AI ha risposto in modo inatteso o malformato, riprova. Dettaglio: " + parseError.message });
        }

    } catch (error) {
        console.error("Errore generico nella funzione shopping-assistant:", error);
        res.status(500).json({ errore: "Impossibile generare i carrelli: " + error.message });
    }
}
