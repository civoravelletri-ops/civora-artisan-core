// api/generate-image.js
import { GoogleAuth } from 'google-auth-library';
import fetch from 'node-fetch';

export default async function handler(req, res) {
  // CORS
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
  
  const PROJECT_ID = process.env.GOOGLE_PROJECT_ID; 
  const REGION = "us-central1"; 

  // --- AUTENTICAZIONE PURA VERTEX AI (SERVICE ACCOUNT) ---
  let authToken;
  try {
    const credentialsJson = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

    const auth = new GoogleAuth({
      credentials: credentialsJson,
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    authToken = accessToken.token;
  } catch (authError) {
    return res.status(500).json({ 
      debug_error: true, 
      message: 'Errore autenticazione Service Account.', 
      details: authError.message 
    });
  }

  // --- ENDPOINT UFFICIALE VERTEX AI (NO AI STUDIO) ---
  // Uso la versione V1 e il modello specifico imagegeneration@006 per evitare il 404
  const url = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/imagegeneration@006:predict`;

  try {
    const payload = {
      instances:[
        {
          prompt: prompt,
          image: { bytesBase64Encoded: image }
        }
      ],
      parameters: {
        sampleCount: 1
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`, 
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    // Se Vertex AI dà errore, te lo mostriamo esatto
    if (!response.ok) { 
        return res.status(response.status).json({ 
            debug_error: true, 
            message: `Errore Vertex AI: ${response.status}`, 
            google_response: data 
        });
    }

    if (data.predictions && data.predictions[0] && data.predictions[0].bytesBase64Encoded) {
      return res.status(200).json({ 
        modifiedImage: data.predictions[0].bytesBase64Encoded 
      });
    } else {
      return res.status(500).json({ 
        debug_error: true, 
        message: 'Vertex AI non ha restituito l\'immagine.', 
        google_response: data 
      });
    }

  } catch (error) {
    return res.status(500).json({ 
      debug_error: true, 
      message: 'Errore di rete Vercel', 
      details: error.message 
    });
  }
}
