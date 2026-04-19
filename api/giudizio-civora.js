export default async function handler(req, res) {
    // Abilita i CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const payload = req.body;
        const GROQ_API_KEY = process.env.GROQ_API_KEY;

        if (!GROQ_API_KEY) {
            throw new Error("GROQ_API_KEY mancante nelle variabili d'ambiente di Vercel");
        }

        const AI_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

        // --- SISTEMA DI SMISTAMENTO (ROUTER CHE RISPETTA LA TUA PRIORITÀ) ---
        // La tua funzione originale è la priorità (se non c'è una "action" specifica)
        const action = payload.action || 'giudizio';

        // =====================================================================================
        // AZIONE 1 (PRIORITÀ): IL GIUDIZIO DEL CONCIERGE (IL TUO CODICE ORIGINALE)
        // =====================================================================================
        if (action === 'giudizio') {
            const productData = payload;

            let visualAnalysis = "Nessuna immagine disponibile.";
            const imagesToAnalyze = productData.allImages && productData.allImages.length > 0
                                    ? productData.allImages.slice(0, 3)
                                    : (productData.imageUrl ? [productData.imageUrl] :[]);

            if (imagesToAnalyze.length > 0) {
                try {
                    const visionContent =[
                        { type: 'text', text: "Analizza queste immagini del prodotto (possono essere varianti dello stesso oggetto). Dimmi cosa vedi: colori, materiali, freschezza. Se vedi che è un'opera artigianale o un bouquet, enfatizza la composizione manuale. Se vedi varianti di colore, segnalalo. Questo mi serve per capire se è un pezzo unico o industriale." }
                    ];

                    imagesToAnalyze.forEach(url => {
                        visionContent.push({ type: 'image_url', image_url: { url: url } });
                    });

                    const visionResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${GROQ_API_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: AI_MODEL,
                            messages:[{ role: 'user', content: visionContent }],
                            temperature: 0.2
                        })
                    });
                    const visionData = await visionResponse.json();
                    visualAnalysis = visionData.choices[0]?.message?.content || "Analisi visiva non riuscita.";
                } catch (vErr) {
                    console.error("Errore visione:", vErr);
                    visualAnalysis = "Errore durante l'analisi visiva.";
                }
            }

            const promptSystem = `Sei un "Concierge" esperto, un personal shopper imparziale e onesto.
            REGOLE FONDAMENTALI:
            1. Se l'analisi visiva o i dati indicano un prodotto ARTIGIANALE (fiori, artigianato, cibo), non cercare il Brand. Valuta l'unicità, la freschezza e l'estetica del pezzo unico.
            2. Se è un prodotto INDUSTRIALE, valuta marca e specifiche tecniche.
            3. Sii super onesto: evidenzia pregi e difetti reali (es: stagionalità per i fiori, o vestibilità per abiti).
            4. Il tono deve essere quello di un esperto che ha visto il prodotto e lo commenta per un amico.
            5. Ricorda al cliente che acquistando tramite questo negozio fisico locale ha garanzia di originalità, scontrino e assistenza umana reale.
            6. DEVI RISPONDERE SOLO CON UN OGGETTO JSON VALIDO.

            Formato JSON:
            {
                "summary": "Breve riassunto emozionale e onesto...",
                "pros":["Vantaggio 1", "Vantaggio 2"],
                "cons": ["Svantaggio reale 1"]
            }`;

            const promptUser = `Dati del prodotto:
            - Nome: ${productData.productName}
            - Categoria: ${productData.productCategory}
            - Marca: ${productData.brand || 'Artigianale/Non specificata'}
            - Prezzo: €${productData.price}
            - Descrizione Negoziante: ${productData.shortDescription || productData.productDescription}
            - COSA VEDI NELL'IMMAGINE: ${visualAnalysis}`;

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: AI_MODEL,
                    response_format: { type: "json_object" },
                    messages:[
                        { role: 'system', content: promptSystem },
                        { role: 'user', content: promptUser }
                    ],
                    temperature: 0.7,
                })
            });

            if (!groqResponse.ok) throw new Error(`Errore da Groq: ${await groqResponse.text()}`);

            const data = await groqResponse.json();
            const aiJudgmentJSON = JSON.parse(data.choices[0].message.content);

            return res.status(200).json(aiJudgmentJSON);
        }

        // =====================================================================================
        // AZIONE 2: FORMATTAZIONE REGOLE NEGOZIANTE (IL NUOVO BINARIO 3)
        // =====================================================================================
        else if (action === 'formatta_regole_ai') {
            const promptSystem = `Sei un assistente per negozianti. Il tuo compito è prendere un testo scritto dal negoziante (spesso confuso o in dialetto) che spiega come lui calcola i prezzi dei suoi servizi, e trasformarlo in un elenco puntato HTML chiaro, sintetico e professionale in italiano.
            Regole:
            1. Usa SOLO i tag HTML <ul> e <li>. Nessun altro tag, nessun titolo, nessuna introduzione.
            2. Evidenzia bene se i prezzi sono fissi, al metro, all'ora o extra.
            3. Non inventare prezzi, usa solo quelli forniti.`;

            const promptUser = `Testo del negoziante:\n${payload.testo_grezzo}`;

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: AI_MODEL,
                    messages:[
                        { role: 'system', content: promptSystem },
                        { role: 'user', content: promptUser }
                    ],
                    temperature: 0.3,
                })
            });

            if (!groqResponse.ok) throw new Error(`Errore Groq: ${await groqResponse.text()}`);

            const data = await groqResponse.json();
            const regolePuliteHTML = data.choices[0].message.content;

            return res.status(200).json({ risultato: regolePuliteHTML });
                    }
            
                    // =====================================================================================
                    // AZIONE 3: CHAT AI CONCIERGE (VENDITA E PREVENTIVI REAL-TIME)
                    // =====================================================================================
                    else if (action === 'ai_concierge_chat') {
                        const { userMessage, serviceName, vendorName, rawInstructions, serviceDescription } = payload;
            
                        const promptSystem = `Sei l'AI Concierge di Civora, un assistente esperto e cordiale che lavora per il negozio "${vendorName}".
                        Il tuo compito è aiutare il cliente per il servizio: "${serviceName}".
            
                        MANUALE SEGRETO DEL NEGOZIANTE (Segui queste regole per i prezzi):
                        ${rawInstructions}
            
                        DESCRIZIONE DEL SERVIZIO:
                        ${serviceDescription}
            
                        REGOLE DI COMPORTAMENTO:
                        1. Sii professionale, accogliente e risolutivo.
                        2. Usa le informazioni nel "Manuale Segreto" per calcolare prezzi o spiegare come funzionano le varianti.
                        3. Se il cliente fa una richiesta e nel manuale mancano dati per calcolare il prezzo (es. mancano le misure o il tipo di materiale), chiediglieli gentilmente.
                        4. Se riesci a fare un calcolo basandoti sulle regole, mostralo chiaramente (es. "Il totale sarebbe di 50€, calcolato come...").
                        5. Mantieni le risposte brevi, umane e formattate bene (usa il grassetto per i prezzi).
                        6. Non inventare mai regole che non sono scritte nel manuale. Se non sai qualcosa, invita il cliente a lasciare i dettagli in chat per essere ricontattato dal titolare.
                        7. Parla in italiano corretto, anche se il manuale del negoziante è scritto in dialetto.`;
            
                        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${GROQ_API_KEY}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                model: AI_MODEL,
                                messages: [
                                    { role: 'system', content: promptSystem },
                                    { role: 'user', content: userMessage }
                                ],
                                temperature: 0.6, // Leggera creatività per essere empatico, ma preciso
                            })
                        });
            
                        if (!groqResponse.ok) throw new Error(`Errore Groq: ${await groqResponse.text()}`);
                        
                        const data = await groqResponse.json();
                        const rispostaAI = data.choices[0].message.content;
            
                        return res.status(200).json({ risultato: rispostaAI });
                    }
            
                    // Se l'azione non è riconosciuta
                    else {
                        return res.status(400).json({ error: 'Azione non riconosciuta' });
                    }

    } catch (error) {
        console.error("Errore nel Router Civora:", error);
        res.status(500).json({ error: error.message });
    }
}
