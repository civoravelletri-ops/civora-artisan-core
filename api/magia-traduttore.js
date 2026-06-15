export default async function handler(req, res) {
    // Intestazioni CORS (permettono al tuo sito di comunicare con Vercel)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // Gestione della pre-richiesta OPTIONS
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { testo_italiano, contesto } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    // Lista aggiornata delle 10 lingue (per i fallback e il prompt)
    const I18N_LANGS = ["en", "es", "fr", "de", "ru", "ar", "ro", "zh", "sq", "hi"];

    if (!testo_italiano || testo_italiano.trim() === "") {
        // Se il testo è vuoto, restituisci un oggetto con tutte le lingue vuote
        const emptyTranslations = {};
        I18N_LANGS.forEach(lang => emptyTranslations[lang] = "");
        return res.status(200).json(emptyTranslations);
    }

    // Diciamo all'IA chi è e cosa deve fare. Le imponiamo di rispondere SOLO in formato JSON.
    const systemPrompt = `Sei un traduttore professionista ed esperto di marketing per attività commerciali locali, inclusi saloni di bellezza, studi medici e cliniche veterinarie.
        Il tuo compito è prendere il testo in italiano e tradurlo in 10 lingue.
        Mantieni un tono commerciale, persuasivo e naturale, adattandolo leggermente al contesto fornito (es. più empatico per un veterinario, più elegante per un salone).
        Se il testo è una lista di parole separate da virgola (tags), mantieni la separazione con le virgole.

        REGOLA DI FORMATTAZIONE JSON DI MASSIMA IMPORTANZA:
        - Devi restituire UNICAMENTE un oggetto JSON valido.
        - Non aggiungere MAI commenti, spiegazioni, saluti o testo fuori dal JSON.
        - Ogni valore del JSON deve essere una stringa pulita.
        - NON avvolgere le singole traduzioni in doppie virgolette interne (es. ""testo"" o \\"\\"testo\\"\\" è severamente vietato).
        - Se devi includere delle virgolette nella traduzione, usa le virgolette singole (es. 'testo') oppure esegui il corretto escape con una sola barra rovesciata (\\").
        - Assicurati che non ci siano virgolette spurie o ridondanti all'inizio o alla fine della stringa tradotta.

        L'oggetto JSON deve avere ESATTAMENTE queste 10 chiavi (ISO 639-1 per le lingue):
        "en" (Inglese)
        "es" (Spagnolo)
        "fr" (Francese)
        "de" (Tedesco)
        "ru" (Russo)
        "ar" (Arabo standard)
        "ro" (Rumeno)
        "zh" (Cinese semplificato)
        "sq" (Albanese)
        "hi" (Hindi)`;

    // Rimosse le virgolette fisiche dal prompt dell'utente attorno al testo per evitare di confondere il modello
    const userPromptContent = `Contesto del testo: ${contesto || "Generico"}

Testo in italiano da tradurre (traduci solo il contenuto puro, senza racchiuderlo in virgolette esterne extra):
${testo_italiano}`;

    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPromptContent }
                ],
                temperature: 0.2, // Ridotta leggermente per minimizzare i comportamenti di formattazione imprevisti
                response_format: { type: "json_object" } // FORZA Groq a sputare fuori un JSON perfetto
            })
        });

        const data = await response.json();

        if (data.error) {
            console.error("Errore da Groq API:", data.error);
            throw new Error(data.error.message);
        }

        if (!data.choices || data.choices.length === 0) {
            throw new Error("L'IA non ha restituito risultati validi.");
        }

        // Il testo restituito è già un JSON perfetto in formato stringa
        const jsonString = data.choices[0].message.content.trim();
        const traduzioni = JSON.parse(jsonString);

        // Inviamo il pacchetto di 10 lingue al sito
        res.status(200).json(traduzioni);

    } catch (error) {
        console.error("Errore magia-traduttore:", error);
        // In caso di errore critico, restituiamo il testo originale in italiano su tutte le lingue per non bloccare il salvataggio
        const fallbackTranslations = {};
        I18N_LANGS.forEach(lang => fallbackTranslations[lang] = testo_italiano);
        res.status(200).json(fallbackTranslations);
    }
}
