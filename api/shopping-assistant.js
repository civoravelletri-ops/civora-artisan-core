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
    
        // --- NUOVA LOGICA: IL BOTANICO DIGITALE ---
        if (action === 'botanico') {
            const systemPrompt = `Sei il Botanico Digitale e assistente alle vendite del vivaio "${contesto.storeName}" su Civora.
            Il tuo obiettivo è rispondere alle domande del cliente sul giardinaggio e CONSIGLIARE I PRODOTTI disponibili in negozio.
            
            REGOLE:
            1. Rispondi in modo amichevole, esperto ma conciso (max 3 frasi).
            2. Rispondi nella lingua richiesta: ${contesto.lang}.
            3. Se il cliente cerca qualcosa, guarda l'elenco dei prodotti disponibili e proponili menzionando il nome e il prezzo.
            
            LISTA PRODOTTI DISPONIBILI IN NEGOZIO ORA: 
            ${JSON.stringify(contesto.prodotti_semplificati)}
    
            FORMATO JSON OBBLIGATORIO PER LA RISPOSTA:
            {
              "risposta": "Testo della tua risposta amichevole e dei consigli qui."
            }`;
    
            const userPromptText = `DOMANDA DEL CLIENTE: "${contesto.query}"`;
    
            try {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: "llama3-70b-8192", // Modello Groq velocissimo e intelligente per le chat
                        messages:[
                            { role: "system", content: systemPrompt },
                            { role: "user", content: [{ type: "text", text: userPromptText }] }
                        ],
                        temperature: 0.6,
                        response_format: { type: "json_object" }
                    })
                });
                const data = await response.json();
                const jsonResp = JSON.parse(data.choices[0].message.content);
                res.status(200).json(jsonResp);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
    
        } 
        // --- VECCHIA LOGICA: CREAZIONE CARRELLI (Intatta) ---
        else {
            const systemPrompt = `Sei il Personal Shopper del banco "${contesto.store_name}" su Civora.
            Il tuo compito è creare ESATTAMENTE 3 carrelli diversi basati sulla richiesta del cliente (es. 1. Essenziale, 2. Completo, 3. Premium/Gourmet).
            
            REGOLE DI CIVORA PER LE QUANTITÀ:
            1. Ogni prodotto ha un array di 'varianti'.
            2. NON INVENTARE pesi o quantità decimali (es. 0.5).
            3. SCEGLI sempre una variante esistente dall'elenco 'varianti' di ogni prodotto.
            4. La quantità 'qty' deve essere SEMPRE un numero intero (1, 2, 3...). Indica quanti pezzi acquistare.
    
            FORMATO JSON OBBLIGATORIO (L'ARRAY 'carrelli' DEVE AVERE ESATTAMENTE 3 OGGETTI):
            {
              "carrelli":[
                {
                  "nome": "Spesa Essenziale",
                  "descrizione": "Il minimo indispensabile perfetto per la tua richiesta.",
                  "prodotti":[
                    { "productId": "ID", "variantId": "ID_VAR", "productName": "Nome", "qty": 1, "price": 10.50 }
                  ]
                }
              ]
            }`;
    
            const userPromptText = `RICHIESTA: "${contesto.richiestaUtente}" - LISTA PRODOTTI CON VARIANTI: ${JSON.stringify(contesto.prodotti)}`;
    
            try {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: "meta-llama/llama-4-scout-17b-16e-instruct",
                        messages:[
                            { role: "system", content: systemPrompt },
                            { role: "user", content: [{ type: "text", text: userPromptText }] }
                        ],
                        temperature: 0.7,
                        response_format: { type: "json_object" }
                    })
                });
                const data = await response.json();
                res.status(200).json(JSON.parse(data.choices[0].message.content));
            } catch (error) {
                res.status(500).json({ errore: error.message });
            }
        }
}
