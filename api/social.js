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

        // FASE 1: PREPARAZIONE DATI E OCCHI
            const imagesToAnalyze = contesto.allImages && contesto.allImages.length > 0
                                    ? contesto.allImages.slice(0, 2)
                                    : (contesto.imageUrl ? [contesto.imageUrl] : []);

            // Calcolo Urgenza e Offerta
                        const isLowStock = contesto.quantita > 0 && contesto.quantita <= 3;
                        const hasDiscount = contesto.originalPrice && contesto.originalPrice > contesto.prezzo;
                        const discountPercent = hasDiscount ? Math.round(((contesto.originalPrice - contesto.prezzo) / contesto.originalPrice) * 100) : 0;

                        // --- SELEZIONE AUTOMATICA DELLE ISTRUZIONI (SOCIAL vs ESPERTO) ---
                        let systemPrompt = "";
                        let userPromptText = "";

                        // Se nel pacchetto c'è una domanda del cliente, diventiamo l'Esperto del Banco
                        if (contesto.isAIAssistant || contesto.nota_extra?.includes("Agisci come un esperto")) {

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
                            // ALTRIMENTI: Restiamo il Senior Copywriter per i post social
                            systemPrompt = `Sei un Senior Social Media Copywriter da Agenzia di Marketing di Lusso. Il tuo compito è creare post ad ALTO IMPATTO magnetici.
                            REGOLE: Inizia con un TITOLO IN GRASSETTO MAIUSCOLO tra emoji. Usa elenchi puntati eleganti. Usa i grassetti per prezzi e urgenza. Crea FOMO se scorte basse.
                            Rispondi SOLO con il testo del post pronto da copiare.`;

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

            imagesToAnalyze.forEach(url => {
                messageContent.push({ type: "image_url", image_url: { url: url } });
            });

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
                            { role: "user", content: messageContent }
                        ],
                        temperature: 0.8,
                        max_tokens: 1200
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
