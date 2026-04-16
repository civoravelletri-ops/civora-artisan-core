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

    const systemPrompt = `Sei il Personal Shopper esperto di "${contesto.store_name}" su Civora.
    Il tuo compito è creare 3 proposte di carrello basate sulla richiesta del cliente.
    
    REGOLE MANDATORIE PER L'INTEGRITÀ DEL SISTEMA:
    1. Ogni prodotto fornito ha un array di 'variants'. Tu DEVI SCEGLIERE UNA variante esistente.
    2. NON inventare pesi o quantità decimali (es. NO 0.5). Scegli la variante che più si avvicina al bisogno (es. se serve mezzo chilo e c'è la variante da 500g, prendi quella).
    3. Il campo 'qty' deve essere un numero INTERO (1, 2, 3...). Rappresenta quanti pezzi di quella specifica variante acquistare.
    4. Restituisci il 'variantId' esatto della variante che hai scelto.
    5. Restituisci SOLO il JSON.

    FORMATO JSON RICHIESTO:
    {
      "carrelli": [
        {
          "nome": "Titolo Carrello",
          "descrizione": "Spiegazione",
          "prodotti": [
            { 
              "id": "ID_PRODOTTO", 
              "variantId": "ID_VARIANTE_SCELTA", 
              "qty": 1, 
              "nome": "Nome Prodotto",
              "dettaglio_variante": "es. 500g" 
            }
          ]
        }
      ]
    }`;

    const userPromptText = `RICHIESTA: "${contesto.richiestaUtente}"
    PRODOTTI DISPONIBILI CON VARIANTI:
    ${JSON.stringify(contesto.prodotti)}`;

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
                temperature: 0.4, // Abbassato per massima precisione
                response_format: { type: "json_object" }
            })
        });
        const data = await response.json();
        res.status(200).json(JSON.parse(data.choices[0].message.content));
    } catch (error) {
        res.status(500).json({ errore: error.message });
    }
}
