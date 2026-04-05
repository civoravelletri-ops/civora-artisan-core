// api/generate-image.js - Vercel Serverless Function per Vertex AI / Imagen 3
import { NextResponse } from 'next/server';

// Configurazione Vertex AI
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'europe-west1';
const MODEL_NAME = 'imagegeneration@006'; // Imagen 3 per editing

// Helper: chiama l'API REST di Vertex AI (più affidabile in serverless)
async function callVertexAI(imageBase64, prompt, mimeType = 'image/jpeg') {
  const accessToken = await getAccessToken();
  
  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_NAME}:predict`;
  
  const payload = {
    instances: [
      {
        image: { bytesBase64Encoded: imageBase64 },
        mimeType: mimeType
      }
    ],
    parameters: {
      prompt: prompt,
      negativePrompt: 'low quality, blurry, distorted, watermark, text overlay',
      sampleCount: 1,
      aspectRatio: '1:1',
      editMode: 'inpainting',
      maskMode: 'semantic',
      guidanceScale: 8,
      seed: Math.floor(Math.random() * 10000)
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Vertex AI error: ${response.status}`);
  }

  const data = await response.json();
  const generatedImage = data.predictions?.[0]?.bytesBase64Encoded;
  
  if (!generatedImage) {
    throw new Error('Nessuna immagine generata da Vertex AI');
  }
  
  return generatedImage;
}

// Helper: ottiene token OAuth2 dal service account JSON
async function getAccessToken() {
  // Le credenziali sono in process.env.GOOGLE_SERVICE_ACCOUNT (JSON stringificato)
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
  
  if (!credentials.private_key || !credentials.client_email) {
    throw new Error('Credenziali Google Cloud non configurate correttamente');
  }

  // Crea JWT per OAuth2 token exchange
  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  // Firma JWT (usiamo Web Crypto API, disponibile in Vercel Edge/Node)
  const encoder = new TextEncoder();
  const header = encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = encoder.encode(JSON.stringify(claimSet));
  
  const base64Url = (buf) => 
    btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  
  const signatureInput = `${base64Url(header)}.${base64Url(claim)}`;
  
  // Firma con private key (PKCS#8)
  const privateKey = credentials.private_key.replace(/\\n/g, '\n');
  const key = await crypto.subtle.importKey(
    'pkcs8',
    encoder.encode(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(signatureInput));
  const jwt = `${signatureInput}.${base64Url(signature)}`;

  // Scambia JWT per access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) {
    throw new Error('Impossibile ottenere access token da Google OAuth2');
  }
  
  return tokenData.access_token;
}

// Handler principale Vercel
export const config = {
  runtime: 'nodejs',
  maxDuration: 60 // secondi, necessario per generazione immagini
};

export default async function handler(req) {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const { imageBase64, prompt, mimeType = 'image/jpeg' } = await req.json();

    if (!imageBase64 || !prompt) {
      return new Response(JSON.stringify({ error: 'Missing imageBase64 or prompt' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Chiama Vertex AI
    const generatedImageBase64 = await callVertexAI(imageBase64, prompt, mimeType);

    return new Response(JSON.stringify({
      success: true,
      image: `image/png;base64,${generatedImageBase64}`
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Vertex AI Function Error:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Errore interno del server'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
