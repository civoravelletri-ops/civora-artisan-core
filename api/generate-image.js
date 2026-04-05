// /api/generate-image.js (Vercel Function)
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const { image, prompt } = req.body;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GOOGLE_API_KEY
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: "image/png",
                    data: image
                  }
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();

    // NOTA: Gemini spesso restituisce testo, non immagine modificata
    // Qui simuliamo output immagine (da adattare con Imagen API)

    res.status(200).json({
      image: image // placeholder (ritorna immagine originale)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
