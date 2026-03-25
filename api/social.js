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

            const systemPrompt = `Sei un Senior Social Media Copywriter specializzato in Luxury Retail e Marketing Emozionale. Scrivi post ad alto impatto visivo che mescolano eleganza e potenza commerciale.
            
                REGOLE DI FORMATTAZIONE E STILE:
                1. GANCIO VISIVO: Inizia sempre con un titolo in GRASSETTO (usa **) e icone forti che bloccano lo scrolling.
                2. IL TOCCO DELL'ARTISTA: Guarda l'immagine. Se noti nastri, colori o dettagli unici, descrivili con eleganza (es: "Il nastro verde salvia che abbiamo scelto esalta la purezza del bianco...").
                3. STRUTTURA SMART: Usa paragrafi netti. Usa i punti elenco (•) solo per i benefici reali, rendendoli eleganti.
                4. FOMO & URGENZA: Se la quantità è bassa (1-3 pezzi), scrivi in grassetto che è un'edizione limitata o che restano gli ultimi pezzi. Crea desiderio.
                5. CALL TO ACTION: Il link deve essere preceduto da una frase d'invito magnetica.
            
                REGOLE FONDAMENTALI:
                - USA IL GRASSETTO (**) per enfatizzare i concetti chiave, i prezzi e le offerte.
                - Il tono deve essere prestigioso, esperto, ma coinvolgente.
                - NON usare etichette banali (Prezzo:, Vantaggi:).
                - Integra le richieste extra del negoziante (es. San Valentino, Natale) nello stile d'alto livello della boutique.
                
                Rispondi SOLO con il testo finale pronto per Facebook e Instagram.`;
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
