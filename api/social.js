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
        const { contesto } = req.body;
        const GROQ_API_KEY = process.env.GROQ_API_KEY;

        // FASE 0: VERIFICA PRESENZA CHIAVE API
        if (!GROQ_API_KEY) {
            return res.status(500).json({ errore: "Manca la chiave d'accesso GROQ_API_KEY nelle variabili d'ambiente di Vercel. Configurala nel tuo pannello Vercel!" });
        }

        // FASE 1: PREPARAZIONE DATI E IMMAGINI
        const imagesToAnalyze = contesto.allImages && contesto.allImages.length > 0
                                ? contesto.allImages.slice(0, 2)
                                : (contesto.imageUrl ? [contesto.imageUrl] : []);

        // Calcolo Urgenza e Sconto (per i post social)
        const isLowStock = contesto.quantita > 0 && contesto.quantita <= 3;
        const hasDiscount = contesto.originalPrice && contesto.originalPrice > contesto.prezzo;
        const discountPercent = hasDiscount ? Math.round(((contesto.originalPrice - contesto.prezzo) / contesto.originalPrice) * 100) : 0;

        // --- TRASCRIZIONE AUTOMATICA DEI VOCALI AUDIO (Whisper Groq) ---
        if (contesto.isBookingImport && contesto.isAudioTranscription && contesto.audioBase64) {
            const audioBuffer = Buffer.from(contesto.audioBase64, 'base64');
            const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
            const formData = new FormData();
            formData.append('file', blob, contesto.audioFilename || 'audio.mp3');
            formData.append('model', 'whisper-large-v3');
            formData.append('language', 'it');

            const whisperResponse = await fetch('https://api.groq.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`
                },
                body: formData
            });

            const whisperData = await whisperResponse.json();
            if (!whisperResponse.ok) {
                throw new Error(whisperData.error?.message || "Errore durante la trascrizione dell'audio.");
            }
            // Sostituiamo il testo del messaggio con la trascrizione audio
            contesto.messageText = whisperData.text;
        }

        // --- SELEZIONE AUTOMATICA DELLE ISTRUZIONI (SOCIAL vs ESPERTO vs IMPORT PRENOTAZIONE) ---
        let systemPrompt = "";
        let userPromptText = "";

        if (contesto.isBookingImport) {
            // STRADA 3: Importazione e parsing intelligente dell'appuntamento (Spporto alle date alternative)
            systemPrompt = `Sei l'assistente di reception virtuale di un salone di bellezza/studio professionale. Il tuo compito è analizzare un messaggio o la trascrizione di un audio informale, abbreviato o in dialetto, inviato da un cliente per prenotare un appuntamento, ed estrarre i dati in formato JSON.

            REGOLE DI ESTRAZIONE E CALCOLO:
            1. Nome: Estrai solo il nome del cliente (es: "Marco", "Giulia"). Se non lo trovi, lascia "".
            2. Data: Calcola la data esatta in formato AAAA-MM-GG basandoti sulla data di oggi che ti viene fornita. Es: se oggi è Domenica 21 Giugno 2026, "domani" sarà "2026-06-22", "mercoledì" o "mercoledì prossimo" sarà il primo mercoledì utile "2026-06-24", ecc.
            3. Ora: Estrai l'ora richiesta in formato HH:MM (es: "17:30"). Se l'ora è generica (es: "pomeriggio"), proponi un orario coerente (es: "17:00").
            4. Servizio: Identifica quale dei servizi reali del negozio (che trovi nella lista fornita) corrisponde di più alla richiesta del cliente (es: se chiede "baffo" o "radersi" e in listino c'è "Regolazione Barba", seleziona l'ID di quel servizio). Se non trovi riscontri, lascia "".
            5. Risposta WhatsApp (CONFERMA): Se NON ti viene fornito l'elenco "alternativeSlots", genera una risposta cordiale per confermare la prenotazione richiesta (es. "Ciao Marco! Ti confermo l'appuntamento...").
            6. Risposta WhatsApp (RIFIUTO E SPOSTAMENTO): Se ti viene fornito l'elenco "alternativeSlots", significa che l'orario richiesto era occupato. Genera un messaggio super diplomatico e amichevole dove spieghi che purtroppo quell'orario/giorno è al completo, ma offri esplicitamente le date/ore alternative dell'elenco. Mantieni lo stesso identico tono del cliente (es: se scrive in modo scherzoso/amichevole, rispondigli come un amico con "un abbraccio"; se scrive in modo formale/distaccato, mantieni una risposta professionale ed educata).

            Rispondi ESCLUSIVAMENTE con un oggetto JSON pulito e valido, senza formattazione markdown (niente racchiuso in tre apici o scritte come \`\`\`json), strutturato esattamente così:
            {
              "customerName": "Nome",
              "date": "YYYY-MM-DD",
              "time": "HH:MM",
              "serviceId": "ID_DEL_SERVIZIO",
              "suggestedReply": "Messaggio di risposta"
            }`;

            // Prepariamo la descrizione dell'utente differenziando se ci sono alternative
            userPromptText = `Contesto temporale (Oggi è): ${contesto.currentDate}
            Listino Servizi reali del Negozio:
            ${JSON.stringify(contesto.servicesList)}

            ${contesto.isAlternativeProposal ? `!!! ATTENZIONE: IL GIORNO RICHIESTO È COMPLETAMENTE OCCUPATO !!!
            Proponi al cliente queste date/ore alternative libere reali:
            ${JSON.stringify(contesto.alternativeSlots)}` : ''}

            Messaggio del cliente da analizzare: "${contesto.messageText}"`;

        } else if (contesto.isAIAssistant || contesto.nota_extra?.includes("Agisci come un esperto")) {
            // STRADA 1: Assistente Esperto del Banco
            systemPrompt = `Sei l'Assistente Esperto di un banco del Mercato Fresco di Civora.
            Il tuo obiettivo è consigliare il cliente, rispondere ai suoi dubbi e aiutarlo a usare al meglio il prodotto.

            REGOLE DI COMPORTAMENTO:
            1. TONO: Amichevole, caloroso e professionale. Usa il "tu".
            2. COMPETENZA: Dai consigli pratici su come cucinare il prodotto, come conservarlo e con cosa abbinarlo.
            3. STORYTELLING: Esalta la provenienza e la freschezza citando i dati forniti.
            4. VENDITA GENTILE: Incoraggia l'acquisto sottolineando la qualità, senza essere insolente.
            5. FORMATTAZIONE: Usa i **grassetti** e le emoji per rendere la lettura piacevole.`;

            userPromptText = `Un cliente ti chiede informazioni su questo prodotto:
            - Nome: "${contesto.nome}"
            - Categoria: "${contesto.categoria || 'Alimentari'}"
            - Provenienza: "${contesto.provenienza || 'Italia'}"
            - Descrizione del Venditore: "${contesto.descrizione || ''}"
            - Dettagli Tecnici: "${contesto.specifiche || ''}"

            DOMANDA DEL CLIENTE: "${contesto.nota_extra}"`;

        } else {
            // STRADA 2: Senior Copywriter per i post social
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

        // FASE 2: ADATTAMENTO STRUTTURA MESSAGGIO MULTIMODALE / TESTUALE
        let messageContent;
        if (imagesToAnalyze && imagesToAnalyze.length > 0) {
            messageContent = [
                { type: "text", text: userPromptText }
            ];
            imagesToAnalyze.forEach(url => {
                if (url && url.startsWith("http")) {
                    messageContent.push({ type: "image_url", image_url: { url: url } });
                }
            });
        } else {
            // Se non ci sono immagini, invia una stringa pulita per evitare conflitti di validazione con Groq
            messageContent = userPromptText;
        }

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: messageContent }
                ],
                temperature: 0.2, // Bassa per risposte stabili
                max_tokens: 1200
            })
        });

        const data = await response.json();

        // Se la chiamata HTTP a Groq fallisce
        if (!response.ok) {
            return res.status(500).json({ errore: "Errore da Groq (Status " + response.status + "): " + (data.error?.message || JSON.stringify(data)) });
        }

        // Se Groq risponde positivamente ma non restituisce testo
        if (!data.choices || data.choices.length === 0) {
            return res.status(500).json({ errore: "Groq non ha restituito risposte utilizzabili: " + JSON.stringify(data) });
        }

        const postGenerato = data.choices[0].message.content.trim();

        // Se è una richiesta di importazione appuntamento, ripuliamo l'output e restituiamo un JSON strutturato
        if (contesto.isBookingImport) {
            const jsonCleaned = postGenerato.replace(/```json/g, "").replace(/```/g, "").trim();
            try {
                const parsedJSON = JSON.parse(jsonCleaned);
                return res.status(200).json({ bookingData: parsedJSON });
            } catch (jsonErr) {
                console.error("Errore nel parsing del JSON restituito da Groq:", jsonErr);
                return res.status(200).json({ rawText: postGenerato, error: "L'IA non ha restituito un formato JSON valido." });
            }
        }

        res.status(200).json({ post: postGenerato });

    } catch (error) {
        res.status(500).json({ errore: "La magia si è interrotta: " + error.message });
    }
};
