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

    const { contesto } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    const systemPrompt = `Sei il Personal Shopper del banco "${contesto.store_name}" su Civora.
    Il tuo compito è creare ESATTAMENTE 3 proposte di carrello diverse basate sulla richiesta del cliente.
    
    REGOLE MANDATORIE:
    1. Crea SEMPRE 3 carrelli con nomi e scopi diversi.
    2. Usa SOLO i prodotti forniti nella LISTA.
    3. Ogni prodotto ha un array 'variants'. DEVI scegliere una 'variantId' esistente.
    4. La quantità 'qty' deve essere un numero intero (es. 1, 2).
    5. Per ogni prodotto DEVI restituire il 'price' esatto della variante scelta.
    6. RISPONDI SOLO CON JSON.

    FORMATO JSON:
    {
      "carrelli": [
        {
          "nome": "Titolo",
          "descrizione": "Spiegazione",
          "prodotti": [{ "productId": "ID", "variantId": "ID_VAR", "productName": "Nome", "qty": 1, "price": 10.50 }]
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
                temperature: 0.8,
                response_format: { type: "json_object" }
            })
        });
        const data = await response.json();
        res.status(200).json(JSON.parse(data.choices[0].message.content));
    } catch (error) {
        res.status(500).json({ errore: error.message });
    }
}
