export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo non consentito' });
  }

  const { image, prompt, projectId } = req.body;
  const API_KEY = process.env.VERTEX_API_KEY;
  const REGION = "us-central1"; 

  // Endpoint per Gemini 2.5 Flash Image
  const url = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${REGION}/publishers/google/models/gemini-2.5-flash-image:predict?key=${API_KEY}`;

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

    if (data.predictions && data.predictions[0]) {
      return res.status(200).json({ 
        modifiedImage: data.predictions[0].bytesBase64Encoded 
      });
    } else {
      return res.status(500).json({ error: 'Errore da Vertex AI', details: data });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
