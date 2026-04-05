// api/generate-image.js - Vercel Serverless Function (DEFINITIVA con google-auth-library)
const { GoogleAuth } = require('google-auth-library');

export const config = {
  runtime: 'nodejs',
  maxDuration: 60
};

// Helper CORS
function setCorsHeaders(res, origin = '*') {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// Helper: ottiene access token con google-auth-library
async function getAccessToken() {
  try {
    const credentialsRaw = process.env.GOOGLE_SERVICE_ACCOUNT;
    if (!credentialsRaw) throw new Error('GOOGLE_SERVICE_ACCOUNT non impostata');
    
    // Parse del JSON
    let credentials;
    try {
      credentials = JSON.parse(credentialsRaw.trim());
    } catch (parseErr) {
      throw new Error(`JSON parsing error: ${parseErr.message}. Controlla che GOOGLE_SERVICE_ACCOUNT sia un JSON valido.`);
    }
    
    if (!credentials.private_key || !credentials.client_email) {
      throw new Error('Credenziali incomplete: manca private_key o client_email');
    }

    // ✅ FIX CRUCIALE: google-auth-library si aspetta la private_key con \n reali, non \\n
    // Se Vercel ha escapato i newline, li ripristiniamo
    let privateKey = credentials.private_key;
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    const auth = new GoogleAuth({
      credentials: {
        type: 'service_account',
        client_email: credentials.client_email,
        private_key: privateKey
      },
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });

    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    
    if (!tokenResponse.token) {
      throw new Error('Impossibile ottenere access token');
    }
    
    return tokenResponse.token;
  } catch (err) {
    console.error('❌ getAccessToken error:', err.message);
    throw err;
  }
}

// Helper: chiama Vertex AI API REST
async function callVertexAI(imageBase64, prompt, mimeType = 'image/jpeg') {
  const accessToken = await getAccessToken();
  const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
  const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'europe-west1';
  const MODEL = 'imagegeneration@006';
  
  if (!PROJECT_ID) throw new Error('GOOGLE_CLOUD_PROJECT non impostata');
  
  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL}:predict`;
  
  const payload = {
    instances: [{ image: { bytesBase64Encoded: imageBase64 }, mimeType }],
    parameters: {
      prompt,
      negativePrompt: 'low quality, blurry, distorted, watermark, text, signature',
      sampleCount: 1,
      aspectRatio: '1:1',
      editMode: 'inpainting',
      maskMode: 'semantic',
      guidanceScale: 8,
      seed: Math.floor(Math.random() * 10000)
    }
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Vertex AI HTTP ${res.status}`);
  }

  const data = await res.json();
  const generated = data.predictions?.[0]?.bytesBase64Encoded;
  if (!generated) throw new Error('Nessuna immagine nel response di Vertex AI');
  
  return generated;
}

// === HANDLER PRINCIPALE ===
export default async function handler(req, res) {
  const origin = req.headers.origin || '*';
  setCorsHeaders(res, origin);

  // ✅ PREFLIGHT CORS - DEVE RITORNARE SUBITO
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { imageBase64, prompt, mimeType = 'image/jpeg' } = req.body || {};

    if (!imageBase64 || !prompt) {
      return res.status(400).json({ error: 'Missing imageBase64 or prompt' });
    }

    console.log('🎨 Processing image edit request...');
    const generatedBase64 = await callVertexAI(imageBase64, prompt, mimeType);

    return res.status(200).json({
      success: true,
      image: `image/png;base64,${generatedBase64}`
    });

  } catch (error) {
    console.error('❌ Function error:', error.message);
    
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}
