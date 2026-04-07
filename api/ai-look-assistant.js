// Non è necessario importare GoogleGenerativeAI perché usiamo Groq per tutte le chiamate AI in questa funzione.

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
const GROQ_API_KEY = process.env.GROQ_API_KEY; // Usiamo Groq
// GOOGLE_API_KEY non è più necessaria qui, in quanto usiamo Groq per tutto.

if (!GROQ_API_KEY) {
throw new Error("GROQ_API_KEY mancante nelle variabili d'ambiente di Vercel");
}
if (!GROQ_API_KEY) {
throw new Error("GROQ_API_KEY mancante nelle variabili d'ambiente di Vercel");
}

const groqApiUrl = "https://api.groq.com/openai/v1/chat/completions";

let responseContent = "";
let groqModel = "";
let messages = [];
let temperature = 0.7; // Default

// Helper per la conversione Base64 in un formato accettabile per l'API (se Groq lo richiede)
// Per ora, Groq/Llama non gestisce direttamente image_url o base64 in chat come Gemini.
// Se Groq dovesse acquisire capacità multimodali, questa parte andrebbe rivista.
// Per il momento, se l'analisi immagine è richiesta, useremo un approccio che descrive l'immagine.
// Se Groq non gestisce multimodale nativamente nel modello scelto, dobbiamo usare una descrizione testuale dell'immagine o un modello Google/OpenAI.
// Dato che la tua funzione giudizio-civora usa meta-llama/llama-4-scout-17b-16e-instruct per la visione, assumeremo che questo modello Groq possa gestire l'input base64.
const formatImageForGroq = (base64) => {
if (!base64) return [];
// Groq's Llama models, if multimodals, expect something like:
// { type: "image_url", image_url: { url: base64_data_url } }
// Or often, the client describes the image for the LLM.
// Based on 'giudizio-civora', it expects 'image_url' with 'url'.
return [{ type: "image_url", image_url: { url: base64 } }];
};

const getSystemPrompt = (purpose, currentStoreType = "") => {
let basePrompt = "";
if (currentStoreType === "Parrucchiere (uomo/donna)" || currentStoreType === "Barbiere" || currentStoreType === "Salone di Bellezza (multi-servizio)") {
basePrompt = `Sei un esperto stilista di capelli e barba, e un consulente di bellezza. Il tuo compito è aiutare i clienti a definire il look perfetto. Sii creativo, professionale e chiaro.`;
} else if (currentStoreType === "Centro Estetico (trattamenti corpo/viso)" || currentStoreType === "Nail Bar / Centro Unghie") {
basePrompt = `Sei un esperto estetista e nail artist. Il tuo compito è consigliare i migliori trattamenti per viso, corpo, unghie e ciglia/sopracciglia. Sii attento ai dettagli, alla moda e al benessere.`;
} else if (currentStoreType === "Dentista") {
basePrompt = `Sei un consulente estetico dentale. Il tuo compito è guidare i clienti verso un sorriso perfetto e sano. Sii professionale, rassicurante e informativo.`;
} else if (currentStoreType === "Lash & Brow Specialist") {
basePrompt = `Sei un lash & brow specialist. Il tuo compito è consigliare le migliori soluzioni per ciglia e sopracciglia. Sii preciso, aggiornato sulle tendenze e focalizzato sull'estetica del viso.`;
} else if (currentStoreType === "Solarium & Centro Abbronzatura") {
basePrompt = `Sei un esperto di abbronzatura e cura della pelle. Il tuo compito è consigliare le migliori strategie per un'abbronzatura sana e uniforme. Sii informativo e attento alla salute della pelle.`;
} else if (currentStoreType === "Studio Tatuaggi & Piercing") {
basePrompt = `Sei un tatuatore e piercer esperto, e un consulente di stile. Il tuo compito è aiutare i clienti a scegliere e personalizzare tatuaggi e piercing. Sii creativo, attento alle tendenze e alla sicurezza.`;
} else {
basePrompt = `Sei un assistente AI di bellezza e benessere generico. Aiuta l'utente a migliorare il suo look o servizio richiesto.`;
}

if (purpose === "enhance_prompt") {
return basePrompt + ` Il tuo unico compito è prendere il testo fornito dall'utente e migliorarlo, espandendolo con dettagli realistici, specifici e utili per una generazione AI di immagini. Riscrivi il prompt in inglese, in modo chiaro e conciso, aggiungendo dettagli stilistici rilevanti per il settore (es. tipo di capelli, colore, forma, texture, tipo di pelle, ecc.). Non aggiungere frasi introduttive o conclusive, restituisci solo il prompt migliorato.`;
} else if (purpose === "consult_chat_initial" || purpose === "consult_chat_message" || purpose === "consult_chat_final_prompt") {
return basePrompt + ` Sei un assistente per la consulenza di look. Interagisci con l'utente come un vero professionista. Analizza attentamente le immagini fornite (se presenti) e le sue richieste. Chiedi informazioni aggiuntive se necessario per formulare un consiglio dettagliato e pertinente. Il tuo obiettivo è aiutare l'utente a creare un prompt perfetto per la generazione di immagini AI. Quando richiesto, genera un prompt finale in inglese, iper-realistico e estremamente dettagliato per Vertex AI.`;
}
return basePrompt;
};


