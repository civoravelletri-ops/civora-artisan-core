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
    const systemPrompt = `Sei un esperto di marketing per negozi locali e il tuo compito è generare contenuti specifici per campi di un prodotto.
        Utilizza un linguaggio semplice, persuasivo e adatto a un pubblico locale.

        REGOLA FONDAMENTALE: Rispondi SOLO E UNICAMENTE con il testo richiesto per il campo specificato.
        NON includere etichette come "Descrizione breve:", "Tags:", ecc.
        NON usare virgolette all'inizio e alla fine del testo generato.
        Il testo deve essere direttamente il contenuto da inserire nel campo.`;

        let userPromptContent = '';

            // Contesto per PRODOTTI
                        if (campo.includes("descrizione_breve") || campo.includes("descrizione_completa") || campo.includes("tags") || campo.includes("keywords") || campo.includes("titolo")) {
                            userPromptContent = `Il prodotto base è "${contesto.nome}".
                            Si trova nella categoria "${contesto.categoria}".
                            La marca è "${contesto.marca}".
                            Il prezzo è "${contesto.prezzo}€".`;

                            if (campo === "descrizione_breve") {
                                userPromptContent += `\nGenera uno slogan accattivante e conciso di massimo 150 caratteri per la "Descrizione Breve".`;
                            } else if (campo === "descrizione_completa") {
                                userPromptContent += `\nGenera una descrizione emozionante e dettagliata, lunga circa 3-4 paragrafi, per la "Descrizione Completa". Il testo deve essere ricco di informazioni ma scorrevole.`;
                            } else if (campo === "tags") {
                                userPromptContent += `\nGenera 5-7 parole chiave pertinenti, separate da virgola, per il campo "Tags".`;
                            } else if (campo === "keywords") {
                                userPromptContent += `\nGenera 7-10 termini di ricerca aggiuntivi, separati da virgola, per il campo "Keywords".`;
                            } else if (campo === "titolo") {
                                userPromptContent += `\nGenera un Nome Prodotto (titolo commerciale acchiappa-click) di massimo 60 caratteri. Prendi spunto dal prodotto base inserito e rendilo irresistibile per un cliente che legge.`;
                            }
                        }
            // Contesto per SERVIZI
            else if (campo.includes("servizio") || campo.includes("tags_servizio")) {
                userPromptContent = `Il servizio si chiama "${contesto.nome}".
                Si trova nella categoria "${contesto.categoria}".
                ${contesto.priceContext ? contesto.priceContext : 'Il prezzo non è specificato o variabile.'}`;

                if (campo === "descrizione_breve_servizio") {
                    userPromptContent += `\nGenera uno slogan accattivante e conciso di massimo 150 caratteri per la "Descrizione Breve" del servizio.`;
                } else if (campo === "descrizione_completa_servizio") {
                    userPromptContent += `\nGenera una descrizione emozionante e dettagliata, lunga circa 3-4 paragrafi, per la "Descrizione Completa" del servizio. Il testo deve essere ricco di informazioni ma scorrevole.`;
                } else if (campo === "tags_servizio") {
                    userPromptContent += `\nGenera 5-7 parole chiave pertinenti, separate da virgola, per il campo "Tags" del servizio.`;
                }
            } else {
                // Fallback per campi non riconosciuti
                userPromptContent = `Genera un contenuto per il campo "${campo}" relativo a "${contesto.nome}" della categoria "${contesto.categoria}".`;
            }

        let messages = [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPromptContent }
                ];

                let aiModel = "llama-3.1-8b-instant"; // Modello standard per il testo

                // NUOVO: SE È UNA RICHIESTA VISIVA (FOTO)
                        let responseFormat = null;
                        if (campo === "visione_immagine") {
                            aiModel = "meta-llama/llama-4-scout-17b-16e-instruct"; // ID ESATTO DAI DOCS
                            responseFormat = { "type": "json_object" }; // ATTIVA MODALITÀ JSON
                            messages = [
                                {
                                    role: "user",
                                    content: [
                                        {
                                            type: "text",
                                            text: "Analizza questa immagine di un prodotto. Crea un titolo (max 60 caratteri) e una descrizione (3-4 righe). Rispondi in formato JSON con chiavi 'titolo' e 'descrizione'."
                                        },
                                        {
                                            type: "image_url",
                                            image_url: { url: contesto.imageUrl }
                                        }
                                    ]
                                }
                            ];
                        }
                
                    try {
                        const bodyRequest = {
                            model: aiModel,
                            messages: messages,
                            temperature: 0.7
                        };
                        
                        // Aggiunge il formato JSON solo se necessario
                        if (responseFormat) {
                            bodyRequest.response_format = responseFormat;
                        }
                
                        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                            method: "POST",
                            headers: {
                                "Authorization": `Bearer ${GROQ_API_KEY}`,
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify(bodyRequest)
                        });

                const data = await response.json();

                // Se Groq ci manda un errore, leggiamolo!
                if (data.error) {
                    return res.status(500).json({ errore: "Errore da Groq: " + data.error.message });
                }

                // Se non ci sono 'choices', qualcosa è andato storto
                if (!data.choices || data.choices.length === 0) {
                    return res.status(500).json({ errore: "L'IA non ha restituito risultati. Riprova." });
                }

                const testoGenerato = data.choices[0].message.content.trim();
                res.status(200).json({ risultato: testoGenerato });
    } catch (error) {
        res.status(500).json({ errore: "La magia si è interrotta: " + error.message });
    }
}
