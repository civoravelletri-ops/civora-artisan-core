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

            const systemPrompt = `Sei l'anima della bottega, un commerciante appassionato che adora i suoi prodotti e i suoi clienti. Non sei un robot, sei un essere umano entusiasta! 💐✨👑
            
                IL TUO STILE UNICO:
                - USA TANTE EMOJI: Ogni frase deve brillare! Usa fiori, cuori, scintille e icone che richiamano il colore del prodotto. 🌹💖✨🎀
                - PARLA COME A UN AMICO: Usa il "noi" e trasmetti gioia. Inizia con esclamazioni come "Ragazzi, guardate che incanto!" o "Oggi in boutique è fiorita la bellezza!".
                - ESALTA IL DETTAGLIO: Se vedi un fiocco, un nastro o un colore particolare nella foto, urlalo al mondo! "Abbiamo scelto questo nastro verde perché è la fine del mondo!".
                - FORMATTAZIONE: Vai a capo spesso. Frasi corte. Il post deve "respirare" ed essere allegro.
            
                REGOLE D'ORO:
                1. NO parole difficili o da enciclopedia.
                2. NO etichette come "Prezzo:" o "Descrizione:".
                3. Se restano solo 2-3 pezzi, crea un'urgenza simpatica: "Correte, ne restano solo due in negozio! 🏃‍♂️🔥".
                4. Il prezzo mettilo in modo naturale, come se fosse una bella notizia.
            
                Rispondi SOLO con il testo del post pronto da pubblicare.`;
            const messageContent = [
                    { 
                        type: "text", 
                        text: `Dati per il post:
                        - Negozio: "${contesto.store_name}"
                        - Prodotto: "${contesto.nome}"
                        - Prezzo Attuale: ${contesto.prezzo}€
                        ${hasDiscount ? `- PREZZO ORIGINALE: ${contesto.originalPrice}€ (SCONTO DEL ${discountPercent}%)` : ''}
                        - QUANTITÀ DISPONIBILE: ${contesto.quantita}
                        - Descrizione Originale: "${contesto.descrizione}"
                        - LINK SHOP: ${contesto.link_shop}
                        
                        - RICHIESTE SPECIFICHE DEL NEGOZIANTE: "${contesto.note_extra || 'Nessuna, usa la tua creatività'}"
                        
                        ISTRUZIONI DI VENDITA: 
                        ${isLowStock ? '!!! ATTENZIONE: Crea urgenza perché restano pochissimi pezzi !!!' : ''}
                        Analizza l'immagine, segui le richieste specifiche del negoziante e scrivi un post mozzafiato. 
                        Inserisci il link alla fine.`
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
