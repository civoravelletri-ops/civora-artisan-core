module.exports = async function handler(req, res) {
    // Permetti al tuo sito di chiamare questa funzione (CORS)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const { action, contesto } = body;
        const campo = body.campo || "";
        const task = action || campo;

        const GROQ_API_KEY = process.env.GROQ_API_KEY || process.env.GROQ_KEY || process.env.GROQ_AI_KEY || process.env.GROQ_TOKEN;

        if (!contesto) {
            return res.status(400).json({ errore: "Dati di contesto mancanti nella richiesta." });
        }

        if (!GROQ_API_KEY) {
            return res.status(500).json({ errore: "Manca la chiave d'accesso GROQ_API_KEY nelle variabili d'ambiente di Vercel." });
        }

        // Prepariamo il messaggio per l'IA (Tono differenziato tra i vari settori)
        let systemPrompt = "";
        let temperature = 0.6;
        let maxTokensBudget = 1000;

        const currentSector = contesto.settore || "";

        if (currentSector === "cura_persona") {
            systemPrompt = `Sei un esperto di marketing per il settore Wellness, Beauty e Salute.
Il tuo obiettivo è trasmettere fiducia, relax e professionalità per un'attività di "${contesto.myTypeStore || 'Cura della Persona'}".
Non limitarti a descrivere l'azione tecnica, ma enfatizza il benessere del cliente e il risultato emozionale.
Usa un linguaggio caldo, rassicurante ed elegante. Sii conciso ed essenziale.`;
        } else if (currentSector === "veterinario") {
            systemPrompt = `Sei un esperto di marketing per cliniche e ambulatori veterinari, pet shop e servizi per animali.
Il tuo obiettivo è trasmettere professionalità, empatia, cura e affidabilità.
Enfatizza la salute e il benessere degli animali, la competenza del personale e la tranquillità dei proprietari.
Usa un linguaggio chiaro, rassicurante e informativo, adatto a un settore medico-veterinario. Sii conciso.`;
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
        if (currentSector === "cura_persona") {
            const infoBaseServizio = `Servizio: "${contesto.nome}". Categoria: "${contesto.categoria} / ${contesto.sottocategoria || ''}". Tipo Attività: "${contesto.myTypeStore}". Prezzo: ${contesto.prezzo}€. Durata: ${contesto.durata} min.`;

            if (campo === "titolo_cura") {
                userPromptContent = infoBaseServizio + `\nGenera un titolo professionale e invitante (max 60 caratteri) per questo servizio. Deve suonare esclusivo e curato.`;
                maxTokensBudget = 80;
            } else if (campo === "descrizione_breve_cura") {
                userPromptContent = infoBaseServizio + `\nGenera una descrizione brevissima e poetica (max 150 caratteri). Uno slogan che faccia desiderare di prenotare subito.`;
                maxTokensBudget = 100;
            } else if (campo === "descrizione_esperienza_cura") {
                userPromptContent = infoBaseServizio + `\nScrivi una descrizione dell'esperienza cliente di 2 brevi paragrafi (circa 400-600 caratteri in totale). Parla di atmosfera e relax.`;
                maxTokensBudget = 300;
            } else if (campo.endsWith("_profile") || campo.endsWith("_cura_product")) {
                const isProfile = campo.endsWith("_profile");
                const entityName = isProfile ? (contesto.store_name || "questo studio/salone") : (contesto.product_name || "questo prodotto di cura della persona");
                const entityType = isProfile ? (contesto.myTypeStore || "un'attività di cura della persona") : (contesto.product_category || contesto.myTypeStore || "un prodotto di cura della persona");
                const baseInfo = isProfile ?
                    `Nome Studio: "${entityName}". Tipologia: "${entityType}".` :
                    `Prodotto: "${entityName}". Categoria: "${entityType}". Sottocategoria: "${contesto.product_subcategory || 'non specificata'}". Marca: "${contesto.product_brand || 'non specificata'}". Tipo Attività: "${contesto.myTypeStore}".`;

                const currentText = (contesto.currentFieldValue || "").trim();
                let actionPrompt = currentText ?
                    `Migliora e riscrivi il seguente testo in modo persuasivo ed elegante. Mantieni l'intento originale e adattalo al contesto di ${entityName} (${entityType}).` :
                    `Genera un testo per questo campo basandoti sulle informazioni fornite.`;

                if (campo === "short_description_profile") {
                    userPromptContent = `${baseInfo}\n${actionPrompt} Crea uno slogan accattivante e conciso (massimo 150 caratteri). Testo di partenza: "${currentText}"`;
                    maxTokensBudget = 100;
                } else if (campo === "description_profile") {
                    // ✅ LIMITE RIGIDO: esattamente 2 brevi paragrafi, max 600-800 caratteri
                    userPromptContent = `${baseInfo}\n${actionPrompt} Scrivi una descrizione calda, professionale ed elegante di ESATTAMENTE 2 brevi paragrafi (lunghezza totale tra 500 e 750 caratteri). NON superare assolutamente gli 800 caratteri in totale! Testo di partenza: "${currentText}"`;
                    maxTokensBudget = 350;
                } else if (campo === "tags_profile") {
                    userPromptContent = `${baseInfo}\n${actionPrompt} Genera 7-10 parole chiave (tags) pertinenti, separate da virgola. Testo di partenza: "${currentText}"`;
                    maxTokensBudget = 150;
                } else if (campo === "specializations_profile") {
                    userPromptContent = `${baseInfo}\n${actionPrompt} Genera 5-7 specializzazioni chiave, separate da virgola. Testo di partenza: "${currentText}"`;
                    maxTokensBudget = 150;
                } else if (campo === "product_name_cura_product") {
                    userPromptContent = `${baseInfo}\n${actionPrompt} Genera un nome di prodotto accattivante e professionale (max 60 caratteri). Testo di partenza: "${currentText}"`;
                    maxTokensBudget = 80;
                } else if (campo === "short_description_product_cura") {
                    userPromptContent = `${baseInfo}\n${actionPrompt} Crea una descrizione brevissima (slogan, max 150 caratteri) per il prodotto. Testo di partenza: "${currentText}"`;
                    maxTokensBudget = 100;
                } else if (campo === "description_product_cura") {
                    userPromptContent = `${baseInfo}\n${actionPrompt} Scrivi una descrizione persuasiva di 2 brevi paragrafi per il prodotto (max 600 caratteri). Testo di partenza: "${currentText}"`;
                    maxTokensBudget = 300;
                } else if (campo === "tags_product_cura" || campo === "keywords_product_cura") {
                    userPromptContent = `${baseInfo}\n${actionPrompt} Genera 7-10 parole chiave separate da virgola. Testo di partenza: "${currentText}"`;
                    maxTokensBudget = 150;
                } else if (campo === "ingredients_product_cura") {
                    userPromptContent = `${baseInfo}\n${actionPrompt} Scrivi un elenco sintetico di ingredienti chiave. Testo di partenza: "${currentText}"`;
                    maxTokensBudget = 150;
                } else if (campo === "allergens_product_cura" || campo === "attributes_product_cura") {
                    userPromptContent = `${baseInfo}\n${actionPrompt} Genera un elenco separato da virgola. Testo di partenza: "${currentText}"`;
                    maxTokensBudget = 150;
                }
            }
        }
        // === LOGICA PER SETTORE VETERINARIO ===
        else if (currentSector === "veterinario") {
            const isProfile = campo.endsWith("_profile_vet");
            const entityName = isProfile ? (contesto.store_name || "questa clinica veterinaria") : (contesto.service_name || contesto.product_name || "questo servizio/prodotto per animali");
            const entityType = isProfile ? (contesto.myTypeStore || "un'attività veterinaria") : (contesto.service_category || contesto.product_category || "un prodotto/servizio per animali");
            const baseInfo = `Entità: "${entityName}". Tipologia: "${entityType}".`;

            const currentText = (contesto.currentFieldValue || "").trim();
            let actionPrompt = currentText ?
                `Migliora e riscrivi il seguente testo in modo empatico e professionale. Mantieni l'intento originale e adattalo al contesto di ${entityName} (${entityType}).` :
                `Genera un testo basandoti sulle informazioni fornite.`;

            if (campo === "short_description_profile_vet") {
                userPromptContent = `${baseInfo}\n${actionPrompt} Crea uno slogan accattivante e conciso (max 150 caratteri). Testo di partenza: "${currentText}"`;
                maxTokensBudget = 100;
            } else if (campo === "description_profile_vet") {
                userPromptContent = `${baseInfo}\n${actionPrompt} Scrivi una descrizione completa ed empatica di 2 brevi paragrafi (max 750 caratteri). Testo di partenza: "${currentText}"`;
                maxTokensBudget = 350;
            } else if (campo === "tags_profile_vet" || campo === "specializations_profile_vet") {
                userPromptContent = `${baseInfo}\n${actionPrompt} Genera 5-7 voci separate da virgola. Testo di partenza: "${currentText}"`;
                maxTokensBudget = 150;
            } else if (campo === "titolo_vet_service") {
                userPromptContent = `Servizio: "${contesto.nome}".\n${actionPrompt} Genera un titolo chiaro e professionale (max 60 caratteri).`;
                maxTokensBudget = 80;
            } else if (campo === "descrizione_breve_vet_service") {
                userPromptContent = `Servizio: "${contesto.nome}".\n${actionPrompt} Genera uno slogan brevissimo (max 150 caratteri).`;
                maxTokensBudget = 100;
            } else if (campo === "descrizione_esperienza_vet_service") {
                userPromptContent = `Servizio: "${contesto.nome}".\n${actionPrompt} Scrivi una descrizione rassicurante di 2 brevi paragrafi (max 600 caratteri).`;
                maxTokensBudget = 300;
            }
        }
        // === LOGICA SPECIFICA AGRIGARDEN ===
        else if (campo === "storia_azienda") {
            const testoPartenza = (contesto.testo || "").trim();
            userPromptContent = `Riscrivi questa filosofia aziendale per un vivaio, rendendola autentica e profonda: "${testoPartenza}".`;
            maxTokensBudget = 500;
        }
        // === LOGICA: STIMA SPEDIZIONE ===
        else if (task === "estimate_shipping_attributes") {
            systemPrompt = `Sei un esperto di logistica e-commerce per florovivaismo e piante.
Rispondi ESCLUSIVAMENTE con un JSON valido con le chiavi: "weight" (kg), "length" (cm), "width" (cm), "height" (cm). Esempio: {"weight": 3.5, "length": 25, "width": 25, "height": 60}`;
            userPromptContent = `Estima peso e dimensioni imballo per: Nome: "${contesto.productName || contesto.nome}", Prezzo: "${contesto.price || '0'} €", Desc: "${contesto.productShortDescription || ''}"`;
            maxTokensBudget = 150;
        }
        // === LOGICA GENERICA PRODOTTI / SERVIZI ===
        else if (task.includes("descrizione_breve")) {
            userPromptContent = `Genera uno slogan commerciale di massimo 150 caratteri per "${contesto.nome || contesto.productName}".`;
            maxTokensBudget = 100;
        } else if (task.includes("descrizione_completa") || task.includes("descrizione")) {
            userPromptContent = `Genera una descrizione commerciale accattivante di 2 brevi paragrafi (max 600 caratteri) per "${contesto.nome || contesto.productName}".`;
            maxTokensBudget = 300;
        } else if (task.includes("tags") || task.includes("keywords")) {
            userPromptContent = `Genera 5-7 tag separati da virgola per "${contesto.nome || contesto.productName}".`;
            maxTokensBudget = 150;
        } else {
            userPromptContent = `Genera un contenuto conciso per "${task}" relativo a "${contesto.nome || contesto.productName}".`;
            maxTokensBudget = 300;
        }

        let messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPromptContent }
        ];

        let responseFormat = null;
        const isVision = (task === "visione_immagine" || task === "importazione_agenda_ia");

        if (task === "visione_immagine" || task === "estimate_shipping_attributes") {
            responseFormat = { "type": "json_object" };
        }

        if (isVision) {
            let promptVisione = contesto.istruzioni_extra ||
                "Analizza questa immagine di un prodotto. Rispondi in JSON con chiavi: 'titolo', 'descrizione', 'prezzo'.";

            if (task === "importazione_agenda_ia") {
                promptVisione = `Estrai gli appuntamenti dall'immagine dell'agenda. Rispondi con JSON: {"prenotazioni": [{"data": "2026-07-28", "ora": "10:30", "cliente": "Marco Rossi", "telefono": "+393331234567", "servizio": "Taglio", "note": null}]}`;
            }

            messages = [
                {
                    role: "user",
                    content: [
                        { type: "text", text: promptVisione },
                        { type: "image_url", image_url: { url: contesto.imageUrl } }
                    ]
                }
            ];
            maxTokensBudget = 1200;
        }

        // Modelli attivi e affidabili su Groq
        const candidateModels = isVision
            ? ["qwen/qwen3.6-27b"]
            : ["openai/gpt-oss-20b", "qwen/qwen3.6-27b", "openai/gpt-oss-120b"];

        let testoGenerato = null;
        let lastError = null;

        for (const modelCandidate of candidateModels) {
            try {
                const bodyRequest = {
                    model: modelCandidate,
                    messages: messages,
                    temperature: temperature,
                    max_tokens: maxTokensBudget
                };

                if (responseFormat) {
                    bodyRequest.response_format = responseFormat;
                }

                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${GROQ_API_KEY.trim()}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(bodyRequest)
                });

                const data = await response.json();

                if (response.ok && data.choices && data.choices.length > 0) {
                    const choice = data.choices[0];
                    testoGenerato = (choice.message?.content || choice.message?.reasoning_content || "").trim();
                    if (testoGenerato) {
                        console.log(`[Magia AI] Successo con: ${modelCandidate}`);
                        break;
                    }
                } else {
                    const errMsg = data.error?.message || `HTTP ${response.status}`;
                    console.warn(`[Magia AI] Modello ${modelCandidate} fallito (${errMsg}), provo successivo...`);
                    lastError = new Error(errMsg);
                }
            } catch (callErr) {
                lastError = callErr;
            }
        }

        if (!testoGenerato) {
            return res.status(500).json({ errore: "Errore durante la generazione: " + (lastError?.message || "Servizio non disponibile") });
        }

        // Pulizia tag <think>, virgolette e markdown
        testoGenerato = testoGenerato.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        testoGenerato = testoGenerato.replace(/<\/?think>/gi, "").trim();

        // 1. Stima Spedizione JSON
        if (task === "estimate_shipping_attributes") {
            try {
                const start = testoGenerato.indexOf('{');
                const end = testoGenerato.lastIndexOf('}');
                if (start !== -1 && end !== -1) {
                    testoGenerato = testoGenerato.substring(start, end + 1);
                }
                JSON.parse(testoGenerato);
                return res.status(200).json({ risultato: testoGenerato });
            } catch (e) {
                const fallback = testoGenerato.replace(/```json/g, "").replace(/```/g, "").trim();
                return res.status(200).json({ risultato: fallback });
            }
        }

        // 2. AgriGarden Array
        if (currentSector === "agrigarden" && campo === "storia_azienda") {
            try {
                const parsed = JSON.parse(testoGenerato);
                return res.status(200).json({ risultato: parsed });
            } catch (e) {
                return res.status(200).json({ risultato: [testoGenerato] });
            }
        }

        // 3. Risposta Testuale
        return res.status(200).json({ risultato: testoGenerato });

    } catch (error) {
        console.error("[api/magia.js] Errore critico:", error);
        res.status(500).json({ errore: "La magia si è interrotta: " + error.message });
    }
};
