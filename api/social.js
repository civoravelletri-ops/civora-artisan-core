// Importa i moduli Firebase admin SDK per Vercel
// Attenzione: Non li hai usati nel tuo codice originale, ma a volte problemi CORS possono essere legati
// a come le variabili d'ambiente vengono gestite o all'inizializzazione del runtime Node.js.
// Li includo per massima compatibilità, ma non li utilizzeremo direttamente per le chiamate a Firebase
// da questa funzione, che ora viene fatta lato client.
// const admin = require('firebase-admin');
// if (!admin.apps.length) {
//     admin.initializeApp({
//         credential: admin.credential.applicationDefault(),
//         databaseURL: process.env.FIREBASE_DATABASE_URL // Assicurati di avere questa variabile in Vercel
//     });
// }
// const dbAdmin = admin.firestore();


export default async function handler(req, res) {
    // Gestione CORS: Più completa e proattiva.
    // Permetti al tuo sito (e a qualsiasi altra origine) di chiamare questa funzione
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*'); // Risponde con l'origine della richiesta, o '*' se non specificata (più robusto)
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
    res.setHeader('Vary', 'Origin'); // Indica che la risposta può variare in base all'origine

    // Gestione preflight (OPTIONS request)
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { contesto } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    // FASE 1: PREPARAZIONE DATI E OCCHI (come nel tuo originale)
    const imagesToAnalyze = contesto.allImages && contesto.allImages.length > 0
                            ? contesto.allImages.slice(0, 2)
                            : (contesto.imageUrl ? [contesto.imageUrl] : []);

    // Calcolo Urgenza e Offerta (come nel tuo originale)
    const isLowStock = contesto.quantita > 0 && contesto.quantita <= 3;
    const hasDiscount = contesto.originalPrice && contesto.originalPrice > contesto.prezzo;
    const discountPercent = hasDiscount ? Math.round(((contesto.originalPrice - contesto.prezzo) / contesto.originalPrice) * 100) : 0;

    // --- SELEZIONE AUTOMATICA DELLE ISTRUZIONI E MODALITÀ ---
    let systemPrompt = "";
    let userPromptText = "";
    let isJsonMode = false; // Flag per indicare se la risposta deve essere JSON
    let modelToUse = "meta-llama/llama-4-scout-17b-16e-instruct"; // Modello predefinito per le tue due funzioni esistenti

    // PRIMA FUNZIONE ESISTENTE: Assistente Esperto del Banco (come nel tuo originale)
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

    }
    // SECONDA FUNZIONE ESISTENTE: Senior Social Media Copywriter (come nel tuo originale)
    else if (contesto.isFullShopping !== true && contesto.isAIAssistant !== true) { // Condizione esplicita per la tua seconda funzione, escludendo la nuova
        systemPrompt = `Sei un Senior Social Media Copywriter da Agenzia di Marketing di Lusso. Il tuo compito è creare post ad ALTO IMPATTO magnetici.
        REGOLE: Inizia con un TITOLO IN GRASSETTO MAIUSCOSO tra emoji. Usa elenchi puntati eleganti. Usa i grassetti per prezzi e urgenza. Crea FOMO se scorte basse.
        Rispondi SOLO con il testo del post pronto da copiare.`;

        userPromptText = `Dati per il post social:
        - Negozio: "${contesto.store_name}"
        - Prodotto: "${contesto.nome}"
        - Prezzo: ${contesto.prezzo}€ ${hasDiscount ? `(Sconto del ${discountPercent}%)` : ''}
        - Quantità: ${contesto.quantita}
        - Descrizione: "${contesto.descrizione}"
        - Note Extra: "${contesto.nota_extra || 'Creatività libera'}"
        - Link: ${contesto.link_shop}

        ${isLowStock ? '!!! CREA URGENZA: SCORTE QUASI FINITE !!!' : ''}`;
    }
    // TERZA NUOVA FUNZIONE: Assistente alla Spesa Completa (attivata solo se specificato)
    else if (contesto.isFullShopping === true) { // Condizione esplicita per la nuova funzione
        isJsonMode = true;
        modelToUse = "mixtral-8x7b-32768"; // Modello più robusto per il ragionamento su liste
        systemPrompt = `Sei il Personal Shopper esperto del banco "${contesto.store_name}" di Civora.
        Il tuo compito è creare 3 proposte di carrello uniche e ottimizzate basate sulla richiesta del cliente.
        
        REGOLE FONDAMENTALI:
        1. Utilizza SOLO i prodotti inclusi nella LISTA PRODOTTI DISPONIBILI. NON INVENTARE PRODOTTI.
        2. Per ogni prodotto suggerito, indica l'ID del prodotto (campo 'id') esattamente come fornito nella lista. Questo è CRUCIALE.
        3. Crea 3 carrelli diversi per stile e scopo (es: "Carrello Risparmio", "Carrello Gourmet", "Carrello Veloce", "Carrello Settimanale per Famiglia"). Inventa nomi creativi e pertinenti in base alla richiesta.
        4. Per ogni prodotto all'interno di un carrello, specifica una quantità (`qty`) numerica (es. 1, 2, 500) adeguata alla richiesta dell'utente. Se il prodotto è venduto a peso, la quantità sarà in grammi (es. 500).
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

        userPromptText = `RICHIESTA UTENTE: "${contesto.richiestaUtente}"
        LISTA PRODOTTI DISPONIBILI (ID, NOME, PREZZO, UNITA, CATEGORIA, SPECIFICHE):
        ${JSON.stringify(contesto.prodotti)}`;
    }


    const messageContent = [
        { type: "text", text: userPromptText }
    ];

    // Le immagini vengono analizzate solo se non siamo in modalità full shopping (per non confondere l'AI con le liste)
    // Ho reso la condizione più esplicita per non interferire con le tue due funzioni originali.
    if (!contesto.isFullShopping) {
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
                temperature: 0.7, // Manteniamo il temperature leggermente più basso per coerenza nei carrelli e generazioni stabili
                max_tokens: 2000, // Aumentiamo i token per liste più lunghe, specialmente per i carrelli
                response_format: isJsonMode ? { type: "json_object" } : undefined
            })
        });
        const data = await response.json();

        if (data.error) {
            console.error("Errore da Groq:", data.error);
            return res.status(500).json({ errore: "Errore da Groq: " + (data.error.message || "Errore sconosciuto") });
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
            // Per le altre modalità (Esperto e Social), restituisci sempre l'oggetto { post: ... }
            res.status(200).json({ post: generatedContent });
        }

    } catch (error) {
        console.error("Errore generico nell'API di Civora:", error);
        res.status(500).json({ errore: "La magia si è interrotta: " + error.message });
    }
}
