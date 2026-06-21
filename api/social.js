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

// --- SELEZIONE AUTOMATICA DELLE ISTRUZIONI (SOCIAL vs ESPERTO vs PRENOTAZIONI) ---
let systemPrompt = "";
let userPromptText = "";

// Nuova logica: se arriva la richiesta speciale di importazione appuntamento
if (contesto.isBookingImport === true) {

systemPrompt = `Sei un assistente di reception virtuale per un salone di bellezza o cura della persona.
Il tuo compito è leggere un messaggio di richiesta appuntamento (scritto anche in dialetto, slang o con errori), la data odierna di riferimento e l'elenco dei servizi realmente offerti dal negozio.
Devi estrarre i dati della prenotazione e restituirli RIGIDAMENTE nel seguente formato JSON (non aggiungere testo prima o dopo, non usare spiegazioni, rispondi SOLO ed ESCLUSIVAMENTE con l'oggetto JSON):

{
"customerName": "Nome del cliente estratto (solo il nome di battesimo, prima lettera maiuscola)",
"date": "Data dell'appuntamento calcolata in formato YYYY-MM-DD",
"time": "Orario dell'appuntamento in formato HH:MM (se il cliente indica un orario generico es. 'pomeriggio', approssima all'orario intero più probabile, es. 16:00 o 17:00)",
"serviceId": "L'ID del servizio che corrisponde di più tra quelli presenti nel listino fornito. Cerca associazioni logiche anche per sinonimi o slang (es: 'baffo' o 'sfumatura' -> ID del servizio barba o taglio, 'colore' o 'tinta' -> ID del servizio colore). Se non trovi nessuna corrispondenza plausibile, lascia vuoto."
}

Contesto temporale: la data di oggi è ${contesto.todayDate}.
Listino dei servizi offerti dal salone: ${JSON.stringify(contesto.servicesList)}`;

userPromptText = `Estrai i dati da questo messaggio del cliente: "${contesto.rawMessage}"`;

} else if (contesto.isAIAssistant || contesto.nota_extra?.includes("Agisci come un esperto")) {
// Se nel pacchetto c'è una domanda del cliente, diventiamo l'Esperto del Banco
systemPrompt = `Sei l'Assistente Esperto di un banco del Mercato Fresco di Civora.
Il tuo obiettivo è consigliare il cliente, rispondere ai suoi dubbi e aiutarlo a usare al meglio il prodotto.

REGOLE DI COMPORTAMENTO:
1. TONO: Amichevole, caloroso e professionale (come il macellaio o il fruttivendolo di fiducia). Usa il "tu".
2. COMPETENZA: Dai consigli pratici su come cucinare il prodotto, come conservarlo e con cosa abbinarlo (vini, contorni).
3. STORYTELLING: Esalta la provenienza e la freschezza citando i dati forniti.
4. VENDITA GENTILE: Incoraggia l'acquisto sottolineando la qualità, senza essere insolito.
5. FORMATTAZIONE: Usa i **grassetti** per le cose importanti e le emoji per rendere la lettura piacevole.

Rispondi in modo conciso ma esaustivo.`;

userPromptText = `Un cliente ti chiede informazioni su questo prodotto:
- Nome: "${contesto.nome}"
- Categoria: "${contesto.categoria || contesto.categoryGroup}"
- Provenienza: "${contesto.provenienza || 'Italia'}"
- Descrizione del Venditore: "${contesto.descrizione}"
- Dettagli Tecnici: "${contesto.specifiche || ''}"

DOMANDA DEL CLIENTE: "${contesto.nota_extra}"`;

} else {
// ALTRIMENTI: Restiamo il Senior Copywriter per i post social
systemPrompt = `Sei un Senior Social Media Copywriter da Agenzia di Marketing di Lusso. Il tuo compito è creare post ad ALTO IMPATTO magnetici.
REGOLE: Inizia con un TITOLO IN GRASSETTO MAIUSCOLO tra emoji. Usa elenchi puntati eleganti. Usa i grassetti per prezzi e urgenza. Usa i grassetti per le parole chiave principali. Aggiungi hashtag pertinenti. Concludi con una Call to Action (es. Clicca sul link in bio per ordinare!).
Ricorda: l'obiettivo è vendere e convertire.`;

userPromptText = `Dati per il post social:
- Negozio: "${contesto.store_name}"
- Prodotto: "${contesto.nome}"
- Prezzo: ${contesto.prezzo}€ ${hasDiscount ? `(Sconto del ${discountPercent}%)` : ''}
- Quantità: ${contesto.quantita}
- Descrizione: "${contesto.descrizione}"
- Note Extra: "${contesto.note_extra || 'Creatività libera'}"
- Link

${isLowStock ? '!!! CREA URGENZA: SCORTE QUASI FINITE !!!' : ''}`;
}



const messageContent = [
{ type: "text", text: userPromptText }
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

// Se la chiamata è di importazione prenotazione, puliamo e restituiamo l'oggetto JSON
if (contesto.isBookingImport === true) {
try {
// Elimina eventuali tag di formattazione markdown che alcuni LLM inseriscono (es: json ...)
const cleanJsonString = postGenerato.replace(/json/g, "").replace(//g, "").trim();
const parsedBookingData = JSON.parse(cleanJsonString);
return res.status(200).json({ bookingData: parsedBookingData });
} catch (jsonErr) {
console.error("Errore durante il parsing del JSON generato da Llama:", jsonErr);
// Se per errore l'IA restituisce del testo normale, lo inviamo come testo grezzo per non bloccare il client
return res.status(200).json({ rawText: postGenerato });
}
}

res.status(200).json({ post: postGenerato });

} catch (error) {
res.status(500).json({ errore: "La magia si è interrotta: " + error.message });
}
}
