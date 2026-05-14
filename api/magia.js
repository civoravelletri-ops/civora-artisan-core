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

    // Estraiamo campo (usato per testi) o action (usato per spedizioni)
        const { campo, action, contesto } = req.body;
        const task = action || campo;

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
        } else if (currentSector === "agrigarden") {
                    systemPrompt = `Sei l'Assistente Digitale di Civora per AgriGarden.
                    Il tuo tono è ispiratore, rustico, umano e sincero.
                    Usa parole come 'radici', 'passione', 'tradizione', 'natura', 'cura'.
                    Se ti viene chiesto di generare la filosofia aziendale ("storia_azienda"), rispondi ESCLUSIVAMENTE con un array JSON di 4 stringhe diverse:
                    1. Poetica ed Emozionale
                    2. Concreta ed Esperta
                    3. Familiare ed Accogliente
                    4. Breve e d'Impatto
                    Non aggiungere altro testo. Esempio:["Testo 1", "Testo 2", "Testo 3", "Testo 4"]`;
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

            // === LOGICA SPECIFICA AGRIGARDEN (Storia Aziendale) ===
                        else if (campo === "storia_azienda") {
                            const testoPartenza = (contesto.testo || "").trim();
                            userPromptContent = `Riscrivi questa filosofia aziendale per un vivaio, rendendola autentica e profonda: "${testoPartenza}".`;
                            temperature = 0.7;
                        }
            // === NUOVA LOGICA: STIMA PESO E DIMENSIONI (SPEDIZIONE) ===
                        else if (task === "estimate_shipping_attributes") {
                            systemPrompt = `Sei un esperto di logistica e spedizioni e-commerce.
                            Il tuo compito è stimare il peso reale (in kg) e le dimensioni dell'imballaggio (in cm) per un prodotto.
                            Sii realistico: considera anche il peso del vaso/terra per le piante o della scatola/protezioni per i macchinari.`;

                            userPromptContent = `Estima peso e dimensioni per la spedizione di questo prodotto:
                            Nome: "${contesto.productName || contesto.nome}"
                            Categoria: "${contesto.productCategory || contesto.categoria}"
                            Tipo: "${contesto.productType}"
                            Descrizione: "${contesto.productShortDescription || contesto.productDescription || ''}"
                            ${contesto.brand ? 'Marca: ' + contesto.brand : ''}

                            REGOLE DI RISPOSTA:
                            Rispondi ESCLUSIVAMENTE con un oggetto JSON valido.
                            Usa queste chiavi: "weight" (numero in kg), "length" (numero in cm), "width" (numero in cm), "height" (numero in cm).
                            Esempio: {"weight": 1.5, "length": 30, "width": 20, "height": 15}`;

                            temperature = 0.3;
                        }
                        // === NUOVA LOGICA: STIMA PESO E DIMENSIONI (SPEDIZIONE) ===
                                    else if (task === "estimate_shipping_attributes") {
                                        systemPrompt = `Sei un esperto di logistica e spedizioni e-commerce.
                                        Il tuo compito è stimare il peso reale (in kg) e le dimensioni dell'imballaggio (in cm) per un prodotto.
                                        Sii realistico: considera anche il peso del vaso/terra per le piante o della scatola/protezioni per i macchinari.`;

                                        userPromptContent = `Estima peso e dimensioni per la spedizione di questo prodotto:
                                        Nome: "${contesto.productName || contesto.nome}"
                                        Categoria: "${contesto.productCategory || contesto.categoria}"
                                        Tipo: "${contesto.productType}"
                                        Descrizione: "${contesto.productShortDescription || contesto.productDescription || ''}"
                                        ${contesto.brand ? 'Marca: ' + contesto.brand : ''}

                                        REGOLE DI RISPOSTA:
                                        Rispondi ESCLUSIVAMENTE con un oggetto JSON valido.
                                        Non aggiungere testo prima o dopo.
                                        Usa queste chiavi: "weight" (numero in kg), "length" (numero in cm), "width" (numero in cm), "height" (numero in cm).
                                        Esempio: {"weight": 1.5, "length": 30, "width": 20, "height": 15}`;

                                        temperature = 0.3;
                                    }
                                    // === LOGICA PER PRODOTTI (Bazar / Business) ===
                                    else if (task.includes("descrizione_breve") || task.includes("descrizione_completa") || task.includes("tags") || task.includes("keywords") || task.includes("titolo")) {
                                        userPromptContent = `Il prodotto base è "${contesto.nome || contesto.productName}". Categoria: "${contesto.categoria || contesto.productCategory}". Marca: "${contesto.marca || contesto.brand || ''}". Prezzo: "${contesto.prezzo || ''}€".`;

                                        if (task === "descrizione_breve") {
                                            userPromptContent += `\nGenera uno slogan accattivante (max 150 caratteri) per la "Descrizione Breve".`;
                                        } else if (task === "descrizione_completa") {
                                            userPromptContent += `\nGenera una descrizione dettagliata di 3-4 paragrafi per la "Descrizione Completa".`;
                                        } else if (task === "tags") {
                                            userPromptContent += `\nGenera 5-7 tag separati da virgola.`;
                                        } else if (task === "keywords") {
                                            userPromptContent += `\nGenera 7-10 parole chiave SEO separate da virgola.`;
                                        } else if (task === "titolo") {
                                            userPromptContent += `\nGenera un titolo commerciale irresistibile (max 60 caratteri).`;
                                        }
                                    }
                                    // === LOGICA PER SERVIZI TECNICI (Artigiani/Servizi Business) ===
                                    else if (task.includes("servizio") || task.includes("tags_servizio")) {
                                        userPromptContent = `Il servizio si chiama "${contesto.nome}". Categoria: "${contesto.categoria}". ${contesto.priceContext || ''}`;

                                        if (task === "descrizione_breve_servizio") {
                                            userPromptContent += `\nGenera uno slogan tecnico/commerciale di massimo 150 caratteri.`;
                                        } else if (task === "descrizione_completa_servizio") {
                                            userPromptContent += `\nGenera una descrizione professionale di 3-4 paragrafi che spieghi l'efficacia del servizio.`;
                                        } else if (task === "tags_servizio") {
                                            userPromptContent += `\nGenera 5-7 parole chiave tecniche separate da virgola.`;
                                        }
                                    }
            // === LOGICA PER VISIONE D'IMMAGINE ===
                        else if (task === "visione_immagine") {
                            // Gestito sotto nel blocco speciale
                        }
                        // === NUOVA LOGICA: STIMA PESO E DIMENSIONI (SPEDIZIONE) ===
                        else if (task === "estimate_shipping_attributes") {
                            systemPrompt = `Sei un esperto di logistica e spedizioni e-commerce.
                            Il tuo compito è stimare il peso reale (in kg) e le dimensioni dell'imballaggio (in cm) per un prodotto.
                            Sii realistico: considera anche il peso del vaso/terra per le piante o della scatola/protezioni per i macchinari.`;

                            userPromptContent = `Estima peso e dimensioni per la spedizione di questo prodotto:
                            Nome: "${contesto.productName}"
                            Categoria: "${contesto.productCategory}"
                            Tipo: "${contesto.productType}"
                            Descrizione: "${contesto.productShortDescription || contesto.productDescription || ''}"
                            ${contesto.brand ? 'Marca: ' + contesto.brand : ''}
                            ${contesto.enginePower ? 'Potenza: ' + contesto.enginePower : ''}

                            REGOLE DI RISPOSTA:
                            Rispondi ESCLUSIVAMENTE con un oggetto JSON valido.
                            Non aggiungere testo prima o dopo.
                            Usa queste chiavi: "weight" (numero in kg), "length" (numero in cm), "width" (numero in cm), "height" (numero in cm).
                            Esempio: {"weight": 1.5, "length": 30, "width": 20, "height": 15}`;

                            temperature = 0.3; // Più bassa per avere dati più precisi e meno creativi
                        }
                        else {
                            userPromptContent = `Genera un contenuto per il campo "${task}" relativo a "${contesto.nome || contesto.productName}" della categoria "${contesto.categoria || contesto.productCategory}".`;
                        }


        let messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPromptContent }
        ];

        let aiModel = "llama-3.1-8b-instant"; // RIPRISTINATO IL TUO MODELLO ORIGINALE
                let responseFormat = null;

                // Attiviamo la modalità JSON ufficiale di Groq per evitare testi inutili
                if (task === "visione_immagine" || task === "estimate_shipping_attributes") {
                    responseFormat = { "type": "json_object" };
                }

                if (task === "visione_immagine") {
                    // Utilizziamo il modello Vision ufficiale di Groq
                    aiModel = "meta-llama/llama-4-scout-17b-16e-instruct"; 
                    responseFormat = { "type": "json_object" }; // ATTIVA MODALITÀ JSON
                    messages = [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "text",
                                    text: "Analizza questa immagine di un prodotto per un mercatino dell'usato o bazar. Crea un titolo accattivante (max 60 caratteri), una descrizione persuasiva (3-4 righe) e stima un prezzo netto realistico per la vendita (restituisci solo il numero). Rispondi ESCLUSIVAMENTE in formato JSON con chiavi: 'titolo', 'descrizione', 'prezzo'."
                                },
                                {
                                    type: "image_url",
                                    image_url: { url: contesto.imageUrl }
                                }
                            ]
                        }
                    ];
                    temperature = 0.5;
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

            let testoGenerato = data.choices[0].message.content.trim();

                        // 1. SE È LA NUOVA STIMA SPEDIZIONE: Estraiamo SOLO il JSON se l'IA ha parlato troppo
                                    if (task === "estimate_shipping_attributes") {
                                        try {
                                            // Cerchiamo l'inizio e la fine delle parentesi graffe per isolare il JSON dalle chiacchiere
                                            const start = testoGenerato.indexOf('{');
                                            const end = testoGenerato.lastIndexOf('}');
                                            if (start !== -1 && end !== -1) {
                                                testoGenerato = testoGenerato.substring(start, end + 1);
                                            }
                                            // Verifichiamo che sia JSON valido prima di mandarlo
                                            JSON.parse(testoGenerato);
                                            return res.status(200).json({ risultato: testoGenerato });
                                        } catch (e) {
                                            // Se fallisce, mandiamo l'originale pulito dai backticks
                                            const fallback = testoGenerato.replace(/```json/g, "").replace(/```/g, "").trim();
                                            return res.status(200).json({ risultato: fallback });
                                        }
                                    }

                        // 2. SE È IL SETTORE AGRIGARDEN: Gestiamo l'array (per la storia o testi multipli)
                        if (currentSector === "agrigarden") {
                            try {
                                const parsed = JSON.parse(testoGenerato);
                                return res.status(200).json({ risultato: parsed });
                            } catch (e) {
                                return res.status(200).json({ risultato: [testoGenerato] });
                            }
                        }

                        // 3. PER TUTTI GLI ALTRI SETTORI (Bazar, Vet, Wellness, ecc.):
                        // Restituiamo il testo semplice come è sempre stato.
                        res.status(200).json({ risultato: testoGenerato });

                    } catch (error) {
                        res.status(500).json({ errore: "La magia si è interrotta: " + error.message });
                    }
                }
