// api/shopping-assistant.js

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { contesto, action } = req.body;
        const GROQ_API_KEY = process.env.GROQ_API_KEY;
    
        if (!GROQ_API_KEY) {
            return res.status(500).json({ error: "API Key mancante sul server." });
        }
    
        // --- NUOVA LOGICA: IL BOTANICO DIGITALE ---
        if (action === 'botanico') {
            const systemPrompt = `Sei il Botanico Digitale, l'esperto assistente alle vendite del vivaio "${contesto.storeName || 'Vivaio'}" su Civora.
            Rispondi alla domanda del cliente in modo cortese, molto breve (max 3 frasi) e nella lingua: ${contesto.lang || 'it'}.
            
            IL TUO SCOPO PRINCIPALE: Consigliare i prodotti che hai in negozio. 
            Leggi attentamente questa lista dei tuoi prodotti: ${JSON.stringify(contesto.prodotti_semplificati)}
            
            Se la domanda del cliente riguarda qualcosa che puoi risolvere con uno dei tuoi prodotti, consiglialo nominandolo e dicendo il prezzo.
            
            DEVI RISPONDERE SOLO CON UN OGGETTO JSON VALIDO, con una singola chiave "risposta". Esempio:
            {"risposta": "Ciao! Per tagliare l'erba ti consiglio il nostro Tagliaerba Super a 150€. È ottimo per i giardini medi!"}`;
    
            const userPromptText = `DOMANDA DEL CLIENTE: "${contesto.query}"`;
    
            try {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: "mixtral-8x7b-32768", // Mixtral è molto più bravo a generare JSON pulito rispetto a Llama3 base
                        messages:[
                            { role: "system", content: systemPrompt },
                            { role: "user", content: [{ type: "text", text: userPromptText }] }
                        ],
                        temperature: 0.5,
                        response_format: { type: "json_object" }
                    })
                });
                
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(`Errore API Groq: ${errorData.error?.message || 'Sconosciuto'}`);
                }
    
                const data = await response.json();
                const aiContent = data.choices[0].message.content;
                
                let jsonResp;
                try {
                    jsonResp = JSON.parse(aiContent);
                } catch (parseError) {
                    console.error("Errore Parsing JSON Botanico. Risposta grezza:", aiContent);
                    // Fallback: se sbaglia il JSON, cerchiamo di estrarre comunque una risposta a forza
                    jsonResp = { risposta: "Ho trovato qualcosa per te, ma c'è stato un problema di formattazione. Chiedimi di nuovo in un altro modo!" };
                }
    
                return res.status(200).json(jsonResp);
    
            } catch (error) {
                console.error("Errore Generale Botanico:", error);
                return res.status(500).json({ error: error.message });
            }
    
        } 
        // --- VECCHIA LOGICA: CREAZIONE CARRELLI (Intatta) ---
        else {
            const systemPrompt = `Sei il Personal Shopper del banco "${contesto.store_name || 'Negozio'}" su Civora.
            Il tuo compito è creare ESATTAMENTE 3 carrelli diversi basati sulla richiesta del cliente.
            
            REGOLE:
            1. Ogni prodotto ha un array di 'varianti'.
            2. SCEGLI sempre una variante esistente dall'elenco.
            3. La quantità 'qty' deve essere SEMPRE un numero intero (1, 2, 3...).
    
            FORMATO JSON OBBLIGATORIO:
            {
              "carrelli":[
                {
                  "nome": "Spesa Essenziale",
                  "descrizione": "Il minimo indispensabile.",
                  "prodotti":[
                    { "productId": "ID", "variantId": "ID_VAR", "productName": "Nome", "qty": 1, "price": 10.50 }
                  ]
                }
              ]
            }`;
    
            const userPromptText = `RICHIESTA: "${contesto.richiestaUtente}" - PRODOTTI: ${JSON.stringify(contesto.prodotti)}`;
    
            try {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: "mixtral-8x7b-32768", // Usiamo Mixtral anche qui per coerenza e stabilità del JSON
                        messages:[
                            { role: "system", content: systemPrompt },
                            { role: "user", content: [{ type: "text", text: userPromptText }] }
                        ],
                        temperature: 0.5,
                        response_format: { type: "json_object" }
                    })
                });
                
                if (!response.ok) {
                     const errorData = await response.json();
                     throw new Error(`Errore API Groq: ${errorData.error?.message || 'Sconosciuto'}`);
                }
    
                const data = await response.json();
                
                let finalJson;
                try {
                    finalJson = JSON.parse(data.choices[0].message.content);
                } catch (e) {
                    throw new Error("L'Intelligenza Artificiale ha restituito un formato non valido.");
                }
                
                return res.status(200).json(finalJson);
            } catch (error) {
                console.error("Errore Personal Shopper:", error);
                return res.status(500).json({ errore: error.message });
            }
        }
    }
