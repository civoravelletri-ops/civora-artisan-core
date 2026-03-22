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

    // Prepariamo il messaggio per l'IA (Tono differenziato tra Negozio e Cura Persona)
        let systemPrompt = "";

        if (contesto && contesto.settore === "cura_persona") {
            systemPrompt = `Sei un esperto di marketing per il settore Wellness, Beauty e Salute.
            Il tuo obiettivo è trasmettere fiducia, relax e professionalità per un'attività di "${contesto.myTypeStore || 'Cura della Persona'}".
            Non limitarti a descrivere l'azione tecnica, ma enfatizza il benessere del cliente e il risultato emozionale.
            Usa un linguaggio caldo, rassicurante ed elegante.`;
        } else {
            systemPrompt = `Sei un esperto di marketing per negozi locali e il tuo compito è generare contenuti specifici per prodotti e servizi commerciali.
            Utilizza un linguaggio semplice, persuasivo e adatto a un pubblico locale.`;
        }

        systemPrompt += `\n\nREGOLA FONDAMENTALE: Rispondi SOLO E UNICAMENTE con il testo richiesto per il campo specificato.
            NON includere etichette come "Descrizione breve:", "Tags:", ecc.
            NON usare virgolette all'inizio e alla fine del testo generato.
            Il testo deve essere direttamente il contenuto da inserire nel campo.`;

        let userPromptContent = '';

            // === LOGICA PER SETTORE CURA DELLA PERSONA (Wellness/Beauty/Salute) ===
                        if (contesto.settore === "cura_persona") {
                            const infoBase = `Servizio: "${contesto.nome}". Categoria: "${contesto.categoria} / ${contesto.sottocategoria || ''}". Tipo Attività: "${contesto.myTypeStore}". Prezzo: ${contesto.prezzo}€. Durata: ${contesto.durata} min.`;

                            if (campo === "titolo_cura") {
                                userPromptContent = infoBase + `\nGenera un titolo professionale e invitante (max 60 caratteri) per questo servizio. Deve suonare esclusivo e curato.`;
                            } else if (campo === "descrizione_breve_cura") {
                                userPromptContent = infoBase + `\nGenera una descrizione brevissima e poetica (max 150 caratteri). Uno slogan che faccia desiderare di prenotare subito.`;
                            } else if (campo === "descrizione_esperienza_cura") {
                                userPromptContent = infoBase + `\nScrivi una descrizione dettagliata dell'ESPERIENZA che il cliente vivrà. Parla dell'atmosfera, della cura nei dettagli e del beneficio finale (relax, bellezza, salute). Usa 3-4 paragrafi coinvolgenti.`;
                            }
                        }
                        // === LOGICA PER PRODOTTI (Bazar / Business) ===
                        else if (campo.includes("descrizione_breve") || campo.includes("descrizione_completa") || campo.includes("tags") || campo.includes("keywords") || campo.includes("titolo")) {
                            userPromptContent = `Il prodotto base è "${contesto.nome}". Categoria: "${contesto.categoria}". Marca: "${contesto.marca}". Prezzo: "${contesto.prezzo}€".`;

                            if (campo === "descrizione_breve") {
                                userPromptContent += `\nGenera uno slogan accattivante (max 150 caratteri) per la "Descrizione Breve".`;
                            } else if (campo === "descrizione_completa") {
                                userPromptContent += `\nGenera una descrizione dettagliata di 3-4 paragrafi per la "Descrizione Completa".`;
                            } else if (campo === "tags") {
                                userPromptContent += `\nGenera 5-7 tag separati da virgola.`;
                            } else if (campo === "keywords") {
                                userPromptContent += `\nGenera 7-10 parole chiave SEO separate da virgola.`;
                            } else if (campo === "titolo") {
                                userPromptContent += `\nGenera un titolo commerciale irresistibile (max 60 caratteri).`;
                            }
                        }
                        // === LOGICA PER SERVIZI TECNICI (Artigiani/Servizi Business) ===
                        else if (campo.includes("servizio") || campo.includes("tags_servizio")) {
                            userPromptContent = `Il servizio si chiama "${contesto.nome}". Categoria: "${contesto.categoria}". ${contesto.priceContext || ''}`;

                            if (campo === "descrizione_breve_servizio") {
                                userPromptContent += `\nGenera uno slogan tecnico/commerciale di massimo 150 caratteri.`;
                            } else if (campo === "descrizione_completa_servizio") {
                                userPromptContent += `\nGenera una descrizione professionale di 3-4 paragrafi che spieghi l'efficacia del servizio.`;
                            } else if (campo === "tags_servizio") {
                                userPromptContent += `\nGenera 5-7 parole chiave tecniche separate da virgola.`;
                            }
                        } else {
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
