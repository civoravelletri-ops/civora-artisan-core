// Questo file è una Vercel Serverless Function che funge da proxy.
// Il tuo frontend chiama questa funzione Vercel, e questa funzione a sua volta
// chiama l'API di Hugging Face per generare immagini.
// Questo risolve i problemi di CORS e centralizza la logica di chiamata API.

import fetch from 'node-fetch'; // Importa la libreria 'node-fetch' per fare richieste HTTP lato server.
import { Buffer } from 'buffer'; // Importa l'oggetto Buffer per lavorare con dati binari in Node.js.

export default async function handler(req, res) {
    // ######################################################################
    // Gestione CORS (Cross-Origin Resource Sharing)
    // Permette al tuo frontend (su un dominio diverso durante lo sviluppo o test)
    // di chiamare questa funzione Vercel.
    // In produzione, potresti voler restringere 'Access-Control-Allow-Origin'
    // al tuo dominio specifico Vercel (es. 'https://civora-artisan-core.vercel.app').
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
    // Se la funzione viene chiamata con un metodo GET (es. digitando l'URL nel browser),
    // restituisce un messaggio per confermare che è attiva.
    // ######################################################################
    if (req.method === 'GET') {
        return res.status(200).json({ message: 'Vercel Function generate-image è attiva e risponde a GET!' });
    }

    // ######################################################################
    // Requisito POST
    // La generazione dell'immagine deve avvenire solo tramite richieste POST.
    // Se il metodo non è POST, restituiamo un errore.
    // ######################################################################
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed. Only POST is supported for image generation.' });
    }

    // ######################################################################
    // Logica Principale: Chiamata all'API di Hugging Face
    // ######################################################################
    try {
        // Estrai i dati inviati dal frontend dal corpo della richiesta JSON.
        const { apiKey, prompt, imageData } = req.body;

        // Verifica che tutti i dati necessari siano presenti.
        if (!apiKey || !prompt || !imageData) {
            return res.status(400).json({ error: 'Missing apiKey, prompt or imageData in request body.' });
        }

        // URL aggiornato dell'API di Hugging Face per il modello image-to-image.
        // Hugging Face ha richiesto di passare da api-inference a router.huggingface.co.
        const HF_API_URL = 'https://router.huggingface.co/models/timbroynolds/stable-diffusion-v1-5-img2img'; 

        // Esegui la richiesta POST all'API di Hugging Face.
        const hfResponse = await fetch(HF_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`, // L'API Key di Hugging Face.
                'Content-Type': 'application/json'   // Diciamo a Hugging Face che il body è JSON.
            },
            body: JSON.stringify({
                inputs: prompt,    // Il testo del prompt per la generazione.
                image: imageData,  // L'immagine originale come stringa Data URL (base64).
                parameters: {      // Parametri specifici per il modello di diffusione.
                    strength: 0.75,         // Quanto l'immagine generata si discosta dall'originale (0.0-1.0).
                    guidance_scale: 7.5,    // Quanto il modello deve seguire il prompt (più alto = più fedele).
                    num_inference_steps: 50 // Numero di passi di generazione (più alto = migliore qualità, più lento).
                },
                options: { wait_for_model: true } // Attende che il modello si carichi se è inattivo.
            })
        });

        // Controlla se la richiesta a Hugging Face ha avuto successo (status code 2xx).
        if (!hfResponse.ok) {
            const errorText = await hfResponse.text();
            console.error('Hugging Face API Error:', hfResponse.status, errorText);
            
            // Tenta di parseare il messaggio di errore di Hugging Face (potrebbe essere JSON o testo).
            try {
                const hfErrorJson = JSON.parse(errorText);
                return res.status(hfResponse.status).json({ 
                    error: 'Failed to generate image from Hugging Face API', 
                    details: hfErrorJson 
                });
            } catch (e) {
                // Se non è JSON, restituisci il testo grezzo dell'errore.
                return res.status(hfResponse.status).json({ 
                    error: 'Failed to generate image from Hugging Face API', 
                    details: errorText 
                });
            }
        }

        // Se Hugging Face ha risposto con successo, il body contiene l'immagine generata in formato binario.
        // Leggiamo il body come ArrayBuffer (dati binari).
        const imageBuffer = await hfResponse.arrayBuffer();
        // Convertiamo l'ArrayBuffer in una stringa base64.
        const base64Image = Buffer.from(imageBuffer).toString('base64');
        // Recuperiamo il Content-Type dalla risposta di Hugging Face, altrimenti usiamo 'image/png' come default.
        const contentType = hfResponse.headers.get('content-type') || 'image/png';

        // Creiamo una Data URL completa (es. data:image/png;base64,...) da inviare al frontend.
        const imageUrl = `data:${contentType};base64,${base64Image}`;

        // Restituiamo l'URL dell'immagine generata al frontend in un oggetto JSON.
        res.status(200).json({ imageUrl: imageUrl });

    } catch (error) {
        // Cattura e gestisce eventuali errori che si verificano nella funzione proxy.
        console.error('Proxy Function Error:', error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
