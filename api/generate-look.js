const { GoogleAuth } = require('google-auth-library');

module.exports = async function handler(req, res) {
    // --- 1. LASCIAPASSARE CORS ASSOLUTO ---
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // Se il browser fa il controllo preventivo (OPTIONS), diciamo "Tutto OK!" e lo facciamo passare
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Da qui in poi gestiamo solo le vere chiamate POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Metodo non consentito, usa POST.' });
    }

    try {
        const { imageBase64, prompt } = req.body;

        if (!imageBase64 || !prompt) {
            return res.status(400).json({ error: 'Immagine o comando (prompt) mancanti.' });
        }

        // Lettura del "Pass VIP" (JSON Segreto)
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        
        // Autenticazione sicura con Google Cloud
        const auth = new GoogleAuth({
            credentials,
            scopes:['https://www.googleapis.com/auth/cloud-platform']
        });

        const client = await auth.getClient();
        const accessToken = (await client.getAccessToken()).token;

        // Configurazione per Vertex AI (Imagen)
        const projectId = credentials.project_id;
        const location = 'us-central1'; 
        const modelId = 'imagegeneration@006'; 

        const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`;

        // Pulizia dell'immagine 
        const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

        // Creazione del pacco da spedire a Vertex
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
                sampleCount: 1, 
                editConfig: {
                    editMode: "EDIT_MODE_DEFAULT"
                }
            }
        };

        // Invio della richiesta ai server blindati di Google
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        // Controllo errori da Google
        if (!response.ok) {
            console.error("Errore da Vertex AI:", JSON.stringify(data, null, 2));
            return res.status(response.status).json({ error: 'Errore durante la generazione su Google Cloud', details: data });
        }

        // Ritorno della foto modificata
        if (data.predictions && data.predictions.length > 0) {
            const newImageBase64 = data.predictions[0].bytesBase64Encoded;
            return res.status(200).json({ imageBase64: `data:image/jpeg;base64,${newImageBase64}` });
        } else {
            return res.status(500).json({ error: 'Google non ha restituito nessuna immagine.' });
        }

    } catch (error) {
        console.error('Errore Critico Server:', error);
        return res.status(500).json({ error: 'Errore interno del server Vercel', details: error.message });
    }
}
