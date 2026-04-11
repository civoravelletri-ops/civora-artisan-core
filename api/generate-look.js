const { GoogleAuth } = require('google-auth-library');
const admin = require('firebase-admin');

// --- INIZIALIZZAZIONE FIREBASE ADMIN GLOBALE ---
let firebaseAdminApp;
if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY && !firebaseAdminApp) {
    try {
        const decodedCredentialsString = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8');
        const adminCredentials = JSON.parse(decodedCredentialsString);
        firebaseAdminApp = admin.initializeApp({
            credential: admin.credential.cert(adminCredentials)
        }, 'globalCounterApp');
    } catch (e) {
        console.error("Errore avvio Firebase Admin:", e);
    }
}

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
        return res.status(200).json({ message: "BINGO! Motore acceso (Versione GEMINI 2.0 FLASH IMAGE GENERATOR)!" });
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
        const modelId = 'gemini-2.0-flash-exp'; 

        const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`;

        const mimeMatch = imageBase64.match(/^data:(image\/[a-z]+);base64,/);
        const detectedMimeType = mimeMatch ? mimeMatch[1] : "image/webp";
        const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

        const payload = {
            contents:[
                {
                    role: "user",
                    parts:[
                        {
                            text: prompt
                        },
                        {
                            inlineData: {
                                mimeType: detectedMimeType,
                                data: cleanBase64
                            }
                        }
                    ]
                }
            ],
            generationConfig: {
                responseModalities: ["IMAGE"]
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

        let returnedImageBase64 = null;
        
        if (data.candidates && data.candidates.length > 0) {
            const parts = data.candidates[0].content.parts;
            for (let part of parts) {
                if (part.inlineData && part.inlineData.data) {
                    returnedImageBase64 = part.inlineData.data;
                    break;
                }
            }
        }

        if (returnedImageBase64) {
            // --- INIZIO: LOGICA CONTATORE GLOBALE FIRESTORE ADMIN ---
            if (firebaseAdminApp) { 
                try {
                    const db = admin.firestore(firebaseAdminApp);
                    const globalStatsRef = db.collection('civora_analytics').doc('ai_gen');

                    await globalStatsRef.update({
                        total_generated_images_ai: admin.firestore.FieldValue.increment(1)
                    });
                } catch (error) {
                    if (error.code === 5 || (error.details && error.details.includes('not found'))) {
                        try {
                            const db = admin.firestore(firebaseAdminApp);
                            await db.collection('civora_analytics').doc('ai_gen').set({
                                total_generated_images_ai: 1
                            });
                        } catch (setError) {
                            console.error("Errore nel creare/inizializzare contatore globale:", setError);
                        }
                    } else {
                        console.error("Errore nell'incrementare il contatore globale AI:", error);
                    }
                }
            }
            // --- FINE: LOGICA CONTATORE GLOBALE FIRESTORE ADMIN ---

            return res.status(200).json({ imageBase64: `data:image/jpeg;base64,${returnedImageBase64}` });
        } else {
            console.error("Risposta anomala da Gemini:", JSON.stringify(data, null, 2));
            return res.status(500).json({ error: 'Nessuna immagine restituita. Assicurati che il comando generi un disegno.' });
        }

    } catch (error) {
        console.error('Errore Try-Catch:', error);
        return res.status(500).json({ error: 'Errore interno', details: error.message });
    }
};
