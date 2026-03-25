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

           const systemPrompt = `Sei un Senior Social Media Copywriter da Agenzia di Marketing di Lusso. Il tuo compito è creare post ad ALTO IMPATTO, con una formattazione impeccabile e un tono magnetico.

               REGOLE DI STRUTTURA E FORMATTAZIONE (FONDAMENTALI):
               1. TITOLO POTENTE: Inizia sempre con un titolo in **GRASSETTO MAIUSCOLO** tra due emoji forti. Deve "bucare" lo schermo.
               2. STORYTELLING VISIVO: Guarda la foto. Descrivi con eleganza i dettagli artigianali (es: "Il nastro di raso verde che avvolge questa creazione...") integrandoli nel racconto.
               3. ELENCHI PUNTATI ELEGANTI: Usa i punti elenco (•) o emoji specifiche per elencare i punti di forza del prodotto. Deve essere leggibile e ordinato.
               4. GRASSETTI STRATEGICI: Usa il doppio asterisco ** per evidenziare prezzi, offerte, nomi di prodotti e l'urgenza.
               5. MARKETING DELLA SCARSITÀ: Se restano 1-3 pezzi, scrivi un paragrafo dedicato in grassetto che crei il desiderio immediato (FOMO).

               TONO E LINGUAGGIO:
               - Professionale, esperto, ma profondamente coinvolgente (usa il "noi").
               - MAI usare etichette banali come "Prezzo:" o "Vantaggi:".
               - Mescola i dati tecnici alla poesia dell'artigianato.
               - Se ci sono note extra del negoziante (es. San Valentino), falle diventare il cuore del post con uno stile impeccabile.

               Rispondi SOLO con il testo finale, formattato perfettamente, pronto per essere copiato e incollato.`;
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
