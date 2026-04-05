export default async function handler(req, res) {
  // CORS obbligatorio
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo non consentito' });
  }

  const { image, prompt } = req.body;
  const API_KEY = process.env.VERTEX_API_KEY; // Usiamo la stessa variabile

  // Nuovissimo endpoint Gemini 2.5 Flash Image tramite Google AI Studio (Generative Language)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${API_KEY}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: `Edit this image as follows: ${prompt}. Return ONLY the resulting image data.` },
            { inline_data: { mime_type: "image/png", data: image } }
          ]
        }]
      })
    });

    const data = await response.json();

    // Debug rapido se Google risponde male
    if (data.error) {
      return res.status(500).json({ error: 'Errore API Google', details: data.error });
    }

    // Estrazione immagine modificata (Gemini 2.5 restituisce i bytes nella risposta)
    const resultPart = data.candidates?.[0]?.content?.parts?.[0];

    if (resultPart && resultPart.inline_data) {
      return res.status(200).json({ 
        modifiedImage: resultPart.inline_data.data 
      });
    } else {
      return res.status(500).json({ error: 'Risposta inattesa dal modello', details: data });
    }

  } catch (error) {
    return res.status(500).json({ error: 'Errore Vercel: ' + error.message });
  }
}
