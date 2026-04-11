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
        return res.status(200).json({ message: "BINGO! Motore acceso (Versione VERTEX IMAGEN EDITING)!" });
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

        // --- INIZIO: CONTROLLO CREDENZIALI FIRESTORE ADMIN ---
        if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
            console.error("FIREBASE_SERVICE_ACCOUNT_KEY non configurata. Il contatore globale non funzionerà.");
            // Non blocchiamo la richiesta, ma logghiamo l'errore.
        }
        // --- FINE: CONTROLLO CREDENZIALI FIRESTORE ADMIN ---

        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

        const auth = new GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });

        const client = await auth.getClient();
        const accessToken = (await client.getAccessToken()).token;

        const projectId = credentials.project_id;
        const location = 'us-central1'; 
        
        // IL VERO MOTORE PER MODIFICARE IMMAGINI SU VERTEX AI
        const modelId = 'gemini-3.0-flash';

        // Usa "predict" per i modelli grafici Imagen, non "generateContent"
        const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`;
        
        // Pulizia dell'intestazione base64 dall'immagine in ingresso
        const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

        // PAYLOAD PER IMAGEN: Usa 'instances' e 'parameters'
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
                sampleCount: 1, // Vogliamo 1 sola immagine di ritorno
                // FONDAMENTALE: Consente al modello di elaborare volti umani (altrimenti andrebbe in errore bloccato dai filtri)
                personGeneration: "ALLOW_ADULT" 
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
            console.error("Errore da Vertex Imagen:", JSON.stringify(data, null, 2));
            return res.status(response.status).json({ error: 'Errore Vertex Imagen', details: data });
        }

        // Parser per i modelli Imagen: restituiscono un array "predictions"
        let returnedImageBase64 = null;
        
        if (data.predictions && data.predictions.length > 0) {
            returnedImageBase64 = data.predictions[0].bytesBase64Encoded;
        }

        if (returnedImageBase64) {
            // --- INIZIO: LOGICA CONTATORE GLOBALE FIRESTORE ADMIN ---
            if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) { 
                try {
                    // Inizializza Firebase Admin SDK solo una volta per istanza della funzione
                    if (!firebaseAdminApp) {
                        // Decodifica Base64 prima di fare il JSON.parse
                        const decodedCredentialsString = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8');
                        const adminCredentials = JSON.parse(decodedCredentialsString);
                        firebaseAdminApp = admin.initializeApp({
                            credential: admin.credential.cert(adminCredentials)
                        }, 'globalCounterApp'); // Nome unico per l'app Admin
                    }
                    const db = admin.firestore(firebaseAdminApp); 

                    const globalStatsRef = db.collection('civora_analytics').doc('ai_gen'); 

                    // Tentiamo di aggiornare il documento
                    await globalStatsRef.update({
                        total_generated_images_ai: admin.firestore.FieldValue.increment(1) 
                    });

                } catch (error) {
                    // Se il documento non esiste (codice 5 per "NotFound"), crealo
                    if (error.code === 5 || (error.details && error.details.includes('not found'))) {
                        try {
                            const decodedCredentialsString = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8');
                            const adminCredentials = JSON.parse(decodedCredentialsString); 
                            if (!firebaseAdminApp) { 
                                firebaseAdminApp = admin.initializeApp({
                                    credential: admin.credential.cert(adminCredentials)
                                }, 'globalCounterApp');
                            }
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

            // Restituisce l'immagine formattata in base64 al frontend
            return res.status(200).json({ imageBase64: `data:image/png;base64,${returnedImageBase64}` });
        } else {
            console.error("Risposta anomala da Imagen:", JSON.stringify(data, null, 2));
            return res.status(500).json({ error: 'Nessuna immagine restituita da Google.' });
        }

    } catch (error) {
        console.error('Errore Try-Catch:', error);
        return res.status(500).json({ error: 'Errore interno', details: error.message });
    }
};
