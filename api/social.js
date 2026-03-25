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

    const { contesto } = req.body;
        const GROQ_API_KEY = process.env.GROQ_API_KEY;

        // FASE 1: PREPARAZIONE DATI E OCCHI
            const imagesToAnalyze = contesto.allImages && contesto.allImages.length > 0
                                    ? contesto.allImages.slice(0, 2)
                                    : (contesto.imageUrl ? [contesto.imageUrl] : []);

            // Calcolo Urgenza e Offerta
            const isLowStock = contesto.quantita > 0 && contesto.quantita <= 3;
            const hasDiscount = contesto.originalPrice && contesto.originalPrice > contesto.prezzo;
            const discountPercent = hasDiscount ? Math.round(((contesto.originalPrice - contesto.prezzo) / contesto.originalPrice) * 100) : 0;

            const systemPrompt = `Sei un Social Media Manager creativo e brillante. Scrivi post che emozionano e spingono all'acquisto immediato.

                REGOLA D'ORO:
                NON USARE MAI ETICHETTE come "Dettagli Visivi:", "Vantaggi:", "Prezzo:", "Offerta:".
                Il post deve essere un racconto FLUIDO, naturale e coinvolgente. Non deve sembrare una lista della spesa.

                LA TUA STRATEGIA DI SCRITTURA:
                1. ATTACCO: Inizia con una frase forte che catturi l'attenzione (usa le info del titolo).
                2. CORPO: Descrivi il prodotto basandoti su quello che VEDI nella foto, ma fallo con passione. Se vedi un fiocco, scrivi: "Guardate che splendore questo nastro verde che abbiamo scelto..." (parla in prima persona plurale come se fossi il negozio).
                3. URGENZA: Se ci sono pochi pezzi, inseriscilo nel discorso in modo naturale (es: "Correte, ne abbiamo solo 2 in boutique!").
                4. BENEFICI: Parla dei benefici (aria pulita, eleganza) integrandoli nel testo, non come elenco puntato noioso.
                5. CHIUSURA: Call to action con il link.

                REGOLE DI FORMATO:
                - Usa emoji per dare colore, ma non esagerare.
                - Usa paragrafi brevi per rendere il post leggibile.
                - Rispondi SOLO col testo del post. NO introduzioni, NO virgolette.`;

            const messageContent = [
                {
                    type: "text",
                    text: `Dati per il post:
                    - Negozio: "${contesto.store_name}"
                    - Prodotto: "${contesto.nome}"
                    - Prezzo Attuale: ${contesto.prezzo}€
                    ${hasDiscount ? `- PREZZO ORIGINALE: ${contesto.originalPrice}€ (SCONTO DEL ${discountPercent}%)` : ''}
                    - QUANTITÀ DISPONIBILE: ${contesto.quantita}
                    - Descrizione di Alessandro: "${contesto.descrizione}"
                    - LINK SHOP: ${contesto.link_shop}

                    ISTRUZIONI EXTRA:
                    ${isLowStock ? '!!! ATTENZIONE: La quantità è bassissima, crea un senso di urgenza nel post !!!' : ''}
                    Guarda la foto e integra i dettagli visivi con i dati di vendita sopra.
                    Inserisci il link alla fine con una frase d'invito.`
                }
            ];

            imagesToAnalyze.forEach(url => {
                messageContent.push({ type: "image_url", image_url: { url: url } });
            });

            try {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${GROQ_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: "meta-llama/llama-4-scout-17b-16e-instruct",
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: messageContent }
                        ],
                        temperature: 0.8,
                        max_tokens: 1200
                    })
                });
        const data = await response.json();

        if (data.error) {
            return res.status(500).json({ errore: "Errore da Groq: " + data.error.message });
        }

        const postGenerato = data.choices[0].message.content.trim();
        res.status(200).json({ post: postGenerato });

    } catch (error) {
        res.status(500).json({ errore: "La magia social si è interrotta: " + error.message });
    }
}
