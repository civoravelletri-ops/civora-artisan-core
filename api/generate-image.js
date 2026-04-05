export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { image, prompt } = req.body;
  const API_KEY = process.env.VERTEX_API_KEY;

  // PROVIAMO IL MODELLO 2.5 FLASH (Verifichi se il nome è esatto per AI Studio)
  const model = "gemini-2.5-flash-image"; 
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: `INSTRUCTION: Edit this image. Task: ${prompt}. Output only the new image data.` },
            { inline_data: { mime_type: "image/png", data: image } }
          ]
        }]
      })
    });

    const data = await response.json();

    // SE C'È UN ERRORE, LO MANDIAMO AL FRONTEND PER LEGGERLO
    if (data.error) {
      return res.status(200).json({ 
        debug_error: true, 
        message: data.error.message, 
        reason: data.error.status 
      });
    }

    const resultPart = data.candidates?.[0]?.content?.parts?.[0];

    if (resultPart && resultPart.inline_data) {
      return res.status(200).json({ modifiedImage: resultPart.inline_data.data });
    } else {
      // Se il modello risponde con testo invece di un'immagine
      return res.status(200).json({ 
        debug_error: true, 
        message: "Il modello ha risposto con testo, non con un'immagine. Risposta: " + (resultPart?.text || "Vuota")
      });
    }

  } catch (error) {
    return res.status(200).json({ debug_error: true, message: "Errore Vercel: " + error.message });
  }
}
