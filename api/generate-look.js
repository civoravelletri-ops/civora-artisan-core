const { GoogleAuth } = require('google-auth-library');
// --- INIZIO: AGGIUNTE PER FIRESTORE ADMIN SDK ---
const admin = require('firebase-admin');
let firebaseAdminApp; // Dichiarazione per l'istanza dell'app Firebase Admin
// --- FINE: AGGIUNTE PER FIRESTORE ADMIN SDK ---
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
        return res.status(200).json({ message: "MOTORE IMAGEN 3 ATTIVO - Pronto per il cambio look!" });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Metodo non consentito, usa POST.' });
    }

    try {
        const { imageBase64, referenceImageBase64, prompt } = req.body;

        if (!imageBase64 || !referenceImageBase64) {
            return res.status(400).json({ error: 'Mancano le immagini (cliente o riferimento).' });
        }

        if (!process.env.GOOGLE_CREDENTIALS) {
            return res.status(500).json({ error: 'Chiave Google Cloud mancante.' });
        }

        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        const auth = new GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });

        const client = await auth.getClient();
        const accessToken = (await client.getAccessToken()).token;

        const projectId = credentials.project_id;
        const location = 'us-central1';

       // IL NUOVO MOTORE UNIFICATO DI GOOGLE

        const modelId = 'gemini-2.5-flash-image'; 



        // Il nuovo URL per Gemini usa "generateContent" invece di "predict"

        const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`;


        // Pulizia delle stringhe Base64 (togliamo il prefisso data:image...)
        const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");
        const cleanRefBase64 = referenceImageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

        // Costruiamo il comando esatto per l'AI
        const finalPrompt = `Apply the exact hairstyle, haircut, and volume from the reference image (Image 2) onto the person in the main image (Image 1). Keep the face, features, identity, and original hair color of the person in Image 1 perfectly intact. Result must be photorealistic.`;

        const payload = {
            instances: [
                {
                    prompt: finalPrompt,
                    image: { bytesBase64: cleanBase64 },
                    referenceImage: { bytesBase64: cleanRefBase64 }
                }
            ],
            parameters: {
                sampleCount: 1,
                editConfig: {
                    editMode: "hair_style_transfer"
                },
                outputMimeType: "image/jpeg"
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
        if (data.predictions && data.predictions.length > 0) {
            returnedImageBase64 = data.predictions[0].bytesBase64;
        }

        if (returnedImageBase64) {
            // --- LOGICA CONTATORE FIRESTORE ---
            if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
                try {
                    if (!firebaseAdminApp) {
                        const decodedCredentialsString = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8');
                        const adminCredentials = JSON.parse(decodedCredentialsString);
                        firebaseAdminApp = admin.initializeApp({
                            credential: admin.credential.cert(adminCredentials)
                        }, 'globalCounterApp');
                    }
                    const db = admin.firestore(firebaseAdminApp);
                    const globalStatsRef = db.collection('civora_analytics').doc('ai_gen');
                    await globalStatsRef.update({
                        total_generated_images_ai: admin.firestore.FieldValue.increment(1)
                    });
                } catch (error) {
                    console.error("Errore contatore:", error);
                }
            }

            return res.status(200).json({ imageBase64: `data:image/jpeg;base64,${returnedImageBase64}` });
        } else {
            return res.status(500).json({ error: 'Nessuna immagine generata.' });
        }

    } catch (error) {
        console.error('Errore Generale:', error);
        return res.status(500).json({ error: 'Errore interno', details: error.message });
    }
};
