// api/generate-image.js
import fetch from 'node-fetch'; // Per compatibilità Vercel

export default async function handler(req, res) {
  // CORS (Access-Control-Allow-...)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE,PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end(); 
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo non consentito' });
  }

  const { image, prompt } = req.body;
  
  // Recupera la NUOVA API KEY da Vercel (la stessa variabile usata prima)
  const API_KEY = process.env.GOOGLE_AI_STUDIO_API_KEY; // Nota: nome variabile cambiato per chiarezza

  if (!API_KEY) {
      return res.status(500).json({ debug_error: true, message: "Variabile GOOGLE_AI_STUDIO_API_KEY mancante su Vercel." });
  }

  // Endpoint per Gemini 1.5 Flash (API Generative Language)
  // Questo modello supporta input immagine e output testo/immagine
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

  try {
    const payload = {
      contents: [{
        parts: [
          // Istruzioni più precise per l'editing
          { text: `Modify this image based on the following instruction. Focus on direct visual changes. Output ONLY the resulting image data in base64. If you cannot make the visual change, state so clearly in text. Instruction: ${prompt}` },
          { inline_data: { mime_type: "image/png", data: image } }
        ]
      }]
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) { 
        console.error('Errore HTTP da Google:', data);
        return res.status(response.status).json({ 
            debug_error: true, 
            message: `Errore HTTP da Google: ${response.status}`, 
            google_response: data.error?.message || JSON.stringify(data) 
        });
    }
    
    // Controlla il formato della risposta per l'immagine
    const resultPart = data.candidates?.[0]?.content?.parts?.[0];

    if (resultPart && resultPart.inline_data && resultPart.inline_data.data) {
      return res.status(200).json({ 
        modifiedImage: resultPart.inline_data.data 
      });
    } else if (resultPart && resultPart.text) {
        // Se Google ha risposto con testo (es. non può fare la modifica)
        return res.status(200).json({ 
            debug_error: true, 
            message: "Il modello ha risposto con testo, non un'immagine. Potrebbe non essere riuscito a fare la modifica.", 
            google_response: resultPart.text 
        });
    }
    else {
      console.error('Risposta inattesa da Google (no immagine):', data);
      return res.status(500).json({ 
        debug_error: true, 
        message: 'Google ha restituito un formato di risposta inatteso.', 
        google_response: JSON.stringify(data) 
      });
    }

  } catch (error) {
    console.error('Errore di rete o chiamata fetch:', error);
    return res.status(500).json({ 
      debug_error: true, 
      message: 'Errore di sistema Vercel o di rete: ' + error.message, 
      details: error.stack 
    });
  }
}
