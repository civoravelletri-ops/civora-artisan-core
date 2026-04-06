// File: api/generate-look.js
const { GoogleAuth } = require('google-auth-library');

export default async function handler(req, res) {
    // 1. Gestione CORS SUPER SICURA (Lasciapassare ufficiale)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Metodo non consentito, usa POST.' });
    }

    try {
        const { imageBase64, prompt } = req.body;

        if (!imageBase64 || !prompt) {
            return res.status(400).json({ error: 'Immagine o comando (prompt) mancanti.' });
        }

        // 2. Lettura del "Pass VIP" (JSON Segreto) che abbiamo messo su Vercel
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        
        // 3. Autenticazione sicura con Google Cloud
        const auth = new GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });

        const client = await auth.getClient();
        const accessToken = (await client.getAccessToken()).token;

        // 4. Configurazione per Vertex AI (Imagen)
        const projectId = credentials.project_id;
        const location = 'us-central1'; // I server principali per le immagini AI
        const modelId = 'imagegeneration@006'; // Il modello di punta per l'editing

        const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`;

        // Pulizia dell'immagine (Vertex vuole solo il codice puro, senza l'intestazione iniziale)
        const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

        // 5. Creazione del pacco da spedire a Vertex (Modifica "Mask-Free")
        const payload = {
            instances:[
                {
                    prompt: prompt,
                    image: {
                        bytesBase64Encoded: cleanBase64
                    }
                }
            ],
            parameters: {
                sampleCount: 1, // Vogliamo 1 risultato
                editConfig: {
                    editMode: "EDIT_MODE_DEFAULT" // Dice all'AI di modificare l'immagine senza bisogno di ritagliare nulla
                }
            }
        };

        // 6. Invio della richiesta ai server blindati di Google
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        // 7. Controllo errori da Google
        if (!response.ok) {
            console.error("Errore da Vertex AI:", JSON.stringify(data, null, 2));
            return res.status(response.status).json({ error: 'Errore durante la generazione su Google Cloud', details: data });
        }

        // 8. Ritorno della foto modificata al barbiere!
        if (data.predictions && data.predictions.length > 0) {
            const newImageBase64 = data.predictions[0].bytesBase64Encoded;
            // Riappiccichiamo l'intestazione per farla leggere al browser
            return res.status(200).json({ imageBase64: `data:image/jpeg;base64,${newImageBase64}` });
        } else {
            return res.status(500).json({ error: 'Google non ha restituito nessuna immagine.' });
        }

    } catch (error) {
        console.error('Errore Critico Server:', error);
        return res.status(500).json({ error: 'Errore interno del server Vercel', details: error.message });
    }
}
