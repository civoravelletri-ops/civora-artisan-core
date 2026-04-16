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

    let systemPrompt = "";
    let userPromptText = "";
    let isJsonMode = false;
    let modelToUse = "meta-llama/llama-4-scout-17b-16e-instruct"; // Modello predefinito

    // --- SELEZIONE DELLA MODALITÀ (ASSISTENTE SPESA, ESPERTO, SOCIAL) ---
    if (contesto.isFullShopping) {
        // Modalità: Assistente Spesa
        isJsonMode = true;
        modelToUse = "mixtral-8x7b-32768"; // Modello più robusto per ragionamento su liste
        systemPrompt = `Sei il Personal Shopper esperto del banco "${contesto.store_name}" di Civora.
        Il tuo compito è creare 3 proposte di carrello uniche e ottimizzate basate sulla richiesta del cliente.

        REGOLE FONDAMENTALI:
        1. Utilizza SOLO i prodotti inclusi nella LISTA PRODOTTI DISPONIBILI. NON INVENTARE PRODOTTI.
        2. Per ogni prodotto suggerito, indica l'ID del prodotto (campo 'id') esattamente come fornito nella lista. Questo è CRUCIALE.
        3. Crea 3 carrelli diversi per stile e scopo (es: "Carrello Risparmio", "Carrello Gourmet", "Carrello Veloce", "Carrello Settimanale per Famiglia"). Inventa nomi creativi e pertinenti.
        4. Per ogni prodotto all'interno di un carrello, specifica una quantità (`qty`) numerica (es. 1, 2, 500) adeguata alla richiesta dell'utente. Se il prodotto è venduto a peso, la quantità sarà in grammi (es. 500).
        5. La 'descrizione' di ogni carrello deve essere breve, informativa e accattivante, spiegando il focus del carrello.
        6. RISPONDI ESCLUSIVAMENTE con un oggetto JSON valido. NESSUN TESTO AGGIUNTIVO, INTRODUZIONI O CONCLUSIONI FUORI DAL JSON.
        7. Includi il 'prezzo' di ogni prodotto all'interno dell'oggetto del prodotto nel carrello.

        FORMATO JSON RICHIESTO (ARRAY DI OGGETTI CARRELLO):
        {
          "carrelli": [
            {
              "nome": "Nome Carrello 1 (es. Per la tua Grigliata!)",
              "descrizione": "Una breve frase che descrive il carrello (es. La selezione perfetta per 2 persone amanti della carne, pronta per il weekend).",
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
                { "id": "ID_PRODOTTO_DA_LISTA_5", "nome": "Nome Prodotto 5", "qty": 1, "prezzo": 12.00 }
              ]
            }
          ]
        }`;

        userPromptText = `RICHIESTA UTENTE: "${contesto.richiestaUtente}"
        LISTA PRODOTTI DISPONIBILI (ID, NOME, PREZZO, UNITA, CATEGORIA, SPECIFICHE):
        ${JSON.stringify(contesto.prodotti)}`;

    } else if (contesto.isAIAssistant || contesto.nota_extra?.includes("Agisci come un esperto")) {
        // Modalità: Assistente Esperto (dettaglio prodotto)
        systemPrompt = `Sei l'Assistente Esperto di un banco del Mercato Fresco di Civora.
        Il tuo obiettivo è consigliare il cliente, rispondere ai suoi dubbi e aiutarlo a usare al meglio il prodotto.

        REGOLE DI COMPORTAMENTO:
        1. TONO: Amichevole, caloroso e professionale (come il macellaio o il fruttivendolo di fiducia). Usa il "tu".
        2. COMPETENZA: Dai consigli pratici su come cucinare il prodotto, come conservarlo e con cosa abbinarlo (vini, contorni).
        3. STORYTELLING: Esalta la provenienza e la freschezza citando i dati forniti.
        4. VENDITA GENTILE: Incoraggia l'acquisto sottolineando la qualità, senza essere insistente.
        5. FORMATTAZIONE: Usa i **grassetti** per le cose importanti e le emoji per rendere la lettura piacevole.

        Rispondi in modo conciso ma esaustivo.`;

        userPromptText = `Un cliente ti chiede informazioni su questo prodotto:
        - Nome: "${contesto.nome}"
        - Categoria: "${contesto.categoria || contesto.categoryGroup}"
        - Provenienza: "${contesto.provenienza || 'Italia'}"
        - Descrizione del Venditore: "${contesto.descrizione}"
        - Dettagli Tecnici: "${contesto.specifiche || ''}"

        DOMANDA DEL CLIENTE: "${contesto.nota_extra}"`;

    } else {
        // Modalità: Senior Social Media Copywriter (post social)
        systemPrompt = `Sei un Senior Social Media Copywriter da Agenzia di Marketing di Lusso. Il tuo compito è creare post ad ALTO IMPATTO magnetici.
        REGOLE: Inizia con un TITOLO IN GRASSETTO MAIUSCOSO tra emoji. Usa elenchi puntati eleganti. Usa i grassetti per prezzi e urgenza. Crea FOMO se scorte basse.
        Rispondi SOLO con il testo del post pronto da copiare.`;

        // Calcolo Urgenza e Offerta (mantienilo qui per il contesto Social)
        const isLowStock = contesto.quantita > 0 && contesto.quantita <= 3;
        const hasDiscount = contesto.originalPrice && contesto.originalPrice > contesto.prezzo;
        const discountPercent = hasDiscount ? Math.round(((contesto.originalPrice - contesto.prezzo) / contesto.originalPrice) * 100) : 0;

        userPromptText = `Dati per il post social:
        - Negozio: "${contesto.store_name}"
        - Prodotto: "${contesto.nome}"
        - Prezzo: ${contesto.prezzo}€ ${hasDiscount ? `(Sconto del ${discountPercent}%)` : ''}
        - Quantità: ${contesto.quantita}
        - Descrizione: "${contesto.descrizione}"
        - Note Extra: "${contesto.note_extra || 'Creatività libera'}"
        - Link: ${contesto.link_shop}

        ${isLowStock ? '!!! CREA URGENZA: SCORTE QUASI FINITE !!!' : ''}`;
    }

    const messageContent = [
        { type: "text", text: userPromptText }
    ];

    // Le immagini vengono analizzate solo se non siamo in modalità full shopping (per non confondere l'AI con le liste)
    if (!contesto.isFullShopping) {
        const imagesToAnalyze = contesto.allImages && contesto.allImages.length > 0
                                ? contesto.allImages.slice(0, 2)
                                : (contesto.imageUrl ? [contesto.imageUrl] : []);
        imagesToAnalyze.forEach(url => {
            messageContent.push({ type: "image_url", image_url: { url: url } });
        });
    }

    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: modelToUse, // Usa il modello deciso in base alla modalità
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: messageContent }
                ],
                temperature: 0.7, // Manteniamo il temperature leggermente più basso per coerenza nei carrelli
                max_tokens: 2000, // Aumentiamo i token per liste più lunghe, specialmente per i carrelli
                response_format: isJsonMode ? { type: "json_object" } : undefined
            })
        });
        const data = await response.json();

        if (data.error) {
            console.error("Errore da Groq:", data.error);
            return res.status(500).json({ errore: "Errore da Groq: " + data.error.message });
        }

        const generatedContent = data.choices[0].message.content.trim();

        if (isJsonMode) {
            // Tentativo di parsing più robusto, in caso Groq restituisca JSON "malformato"
            try {
                const parsedContent = JSON.parse(generatedContent);
                res.status(200).json(parsedContent);
            } catch (parseError) {
                console.error("Errore nel parsing JSON da Groq:", parseError, "Contenuto ricevuto:", generatedContent);
                res.status(500).json({ errore: "L'AI ha risposto in modo inatteso, riprova. Dettaglio: " + parseError.message });
            }
        } else {
            res.status(200).json({ post: generatedContent });
        }

    } catch (error) {
        console.error("La magia social/shopping si è interrotta:", error);
        res.status(500).json({ errore: "La magia si è interrotta: " + error.message });
    }
}
