export default async function handler(req, res) {
  // Gestione CORS professionale
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
  const API_KEY = process.env.VERTEX_API_KEY;
  const PROJECT_ID = process.env.GOOGLE_PROJECT_ID;
  const REGION = "us-central1"; 

  // Usiamo l'endpoint v1beta che è più stabile per i nuovi progetti
  const url = `https://${REGION}-aiplatform.googleapis.com/v1beta/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/gemini-2.5-flash-image:predict?key=${API_KEY}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [
          {
            prompt: prompt,
            image: { bytesBase64Encoded: image }
          }
        ],
        parameters: {
          sampleCount: 1
        }
      })
    });

    const data = await response.json();

    // Se Google risponde con successo
    if (data.predictions && data.predictions[0]) {
      return res.status(200).json({ 
        modifiedImage: data.predictions[0].bytesBase64Encoded 
      });
    } else {
      // Se Google dà errore, lo riportiamo fedelmente per capire il problema
      return res.status(500).json({ 
        error: 'Errore specifico da Google Vertex AI', 
        details: data.error || data 
      });
    }
  } catch (error) {
    return res.status(500).json({ error: 'Errore di sistema Vercel: ' + error.message });
  }
}
