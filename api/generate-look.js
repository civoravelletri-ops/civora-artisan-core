const { GoogleAuth } = require('google-auth-library');

module.exports = async (req, res) => {
    // 1. CORS DINAMICO
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'GET') {
        return res.status(200).json({ message: "BINGO! Motore acceso (Versione IMAGEN 3)!" });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Metodo non consentito, usa POST.' });
    }

    try {
        const { imageBase64, prompt } = req.body;

        if (!imageBase64 || !prompt) {
            return res.status(400).json({ error: 'Immagine o comando mancanti.' });
        }

        if (!process.env.GOOGLE_CREDENTIALS) {
            return res.status(500).json({ error: 'Chiave Google Cloud mancante.' });
        }

        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        
        const auth = new GoogleAuth({
            credentials,
            scopes:['https://www.googleapis.com/auth/cloud-platform']
        });

        const client = await auth.getClient();
        const accessToken = (await client.getAccessToken()).token;

        const projectId = credentials.project_id;
        const location = 'us-central1'; 
        
        // IL NUOVO MOTORE SUPER POTENTE DI GOOGLE
        const modelId = 'imagen-3.0-capability-001'; 

        const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`;

        const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

        // IL NUOVO "PACCO" PER LA SPEDIZIONE
        const payload = {
            instances:[
                {
                    prompt: prompt,
                    referenceImages:[
                        {
                            referenceType: "REFERENCE_TYPE_RAW",
                            referenceId: 1,
                            referenceImage: {
                                bytesBase64Encoded: cleanBase64
                            }
                        }
                    ]
                }
            ],
            parameters: {
                sampleCount: 1,
                editConfig: {
                    editMode: "EDIT_MODE_DEFAULT"
                }
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("Errore da Vertex:", JSON.stringify(data, null, 2));
            return res.status(response.status).json({ error: 'Errore Vertex', details: data });
        }

        if (data.predictions && data.predictions.length > 0) {
            return res.status(200).json({ imageBase64: `data:image/jpeg;base64,${data.predictions[0].bytesBase64Encoded}` });
        } else {
            return res.status(500).json({ error: 'Nessuna immagine restituita da Google.' });
        }

    } catch (error) {
        console.error('Errore Try-Catch:', error);
        return res.status(500).json({ error: 'Errore interno', details: error.message });
    }
};