switch (type) {
case 'enhance_prompt':
groqModel = 'llama-3.1-8b-instant';
messages = [
{ role: 'system', content: getSystemPrompt("enhance_prompt", storeType) },
{ role: 'user', content: `Testo da migliorare: "${userPrompt}"` }
];
temperature = 0.5; // Meno creativo, più focalizzato a migliorare l'input.
break;

case 'consult_chat_initial':
case 'consult_chat_message':
case 'consult_chat_final_prompt':
groqModel = 'meta-llama/llama-4-scout-17b-16e-instruct'; // Modello multimodale Groq (se supportato)
temperature = 0.7; // Più creativo per la chat

// Ricostruiamo la history includendo l'immagine se presente e valida
let chatMessagesForGroq = [{
role: 'system',
content: getSystemPrompt("consult_chat_initial", storeType)
}];

// Aggiungiamo l'immagine solo all'inizio o se è strettamente necessaria per contesti futuri
if (imageBase64) {
chatMessagesForGroq.push({
role: 'user',
content: [
{ type: 'text', text: `Ecco le immagini caricate dal cliente (${storeType}). Analizzale attentamente.` },
...formatImageForGroq(imageBase64)
]
});
// L'AI dovrebbe rispondere a questa prima parte, poi la chat prosegue
// Per la fase iniziale, l'intro AI sarà la sua prima risposta.
} else {
chatMessagesForGroq.push({
role: 'user',
content: `Il cliente ha iniziato una consulenza di look per la sua attività di ${storeType}. Non ha ancora fornito un'immagine.`
});
}

// Aggiungiamo la cronologia della chat
if (chatHistory && chatHistory.length > 0) {
chatHistory.forEach(msg => {
// Groq/OpenAI content can be string or array for multimodality
let content = msg.text;
// For multimodality, if image was part of a specific turn, we'd need to re-add it here.
// For simplicity in chat history, assuming text for past messages.
chatMessagesForGroq.push({ role: msg.sender === 'user' ? 'user' : 'assistant', content: content });
});
}

// Aggiungiamo il messaggio più recente dell'utente se è una conversazione in corso
if (type === 'consult_chat_message' && latestMessage) {
chatMessagesForGroq.push({ role: 'user', content: latestMessage });
}

if (type === 'consult_chat_final_prompt') {
chatMessagesForGroq.push({
role: 'user',
content: `Basandosi su tutta la nostra conversazione e sulle immagini (se fornite), genera un prompt finale in inglese, iper-realistico e dettagliato per la generazione di immagini AI. Focalizzati esclusivamente sull'aspetto del look (es. acconciatura, colore, stile unghie, tipo di barba, ecc.). NON includere saluti, introduzioni o conclusioni. Restituisci SOLO il prompt finale.`
});
temperature = 0.3; // Meno creativo, più preciso per il prompt finale
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
//response_format: { type: "json_object" } // Non sempre necessario, dipende dal prompt e dal modello
};

// Aggiungi response_format solo se esplicitamente richiesto o per output JSON specifici
// Ad esempio, per 'consult_chat_final_prompt' potresti non voler un JSON, ma solo una stringa
// Per 'visione_immagine' (come nel tuo esempio `Magia:` API) era richiesta `json_object`.
// Qui, per i prompt, vogliamo una stringa.
// Se Groq per il multimodale richiede content come array anche per output di testo,
// dobbiamo assicurarci che il system prompt lo gestisca correttamente.

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
