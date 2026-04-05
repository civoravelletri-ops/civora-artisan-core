// api/generate-image.js
import { GoogleAuth } from 'google-auth-library';
import fetch from 'node-fetch'; // Necessario per Vercel con Node 20

export default async function handler(req, res) {
  // Configurazione CORS (Access-Control-Allow-...)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE,PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end(); // Risposta immediata per il preflight CORS
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo non consentito' });
  }

  const { image, prompt } = req.body;
  
  // Recupero variabili d'ambiente da Vercel
  const PROJECT_ID = process.env.GOOGLE_PROJECT_ID; // Es. civora-ai-editor
  const REGION = "us-central1"; // La regione dove hai abilitato Vertex AI

  if (!PROJECT_ID) {
      return res.status(500).json({ debug_error: true, message: "Variabile GOOGLE_PROJECT_ID mancante su Vercel." });
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      return res.status(500).json({ debug_error: true, message: "Variabile GOOGLE_APPLICATION_CREDENTIALS_JSON mancante su Vercel." });
  }

  // --- AUTENTICAZIONE CORRETTA CON GOOGLE CLOUD VIA SERVICE ACCOUNT JSON ---
  let authToken;
  try {
    const credentialsJson = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

    const auth = new GoogleAuth({
      credentials: credentialsJson, // Passa direttamente l'oggetto JSON della chiave
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    authToken = accessToken.token;
    if (!authToken) throw new Error('Auth token non generato da GoogleAuth.');
  } catch (authError) {
    console.error('Errore di autenticazione:', authError.message, authError.stack);
    return res.status(500).json({ 
      debug_error: true, 
      message: 'Errore autenticazione Google Cloud. Controlla il JSON del Service Account su Vercel. Dettagli: ' + authError.message, 
      details: authError.stack 
    });
  }
  // --- FINE AUTENTICAZIONE ---

  // Endpoint per Imagen 2 (Image Editing) su Vertex AI
  // Questo è l'endpoint corretto e documentato per la manipolazione di immagini esistenti
  const url = `https://${REGION}-aiplatform.googleapis.com/v1beta1/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/imagegeneration:predict`;

  try {
    const payload = {
      instances: [
        {
          prompt: prompt, // Il prompt di modifica testuale
          image: { bytesBase64Encoded: image } // L'immagine originale in Base64
        }
      ],
      parameters: {
        sampleCount: 1, // Numero di immagini generate
        sampleImageSize: "1024", // Dimensioni dell'output (es. "512", "1024")
        mime_type: "image/png", // Tipo di immagine in output
        seed: 42 // Opzionale: per risultati riproducibili
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`, // Autenticazione con il token generato
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    // Controlla se la risposta HTTP di Google è un errore
    if (!response.ok) { 
        console.error('Errore HTTP da Google:', data);
        return res.status(response.status).json({ 
            debug_error: true, 
            message: `Errore HTTP da Google: ${response.status}`, 
            google_response: data.error?.message || JSON.stringify(data) // Invia l'errore specifico
        });
    }

    // Controlla se la risposta contiene l'immagine modificata
    if (data.predictions && data.predictions[0] && data.predictions[0].bytesBase64Encoded) {
      return res.status(200).json({ 
        modifiedImage: data.predictions[0].bytesBase64Encoded 
      });
    } else {
      console.error('Risposta inattesa da Google (no immagine):', data);
      return res.status(500).json({ 
        debug_error: true, 
        message: 'Google non ha restituito un\'immagine o formato inatteso. La risposta completa è nei dettagli.', 
        google_response: JSON.stringify(data) // Invia la risposta completa di Google per debug
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
