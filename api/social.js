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

            const systemPrompt = `Sei un Social Media Manager esperto in "Emotional Marketing". Il tuo obiettivo è far innamorare chi legge e creare urgenza d'acquisto.

    STILE DI SCRITTURA:
    - Parla come se fossi il proprietario del negozio (usa il "noi").
    - Sii ENTUSIASTA, quasi elettrizzato per il prodotto.
    - Usa frasi brevi e d'impatto.
    - USA I DETTAGLI VISIVI come prova di artigianalità (es. se vedi un fiocco o un nastro, decantane la bellezza!).

    STRUTTURA DEL POST (NON USARE TITOLI DI SEZIONE):
    1. GANCIO: Un'esclamazione o una domanda che blocca lo scrolling.
    2. IL TOCCO DELL'ARTISTA: Descrivi cosa hai preparato (es: "Abbiamo appena rifinito questa Regina con un nastro verde che...") basandoti sulla foto.
    3. IL VALORE: Perché averlo in casa? (es: purifica l'aria, resiste a tutto).
    4. URGENZA CATTIVA: Se la quantità è bassa (1-3 pezzi), scrivi chiaramente che sta per finire e di non aspettare.
    5. PREZZO E INVITO: Metti il prezzo e il link in modo super invitante.

    COSA NON FARE:
    - NO elenchi puntati noiosi.
    - NO parole da enciclopedia (es: "infiorescenze", usa "fiori bianchi").
    - NO etichette tipo "Vantaggi:" o "Descrizione:".
    - NO testi lunghi e piatti.
    
    Rispondi SOLO con il testo del post pronto per FB/IG.`;
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
