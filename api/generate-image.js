import fetch from 'node-fetch';

export default async function handler(req, res) {
    // Abilita CORS per tutte le origini (o specifica le tue origini Vercel)
    res.setHeader('Access-Control-Allow-Origin', '*'); // Puoi specificare il tuo dominio Vercel qui
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).send('OK');
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { apiKey, prompt, imageData } = req.body;

        if (!apiKey || !prompt || !imageData) {
            return res.status(400).json({ error: 'Missing apiKey, prompt or imageData in request body.' });
        }

        // Decodifica l'immagine base64 in un buffer
        const base64Data = imageData.split(';base64,').pop();
        const imageBuffer = Buffer.from(base64Data, 'base64');

        const HF_API_URL = 'https://api-inference.huggingface.co/models/timbroynolds/stable-diffusion-v1-5-img2img';

        const hfResponse = await fetch(HF_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json' // Questo header verrà sovrascritto dal body corretto
            },
            body: JSON.stringify({ // Il tuo modello sembra aspettarsi JSON con prompt e parametri
                inputs: prompt,
                image: base64Data, // Invia l'immagine come base64 string
                parameters: {
                    strength: 0.75,
                    guidance_scale: 7.5,
                    num_inference_steps: 50
                },
                options: { wait_for_model: true }
            })
        });

        // Qui c'è un errore nel tuo approccio. I modelli image-to-image di Hugging Face
        // spesso si aspettano l'immagine nel body della richiesta come binary, non dentro un JSON.
        // Dobbiamo cambiare l'invio dell'immagine.
        // Rifacciamo il fetch in un modo più compatibile con Hugging Face per img2img.

        const hfResponseFixed = await fetch(HF_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json' // Hugging Face spesso usa JSON per il prompt e altri parametri e l'immagine come un campo base64
            },
            body: JSON.stringify({
                inputs: prompt,
                image: imageData, // Invia la stringa data URL completa
                parameters: {
                    strength: 0.75,
                    guidance_scale: 7.5,
                    num_inference_steps: 50
                },
                options: { wait_for_model: true }
            })
        });


        if (!hfResponseFixed.ok) {
            const errorText = await hfResponseFixed.text();
            console.error('Hugging Face API Error:', hfResponseFixed.status, errorText);
            return res.status(hfResponseFixed.status).json({ error: 'Failed to generate image from Hugging Face API', details: errorText });
        }

        const hfBlob = await hfResponseFixed.arrayBuffer(); // Ricevi il blob come ArrayBuffer
        const hfBase64 = Buffer.from(hfBlob).toString('base64'); // Converti in base64
        const hfImageUrl = `data:${hfResponseFixed.headers.get('content-type')};base64,${hfBase64}`;


        res.status(200).json({ imageUrl: hfImageUrl });

    } catch (error) {
        console.error('Proxy Error:', error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
