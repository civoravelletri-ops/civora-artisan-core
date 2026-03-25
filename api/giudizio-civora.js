export default async function handler(req, res) {
    // Abilita i CORS per permettere alla tua dashboard di comunicare con Vercel
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
        const productData = req.body;
                const GROQ_API_KEY = process.env.GROQ_API_KEY;

                if (!GROQ_API_KEY) {
                    throw new Error("GROQ_API_KEY mancante nelle variabili d'ambiente di Vercel");
                }

                // FASE 1: GLI OCCHI (Analisi dell'immagine e delle varianti)
                        let visualAnalysis = "Nessuna immagine disponibile.";

                        // Prepariamo i contenuti per l'IA Vision (max 3 immagini per non rallentare troppo)
                        const imagesToAnalyze = productData.allImages && productData.allImages.length > 0
                                                ? productData.allImages.slice(0, 3)
                                                : (productData.imageUrl ? [productData.imageUrl] : []);

                        if (imagesToAnalyze.length > 0) {
                            try {
                                const visionContent = [
                                    { type: 'text', text: "Analizza queste immagini del prodotto (possono essere varianti dello stesso oggetto). Dimmi cosa vedi: colori, materiali, freschezza. Se vedi che è un'opera artigianale o un bouquet, enfatizza la composizione manuale. Se vedi varianti di colore, segnalalo. Questo mi serve per capire se è un pezzo unico o industriale." }
                                ];

                                // Aggiungiamo ogni immagine al messaggio per l'IA
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
                                        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                                        messages: [{ role: 'user', content: visionContent }],
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

                // FASE 2: IL GIUDIZIO DEL CONCIERGE (Il Cervello)
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
                    "pros": ["Vantaggio 1", "Vantaggio 2"],
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
                        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                        response_format: { type: "json_object" },
                        messages: [
                            { role: 'system', content: promptSystem },
                            { role: 'user', content: promptUser }
                        ],
                        temperature: 0.7,
                    })
                });

                if (!groqResponse.ok) {
                    const err = await groqResponse.text();
                    throw new Error(`Errore da Groq: ${err}`);
                }

                const data = await groqResponse.json();
                const aiJudgmentJSON = JSON.parse(data.choices[0].message.content);

                res.status(200).json(aiJudgmentJSON);

    } catch (error) {
        console.error("Errore nella generazione del giudizio Civora:", error);
        res.status(500).json({ error: error.message });
    }
}
