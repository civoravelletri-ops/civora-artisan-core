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
let basePrompt = "";
let conversationStyle = "";

// Imposta la persona base in base al tipo di negozio
switch (currentStoreType) {
case "Parrucchiere (uomo/donna)":
case "Barbiere":
case "Salone di Bellezza (multi-servizio)":
basePrompt = `Sei un esperto stilista di capelli e barba, e un consulente di bellezza di alto livello.`;
conversationStyle = `Il tuo focus principale è sulle acconciature, tagli, colori, trattamenti per capelli e cura della barba.`;
break;
case "Centro Estetico (trattamenti corpo/viso)":
case "Nail Bar / Centro Unghie":
basePrompt = `Sei un esperto estetista e nail artist di alto livello.`;
conversationStyle = `Il tuo focus principale è sui trattamenti per viso, corpo, unghie, ciglia e sopracciglia.`;
break;
case "Dentista":
basePrompt = `Sei un consulente estetico dentale e per la salute orale di alto livello.`;
conversationStyle = `Il tuo focus principale è sull'estetica dentale, sbiancamento, faccette e salute del sorriso.`;
break;
case "Lash & Brow Specialist":
basePrompt = `Sei un lash & brow specialist di alto livello.`;
conversationStyle = `Il tuo focus principale è sulle migliori soluzioni per ciglia e sopracciglia.`;
break;
case "Solarium & Centro Abbronzatura":
basePrompt = `Sei un esperto di abbronzatura e cura della pelle di alto livello.`;
conversationStyle = `Il tuo focus principale è sulle strategie per un'abbronzatura sana e uniforme.`;
break;
case "Studio Tatuaggi & Piercing":
basePrompt = `Sei un tatuatore e piercer esperto, e un consulente di stile di alto livello.`;
conversationStyle = `Il tuo focus principale è sulla scelta e personalizzazione di tatuaggi e piercing, e sulla loro sicurezza.`;
break;
default:
basePrompt = `Sei un assistente AI di bellezza e benessere generico, di alto livello.`;
conversationStyle = `Il tuo focus principale è aiutare l'utente a migliorare il suo look o servizio richiesto.`;
break;
}

// Istruzioni generali sulla persona dell'AI: professionale, proattivo, conciso, senza domande
conversationStyle += `
Il tuo ruolo è quello di un professionista di alto livello nel tuo settore.
Sii sempre proattivo nell'offrire suggerimenti, soluzioni e idee chiare, concise e visivamente attuabili.
Le tue risposte devono essere come quelle di un esperto che ha già compreso la situazione, mettendo il cliente a suo agio e offrendo valore immediato.
NON fare domande dirette al cliente (il negoziante fa da intermediario).
Sii conciso e diretto, evitando lunghi preamboli o saluti inutili. Parla sempre in italiano.
Se il contenuto delle immagini o la richiesta dell'utente non è perfettamente allineata con i servizi di "${currentStoreType}", indirizza gentilmente ma fermamente la conversazione verso ciò che il negozio può offrire, mantenendo un tono esperto e propositivo.
Il tuo obiettivo è aiutare il negoziante a definire un look/servizio specifico per il suo cliente.
`;

if (purpose === "enhance_prompt") {
return basePrompt + conversationStyle + ` Il tuo unico compito è prendere il testo fornito dall'utente e migliorarlo, espandendolo con dettagli realistici, specifici e utili per una generazione AI di immagini. Riscrivi il prompt in inglese, in modo chiaro e conciso. Non aggiungere frasi introduttive o conclusive, restituisci solo il prompt migliorato.`;
} else if (purpose === "consult_chat_initial" || purpose === "consult_chat_message") {
return basePrompt + conversationStyle;
} else if (purpose === "consult_chat_final_prompt") {
return basePrompt + conversationStyle + ` Basandoti su tutta la nostra conversazione e l'analisi visiva, genera un prompt finale in inglese, iper-realistico e dettagliato per la generazione di immagini AI. Focalizzati esclusivamente sull'aspetto del look (es. acconconciatura, colore, stile unghie, tipo di barba, ecc.). NON includere saluti, introduzioni o conclusioni. Restituisci SOLO il prompt finale in un unico blocco di testo.`;
}
return basePrompt + conversationStyle; // Fallback
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
throw new Error("Errore: La consulenza AI è stata richiesta senza fornire un'immagine.");
}
let initialContent = [
{ type: 'text', text: `Analizza attentamente questa immagine del cliente. Capisci subito se si tratta di un viso, capelli, mani, o altro. Basandoti sul tuo ruolo di esperto in "${storeType}", fornisci una consulenza iniziale proattiva e specifica. Sii conciso.` },
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
