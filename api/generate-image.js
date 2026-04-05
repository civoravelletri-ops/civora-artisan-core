// Questo file è una Vercel Serverless Function che funge da proxy.
// Il tuo frontend chiama questa funzione Vercel, e questa funzione a sua volta
// chiama l'API di Hugging Face per generare immagini.
// Questo risolve i problemi di CORS e centralizza la logica di chiamata API.

// In ambienti Vercel con Node.js 18+ (che è lo standard attuale),
// `fetch` e `Buffer` sono spesso disponibili globalmente e non necessitano di import.
// Rimuovendo gli import espliciti, a volte si evitano problemi di build in Vercel.
// import fetch from 'node-fetch'; // Rimosso l'import esplicito, fetch dovrebbe essere globale.
// import { Buffer } from 'buffer'; // Rimosso l'import esplicito, Buffer dovrebbe essere globale.

export default async function handler(req, res) {
    // ######################################################################
    // Gestione CORS (Cross-Origin Resource Sharing)
    // ######################################################################
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Se la richiesta è di tipo OPTIONS (usata dal browser per pre-flight CORS),
    // rispondiamo subito con OK per indicare che la comunicazione è permessa.
    if (req.method === 'OPTIONS') {
        return res.status(200).send('OK');
    }

    // ######################################################################
    // Test di raggiungibilità (GET)
    // ######################################################################
    if (req.method === 'GET') {
        return res.status(200).json({ message: 'Vercel Function generate-image è attiva e risponde a GET! (Nuovo test)' });
    }

    // ######################################################################
    // Requisito POST
    // ######################################################################
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed. Only POST is supported for image generation.' });
    }

    // ######################################################################
    // Logica Principale: Chiamata all'API di Hugging Face
    // ######################################################################
    try {
        const { apiKey, prompt, imageData } = req.body;

        if (!apiKey || !prompt || !imageData) {
            return res.status(400).json({ error: 'Missing apiKey, prompt or imageData in request body.' });
        }

        const HF_API_URL = 'https://router.huggingface.co/models/stabilityai/stable-diffusion-2-1'; 

        const hfResponse = await fetch(HF_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: prompt,
                image: imageData,
                parameters: {
                    strength: 0.75,
                    guidance_scale: 7.5,
                    num_inference_steps: 50
                },
                options: { wait_for_model: true }
            })
        });

        if (!hfResponse.ok) {
            const errorText = await hfResponse.text();
            console.error('Hugging Face API Error:', hfResponse.status, errorText);
            try {
                const hfErrorJson = JSON.parse(errorText);
                return res.status(hfResponse.status).json({ 
                    error: 'Failed to generate image from Hugging Face API', 
                    details: hfErrorJson 
                });
            } catch (e) {
                return res.status(hfResponse.status).json({ 
                    error: 'Failed to generate image from Hugging Face API', 
                    details: errorText 
                });
            }
        }

        const imageBuffer = await hfResponse.arrayBuffer();
        // Buffer è globale in Node.js, non dovrebbe dare problemi.
        const base64Image = Buffer.from(imageBuffer).toString('base64');
        const contentType = hfResponse.headers.get('content-type') || 'image/png';

        const imageUrl = `data:${contentType};base64,${base64Image}`;

        res.status(200).json({ imageUrl: imageUrl });

    } catch (error) {
        console.error('Proxy Function Error:', error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
