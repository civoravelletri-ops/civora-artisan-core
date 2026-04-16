// api/shopping-assistant.js

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { contesto } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    const systemPrompt = `Sei il Personal Shopper del banco "${contesto.store_name}" su Civora.
    REGOLE MANDATORIE PER IL JSON:
    1. Ogni prodotto ha un array 'variants'. DEVI scegliere l'ID di una variante esistente.
    2. La quantità 'qty' deve essere SEMPRE un numero INTERO (1, 2, 3...). MAI usare decimali come 0.4 o 0.5.
    3. Se il cliente vuole 400g di carne, cerca la variante da 400g (o quella più vicina) e scrivi qty: 1.
    4. I nomi dei campi nel JSON devono essere ESATTAMENTE: "productId", "variantId", "name", "qty", "price".
    5. Crea ESATTAMENTE 3 carrelli diversi.

    FORMATO JSON RICHIESTO:
    {
      "carrelli": [
        {
          "nome": "Titolo",
          "descrizione": "Spiegazione",
          "prodotti": [{ "productId": "ID", "variantId": "ID_VAR", "name": "Nome Prodotto", "qty": 1, "price": 10.50 }]
        }
      ]
    }`;

    const userPromptText = `RICHIESTA: "${contesto.richiestaUtente}" - LISTA PRODOTTI: ${JSON.stringify(contesto.prodotti)}`;

    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "meta-llama/llama-4-scout-17b-16e-instruct",
                messages: [
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
