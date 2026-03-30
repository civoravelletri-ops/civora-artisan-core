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

    // Prepariamo il messaggio per l'IA (Tono differenziato tra i vari settori)
        let systemPrompt = "";
        let temperature = 0.7; // Default temperature

        // Determiniamo il settore corrente per adattare il systemPrompt
        const currentSector = contesto.settore; // 'cura_persona', 'veterinario', 'negoziante', 'artigiano', ecc.

        if (currentSector === "cura_persona") {
                systemPrompt = `Sei un esperto di marketing per il settore Wellness, Beauty e Salute.
                Il tuo obiettivo è trasmettere fiducia, relax e professionalità per un'attività di "${contesto.myTypeStore || 'Cura della Persona'}".
                Non limitarti a descrivere l'azione tecnica, ma enfatizza il benessere del cliente e il risultato emozionale.
                Usa un linguaggio caldo, rassicurante ed elegante.`;
        } else if (currentSector === "veterinario") { // ✨ NUOVO BLOCCO: PROMPT PER VETERINARIO ✨
                systemPrompt = `Sei un esperto di marketing per cliniche e ambulatori veterinari, pet shop e servizi per animali.
                Il tuo obiettivo è trasmettere professionalità, empatia, cura e affidabilità.
                Enfatizza la salute e il benessere degli animali, la competenza del personale e la tranquillità dei proprietari.
                Usa un linguaggio chiaro, rassicurante e informativo, adatto a un settore medico-veterinario.`;
        } else { // Prompt generico per altri settori non specificati
                systemPrompt = `Sei un esperto di marketing per negozi locali e il tuo compito è generare contenuti specifici per prodotti e servizi commerciali.
                Utilizza un linguaggio semplice, persuasivo e adatto a un pubblico locale.`;
        }

            systemPrompt += `\n\nREGOLA FONDAMENTALE: Rispondi SOLO E UNICAMENTE con il testo richiesto per il campo specificato.
                NON includere etichette come "Descrizione breve:", "Tags:", ecc.
                NON usare virgolette all'inizio e alla fine del testo generato.
                Il testo deve essere direttamente il contenuto da inserire nel campo.`;

            let userPromptContent = '';

            // === LOGICA PER SETTORE CURA DELLA PERSONA (Wellness/Beauty/Salute) ===
            if (currentSector === "cura_persona") {
                // Logica specifica per i servizi già presente
                const infoBaseServizio = `Servizio: "${contesto.nome}". Categoria: "${contesto.categoria} / ${contesto.sottocategoria || ''}". Tipo Attività: "${contesto.myTypeStore}". Prezzo: ${contesto.prezzo}€. Durata: ${contesto.durata} min.`;

                if (campo === "titolo_cura") {
                    userPromptContent = infoBaseServizio + `\nGenera un titolo professionale e invitante (max 60 caratteri) per questo servizio. Deve suonare esclusivo e curato.`;
                } else if (campo === "descrizione_breve_cura") {
                    userPromptContent = infoBaseServizio + `\nGenera una descrizione brevissima e poetica (max 150 caratteri). Uno slogan che faccia desiderare di prenotare subito.`;
                } else if (campo === "descrizione_esperienza_cura") {
                    userPromptContent = infoBaseServizio + `\nScrivi una descrizione dettagliata dell'ESPERIENZA che il cliente vivrà. Parla dell'atmosfera, della cura nei dettagli e del beneficio finale (relax, bellezza, salute). Usa 3-4 paragrafi coinvolgenti.`;
                }
                // LOGICA AGGIORNATA PER IL PROFILO E PRODOTTI "CURA DELLA PERSONA" (e ora VETERINARIO)
                else if (campo.endsWith("_profile") || campo.endsWith("_cura_product")) {
                    const isProfile = campo.endsWith("_profile");
                    const entityName = isProfile ? (contesto.store_name || "questo studio/salone") : (contesto.product_name || "questo prodotto di cura della persona");
                    const entityType = isProfile ? (contesto.myTypeStore || "un'attività di cura della persona") : (contesto.product_category || contesto.myTypeStore || "un prodotto di cura della persona");
                    const baseInfo = isProfile ?
                        `Nome Studio: "${entityName}". Tipologia: "${entityType}".` :
                        `Prodotto: "${entityName}". Categoria: "${entityType}". Sottocategoria: "${contesto.product_subcategory || 'non specificata'}". Marca: "${contesto.product_brand || 'non specificata'}". Tipo Attività: "${contesto.myTypeStore}".`;

                    const currentText = (contesto.currentFieldValue || "").trim();
                    let actionPrompt = "";

                    if (currentText) {
                        actionPrompt = `Migliora e riscrivi il seguente testo, rendendolo più professionale, persuasivo e adatto al marketing. Mantieni l'intento originale e adattalo al contesto di ${entityName} (${entityType}).`;
                    } else {
                        actionPrompt = `Genera un nuovo testo per questo campo, basandoti sulle informazioni fornite.`;
                    }

                    if (campo === "short_description_profile") {
                        userPromptContent = `${baseInfo}\n${actionPrompt} Crea uno slogan accattivante e conciso (max 150 caratteri). Testo di partenza: "${currentText}"`;
                    } else if (campo === "description_profile") {
                        userPromptContent = `${baseInfo}\n${actionPrompt} Scrivi una descrizione completa e persuasiva (3-4 paragrafi). Descrivi storia, filosofia, unicità e l'esperienza cliente. Adatta il tono alla tipologia "${entityType}". Testo di partenza: "${currentText}"`;
                    } else if (campo === "tags_profile") {
                        userPromptContent = `${baseInfo}\n${actionPrompt} Genera 7-10 parole chiave (tags) pertinenti e popolari, separate da virgola. Includi termini relativi alla tipologia "${entityType}" e ai benefici offerti. Testo di partenza: "${currentText}"`;
                    } else if (campo === "specializations_profile") {
                        userPromptContent = `${baseInfo}\n${actionPrompt} Genera 5-7 specializzazioni chiave, separate da virgola. Focalizzati su servizi unici, tecniche innovative o aree di eccellenza in base alla tipologia "${entityType}". Testo di partenza: "${currentText}"`;
                    }
                    // CAMPI PRODOTTO CURA PERSONA
                    else if (campo === "product_name_cura_product") {
                        userPromptContent = `${baseInfo}\n${actionPrompt} Genera un nome di prodotto accattivante e professionale (max 60 caratteri). Testo di partenza: "${currentText}"`;
                    } else if (campo === "short_description_product_cura") {
                        userPromptContent = `${baseInfo}\n${actionPrompt} Crea una descrizione brevissima (slogan, max 150 caratteri) per il prodotto. Testo di partenza: "${currentText}"`;
                    } else if (campo === "description_product_cura") {
                        userPromptContent = `${baseInfo}\n${actionPrompt} Scrivi una descrizione completa e persuasiva (3-4 paragrafi) per il prodotto. Enfatizza benefici, uso e ingredienti chiave. Testo di partenza: "${currentText}"`;
                    } else if (campo === "tags_product_cura") {
                        userPromptContent = `${baseInfo}\n${actionPrompt} Genera 7-10 parole chiave (tags) pertinenti, separate da virgola, per il prodotto. Includi benefici, ingredienti e usi. Testo di partenza: "${currentText}"`;
                    } else if (campo === "keywords_product_cura") {
                        userPromptContent = `${baseInfo}\n${actionPrompt} Genera 7-10 termini di ricerca extra (keywords) pertinenti, separate da virgola, per il prodotto. Testo di partenza: "${currentText}"`;
                    } else if (campo === "ingredients_product_cura") {
                        userPromptContent = `${baseInfo}\n${actionPrompt} Scrivi un elenco di ingredienti dettagliato ma conciso per il prodotto. Testo di partenza: "${currentText}"`;
                    } else if (campo === "allergens_product_cura") {
                        userPromptContent = `${baseInfo}\n${actionPrompt} Genera un elenco di allergeni comuni, separati da virgola, pertinenti per il prodotto. Testo di partenza: "${currentText}"`;
                    } else if (campo === "attributes_product_cura") {
                        userPromptContent = `${baseInfo}\n${actionPrompt} Genera un elenco di benefici o attributi chiave, separati da virgola, per il prodotto (es. tipo di pelle, efficacia). Testo di partenza: "${currentText}"`;
                    }
                    temperature = 0.6;
                }
            }
            // === LOGICA PER SETTORE VETERINARIO (NUOVO BLOCCO) ===
            else if (currentSector === "veterinario") { // ✨ NUOVO BLOCCO: LOGICA PROMPT PER VETERINARIO ✨
                const isProfile = campo.endsWith("_profile_vet"); // Nuovo suffisso per i campi profilo Vet
                const entityName = isProfile ? (contesto.store_name || "questa clinica veterinaria") : (contesto.service_name || contesto.product_name || "questo servizio/prodotto per animali");
                const entityType = isProfile ? (contesto.myTypeStore || "un'attività veterinaria") : (contesto.service_category || contesto.product_category || "un prodotto/servizio per animali");

                const baseInfo = `Entità: "${entityName}". Tipologia: "${entityType}".`;

                const currentText = (contesto.currentFieldValue || "").trim();
                let actionPrompt = "";

                if (currentText) {
                    actionPrompt = `Migliora e riscrivi il seguente testo, rendendolo più professionale, empatico e adatto al marketing veterinario. Mantieni l'intento originale e adattalo al contesto di ${entityName} (${entityType}).`;
                } else {
                    actionPrompt = `Genera un nuovo testo per questo campo, basandoti sulle informazioni fornite.`;
                }

                // Campi profilo Clinica Veterinaria
                if (campo === "short_description_profile_vet") {
                    userPromptContent = `${baseInfo}\n${actionPrompt} Crea uno slogan accattivante e conciso (max 150 caratteri) che trasmetta cura e fiducia per la clinica. Testo di partenza: "${currentText}"`;
                } else if (campo === "description_profile_vet") {
                    userPromptContent = `${baseInfo}\n${actionPrompt} Scrivi una descrizione completa e persuasiva (3-4 paragrafi) per la clinica. Descrivi la missione, i valori, l'approccio alla cura degli animali e l'ambiente. Adatta il tono alla tipologia "${entityType}". Testo di partenza: "${currentText}"`;
                } else if (campo === "tags_profile_vet") {
                    userPromptContent = `${baseInfo}\n${actionPrompt} Genera 7-10 parole chiave (tags) pertinenti e popolari, separate da virgola. Includi termini relativi alla tipologia "${entityType}", ai servizi offerti e alle specie animali. Testo di partenza: "${currentText}"`;
                } else if (campo === "specializations_profile_vet") {
                    userPromptContent = `${baseInfo}\n${actionPrompt} Genera 5-7 specializzazioni chiave, separate da virgola. Focalizzati su aree mediche uniche, tecniche innovative o specie animali particolari in base alla tipologia "${entityType}". Testo di partenza: "${currentText}"`;
                }
                // Campi servizio Veterinario (se avrai bisogno di Magia AI anche qui)
                else if (campo === "titolo_vet_service") {
                    const infoBaseServizio = `Servizio: "${contesto.nome}". Categoria: "${contesto.categoria} / ${contesto.sottocategoria || ''}". Tipo Attività: "${contesto.myTypeStore}". Prezzo: ${contesto.prezzo}€. Durata: ${contesto.durata} min.`;
                    userPromptContent = infoBaseServizio + `\n${actionPrompt} Genera un titolo professionale e chiaro (max 60 caratteri) per questa prestazione veterinaria. Deve suonare affidabile e descrittivo. Testo di partenza: "${currentText}"`;
                } else if (campo === "descrizione_breve_vet_service") {
                    const infoBaseServizio = `Servizio: "${contesto.nome}". Categoria: "${contesto.categoria} / ${contesto.sottocategoria || ''}". Tipo Attività: "${contesto.myTypeStore}". Prezzo: ${contesto.prezzo}€. Durata: ${contesto.durata} min.`;
                    userPromptContent = infoBaseServizio + `\n${actionPrompt} Genera una descrizione brevissima (slogan, max 150 caratteri) che spieghi rapidamente il beneficio di questa prestazione per l'animale. Testo di partenza: "${currentText}"`;
                } else if (campo === "descrizione_esperienza_vet_service") {
                    const infoBaseServizio = `Servizio: "${contesto.nome}". Categoria: "${contesto.categoria} / ${contesto.sottocategoria || ''}". Tipo Attività: "${contesto.myTypeStore}". Prezzo: ${contesto.prezzo}€. Durata: ${contesto.durata} min.`;
                    userPromptContent = infoBaseServizio + `\n${actionPrompt} Scrivi una descrizione dettagliata di come si svolge la prestazione, cosa aspettarsi, l'approccio empatico con l'animale e il supporto al proprietario. Usa 3-4 paragrafi informativi. Testo di partenza: "${currentText}"`;
                }
                temperature = 0.6; // Manteniamo la stessa temperatura per l'accuratezza
            }
            // === LOGICA PER PRODOTTI (Bazar / Business) ===
            else if (campo.includes("descrizione_breve") || campo.includes("descrizione_completa") || campo.includes("tags") || campo.includes("keywords") || campo.includes("titolo")) {
                // Questa logica si applica a prodotti e servizi generici (non cura_persona o veterinario)
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
            // === LOGICA PER SERVIZI TECNICI (Artigiani/Servizi Business - Non Cura Persona/Veterinario) ===
            else if (campo.includes("servizio") || campo.includes("tags_servizio")) {
                userPromptContent = `Il servizio si chiama "${contesto.nome}". Categoria: "${contesto.categoria}". ${contesto.priceContext || ''}`;

                if (campo === "descrizione_breve_servizio") {
                    userPromptContent += `\nGenera uno slogan tecnico/commerciale di massimo 150 caratteri.`;
                } else if (campo === "descrizione_completa_servizio") {
                    userPromptContent += `\nGenera una descrizione professionale di 3-4 paragrafi che spieghi l'efficacia del servizio.`;
                } else if (campo === "tags_servizio") {
                    userPromptContent += `\nGenera 5-7 parole chiave tecniche separate da virgola.`;
                }
            }
            // === LOGICA PER VISIONE D'IMMAGINE ===
            else if (campo === "visione_immagine") {
                // Questo è già gestito con un blocco `if (campo === "visione_immagine")` più avanti per la modifica di `messages` e `aiModel`
                // Lasciamo vuoto qui perché la logica per messages è speciale.
            }
            else {
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
            temperature = 0.3; // Specific for vision, often lower for structured output
        }

        try {
            const bodyRequest = {
                model: aiModel,
                messages: messages,
                temperature: temperature
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
