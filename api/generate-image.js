// api/generate-image.js - Vercel Serverless Function CORRETTA
// Formato: Vercel Serverless (non Next.js API routes)

export const config = {
  runtime: 'nodejs20.x',
  maxDuration: 60
};

// Helper CORS: ritorna gli header corretti
const corsHeaders = (origin = '*') => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
  'Access-Control-Max-Age': '86400' // 24h cache preflight
});

// Helper: ottiene token OAuth2 dal service account JSON
async function getAccessToken() {
  try {
    const credentialsRaw = process.env.GOOGLE_SERVICE_ACCOUNT;
    if (!credentialsRaw) throw new Error('GOOGLE_SERVICE_ACCOUNT non impostata');
    
    // Pulisci il JSON: rimuovi spazi extra e gestisci eventuali escape
    const credentials = JSON.parse(credentialsRaw.trim());
    
    if (!credentials.private_key || !credentials.client_email) {
      throw new Error('Credenziali incomplete: manca private_key o client_email');
    }

    const now = Math.floor(Date.now() / 1000);
    const claimSet = {
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };

    const encoder = new TextEncoder();
    const toBase64Url = (obj) => {
      const json = JSON.stringify(obj);
      const encoded = btoa(encoder.encode(json))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return encoded;
    };
    
    const header = toBase64Url({ alg: 'RS256', typ: 'JWT' });
    const claim = toBase64Url(claimSet);
    const signatureInput = `${header}.${claim}`;
    
    // Firma JWT con la private key
    const privateKey = credentials.private_key.replace(/\\n/g, '\n');
    const key = await crypto.subtle.importKey(
      'pkcs8',
      encoder.encode(privateKey),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(signatureInput));
    const jwt = `${signatureInput}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;

    // Scambia JWT per access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error(`OAuth2 error: ${JSON.stringify(tokenData)}`);
    }
    
    return tokenData.access_token;
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
export default async function handler(request) {
  const origin = request.headers.get('origin') || '*';
  const headers = corsHeaders(origin);

  // ✅ GESTIONE PREFLIGHT CORS (OPZIONI) - DEVE ESSERE PRIMA DI TUTTO
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // Solo POST permesso
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }

  try {
    const { imageBase64, prompt, mimeType = 'image/jpeg' } = await request.json();

    if (!imageBase64 || !prompt) {
      return new Response(JSON.stringify({ error: 'Missing imageBase64 or prompt' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    console.log('🎨 Processing image edit request...');
    const generatedBase64 = await callVertexAI(imageBase64, prompt, mimeType);

    return new Response(JSON.stringify({
      success: true,
      image: `image/png;base64,${generatedBase64}`
    }), {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Function error:', error.message);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }
}
