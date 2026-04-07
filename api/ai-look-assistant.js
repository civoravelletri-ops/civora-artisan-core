// ai-look-assistant.js

export default async function handler(req, res) {
// Abilita i CORS per permettere alla tua dashboard di comunicare con Vercel
res.setHeader('Access-Control-Allow-Credentials', true);
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

if (req.method === 'OPTIONS') {
res.status(200).end();
return;
}

if (req.method !== 'POST') {
return res.status(405).json({ error: 'Method Not Allowed' });
}

try {
const { type, userPrompt, imageBase64, chatHistory, latestMessage, storeType } = req.body;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
throw new Error("GROQ_API_KEY mancante nelle variabili d'ambiente di Vercel");
}

const groqApiUrl = "https://api.groq.com/openai/v1/chat/completions";

let responseContent = "";
let groqModel = "meta-llama/llama-4-scout-17b-16e-instruct"; // CONFERMATO: Questo è il nostro modello multimodale potente
let messages = [];
let temperature = 0.7; // Default per creatività nella conversazione

// Funzione per formattare l'immagine per l'input multimodale di Groq
const formatImageForGroq = (base64) => {
if (!base64) return []; // Non dovrebbe succedere per consult_chat_initial e ora nemmeno per i successivi se inviata
return [{ type: "image_url", image_url: { url: base64 } }];
};

const getSystemPrompt = (purpose, currentStoreType = "") => {
// Se dobbiamo generare il prompt finale per l'AI grafica, usiamo istruzioni puramente tecniche
if (purpose === "consult_chat_final_prompt") {
return `Sei un traduttore tecnico per AI generative.
Basandoti sulla conversazione precedente e sulla foto, scrivi un unico prompt in inglese iper-realistico e dettagliato per fotoritocco.
REGOLA CRITICA: Restituisci esclusivamente il testo in inglese.
NON aggiungere "Ciao capo", NON aggiungere spiegazioni, NON aggiungere commenti.
Scrivi solo il prompt e basta.`;
}

// Per la chat normale, manteniamo lo stile "Ciao capo"
let basePrompt = `Sei l'assistente esperto di un ${currentStoreType}. Il tuo capo è il negoziante. `;

let conversationStyle = `
STILE DI CONVERSAZIONE:
- Saluta con "Ciao capo" solo all'inizio.
- Sii estremamente sintetico e professionale.
- Identifica subito cosa vedi nella foto (es: "Ho visto il viso").
- Dai consigli pratici e veloci.
- Parla sempre in italiano.
`;

if (purpose === "enhance_prompt") {
return `Compito: Migliora questo prompt per un'AI grafica. Scrivi solo il testo in inglese dettagliato. Niente saluti o introduzioni.`;
} else if (purpose === "consult_chat_initial") {
return basePrompt + conversationStyle + ` Compito: Saluta il capo, di' cosa vedi nella foto e chiedi se ci sono richieste o se vuoi un consiglio. Sii brevissimo.`;
} else if (purpose === "consult_chat_message") {
return basePrompt + conversationStyle + ` Compito: Rispondi alla richiesta con consigli tecnici veloci basati sulla foto.`;
}
return basePrompt + conversationStyle;
};


switch (type) {
case 'enhance_prompt':
groqModel = 'llama-3.1-8b-instant'; // Veloce e ottimo per il text-to-text
messages = [
{ role: 'system', content: getSystemPrompt("enhance_prompt", storeType) },
{ role: 'user', content: `Testo da migliorare: "${userPrompt}"` }
];
temperature = 0.5;
break;

case 'consult_chat_initial':
case 'consult_chat_message':
case 'consult_chat_final_prompt':
temperature = (type === 'consult_chat_final_prompt') ? 0.3 : 0.7;

let chatMessagesForGroq = [];

// Primo messaggio di sistema (con la persona dell'AI)
chatMessagesForGroq.push({
role: 'system',
content: getSystemPrompt(type, storeType)
});

// --- LOGICA OTTIMIZZATA PER RISPARMIO TOKEN ---
// Iniziamo con il messaggio iniziale dell'utente (che include l'immagine)
if (type === 'consult_chat_initial') {
if (!imageBase64) {
throw new Error("Errore: Immagine mancante.");
}
let initialContent = [
{ type: 'text', text: `Ciao! Guarda la foto. Dimmi subito: "Ciao capo, ho visto [parte del corpo]". Poi chiedimi se ho richieste particolari o se vuoi un consiglio per un look specifico (matrimonio, moderno, ecc.). Sii molto veloce e diretto.` },
...formatImageForGroq(imageBase64)
];
chatMessagesForGroq.push({ role: 'user', content: initialContent });

} else {
// Ricostruiamo la cronologia passata inviando SOLO il testo (risparmio enorme di token)
if (chatHistory && chatHistory.length > 0) {
for (const msg of chatHistory) {
chatMessagesForGroq.push({
role: msg.sender === 'user' ? 'user' : 'assistant',
content: msg.text
});
}
}

// Aggiungiamo l'immagine SOLO all'ultimo messaggio attuale, così l'AI "vede" ancora la foto
if (type === 'consult_chat_message') {
let latestContent = [{ type: 'text', text: latestMessage }];
if (imageBase64) {
latestContent.push(...formatImageForGroq(imageBase64));
}
chatMessagesForGroq.push({ role: 'user', content: latestContent });
} else if (type === 'consult_chat_final_prompt') {
let finalInstructionContent = [{
type: 'text',
text: `Basandoti sulla nostra conversazione e su questa foto, genera un prompt finale in inglese, iper-realistico e dettagliato per la generazione di immagini AI. Focalizzati solo sul look. Restituisci SOLO il prompt finale.`
}];
if (imageBase64) {
finalInstructionContent.push(...formatImageForGroq(imageBase64));
}
chatMessagesForGroq.push({ role: 'user', content: finalInstructionContent });
}
}
messages = chatMessagesForGroq;
break;

default:
return res.status(400).json({ error: 'Tipo di richiesta AI non valido.' });
}

const groqRequestBody = {
model: groqModel,
messages: messages,
temperature: temperature,
};

const groqResponse = await fetch(groqApiUrl, {
method: 'POST',
headers: {
'Authorization': `Bearer ${GROQ_API_KEY}`,
'Content-Type': 'application/json'
},
body: JSON.stringify(groqRequestBody)
});

const data = await groqResponse.json();

if (data.error) {
console.error("Errore da Groq:", data.error);
return res.status(500).json({ error: "Errore dall'AI: " + (data.error.message || JSON.stringify(data.error)) });
}

if (!data.choices || data.choices.length === 0) {
return res.status(500).json({ error: "L'AI non ha restituito risultati. Riprova." });
}

responseContent = data.choices[0].message.content.trim();

res.status(200).json({ result: responseContent });

} catch (error) {
console.error("Errore nella funzione Vercel ai-look-assistant:", error);
res.status(500).json({ error: error.message });
}
}
