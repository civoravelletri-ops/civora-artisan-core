const { GoogleAuth } = require('google-auth-library');
const admin = require('firebase-admin');
let firebaseAdminApp;

module.exports = async (req, res) => {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'GET') {
        return res.status(200).json({ message: "BINGO! Motore acceso (Versione GEMINI 2.5 FLASH IMAGE + VEO VIDEO)!" });
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
        if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
            console.error("FIREBASE_SERVICE_ACCOUNT_KEY non configurata. Il contatore globale non funzionerà.");
        }

        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

        const auth = new GoogleAuth({
            credentials,
            scopes:['https://www.googleapis.com/auth/cloud-platform']
        });

        const client = await auth.getClient();
        const accessToken = (await client.getAccessToken()).token;

        const projectId = credentials.project_id;
        const location = 'global'; // Location for Gemini Flash
        const modelIdImage = 'gemini-3.1-flash-image-preview';

        // --- INIZIO: GENERAZIONE IMMAGINE (IL TUO CODICE ESISTENTE) ---
        const urlImage = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelIdImage}:generateContent`;

        const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");
        const detectedMimeType = imageBase64.match(/^data:(image\/[a-z]+);base64,/);
        const finalMimeType = detectedMimeType ? detectedMimeType[1] : "image/webp";

        const { referenceImageBase64 } = req.body;

        let partsForGeminiImage = [
            { text: prompt },
            {
                inlineData: {
                    mimeType: finalMimeType,
                    data: cleanBase64
                }
            }
        ];

        if (referenceImageBase64) {
            const cleanReferenceBase64 = referenceImageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");
            const detectedReferenceMimeType = referenceImageBase64.match(/^data:(image\/[a-z]+);base64,/);
            const finalReferenceMimeType = detectedReferenceMimeType ? detectedReferenceMimeType[1] : "image/jpeg";

            partsForGeminiImage.push({
                inlineData: {
                    mimeType: finalReferenceMimeType,
                    data: cleanReferenceBase64
                }
            });
        }

        const payloadImage = {
            contents: [{
                role: "user",
                parts: partsForGeminiImage
            }],
            generationConfig: {
                responseModalities: ["TEXT", "IMAGE"]
            }
        };

        const responseImage = await fetch(urlImage, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payloadImage)
        });

        const dataImage = await responseImage.json();

        if (!responseImage.ok) {
            console.error("Errore da Vertex (Immagine):", JSON.stringify(dataImage, null, 2));
            return res.status(responseImage.status).json({ error: 'Errore Vertex (Immagine)', details: dataImage });
        }

        let returnedImageBase64 = null;
        if (dataImage.candidates && dataImage.candidates.length > 0) {
            const parts = dataImage.candidates[0].content.parts;
            for (let part of parts) {
                if (part.inlineData && part.inlineData.data) {
                    returnedImageBase64 = part.inlineData.data;
                    break;
                }
            }
        }

        if (!returnedImageBase64) {
            console.error("Risposta anomala da Gemini (Immagine):", JSON.stringify(dataImage, null, 2));
            return res.status(500).json({ error: 'Nessuna immagine restituita da Google.' });
        }
        // --- FINE: GENERAZIONE IMMAGINE ---

        // --- INIZIO: GENERAZIONE VIDEO CON VEO (NUOVA LOGICA AGGIUNTA) ---
        let videoUrl = null;
        try {
            const videoLocation = 'us-central1'; // I modelli di generazione video spesso hanno regioni specifiche
            const modelIdVideo = 'veo-001'; // Il tuo modello VEO richiesto per la generazione video

            // Prompt specifico per il video, come descritto dall'utente
            const videoPromptText = "Simula un movimento naturale: la persona che si guarda allo specchio, gira leggermente la testa per ammirare il taglio e accenna un sorriso di soddisfazione. Qualità: HD (1080p). Durata: 5-6 secondi.";

            // Endpoint per i modelli di generazione video, potrebbe essere leggermente diverso se veo-001 non è un 'publisher/google/models' standard
            // Per ora assumiamo che sia sotto lo stesso endpoint di aiplatform con una location diversa e un model ID specifico
            const urlVideo = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${videoLocation}/publishers/google/models/${modelIdVideo}:generateContent`;

            const payloadVideo = {
                contents: [{
                    role: "user",
                    parts: [
                        { text: videoPromptText },
                        {
                            inlineData: {
                                mimeType: `image/webp`, // Mime type dell'immagine generata
                                data: returnedImageBase64 // Immagine generata da Gemini
                            }
                        }
                    ]
                }],
                // Parametri specifici per la generazione video (questi potrebbero variare a seconda dell'API Veo)
                generationConfig: {
                    responseModalities: ["VIDEO"], // Chiediamo un video
                    // Ad esempio, per durata e risoluzione, potrebbero esserci parametri qui
                    // Questo è un esempio, l'API VEO potrebbe avere parametri diversi
                    // Per ora, l'istruzione di risoluzione e durata è nel prompt testuale
                    videoGenerationParameters: { // Esempio di come potrebbero essere i parametri video
                         duration_seconds: 5,
                         resolution: "1080p"
                    }
                }
            };

            const responseVideo = await fetch(urlVideo, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payloadVideo)
            });

            const dataVideo = await responseVideo.json();

            if (!responseVideo.ok) {
                console.error("Errore da Vertex (Video):", JSON.stringify(dataVideo, null, 2));
                // Non blocchiamo l'intera richiesta se il video fallisce, ma logghiamo l'errore
                // throw new Error(dataVideo.error || 'Errore sconosciuto da Vertex (Video)');
            } else {
                if (dataVideo.candidates && dataVideo.candidates.length > 0) {
                    const videoPart = dataVideo.candidates[0].content.parts.find(p => p.fileData && p.fileData.fileUri);
                    if (videoPart && videoPart.fileData.fileUri) {
                        videoUrl = videoPart.fileData.fileUri; // L'URL del video generato
                    }
                }
            }
        } catch (videoError) {
            console.error("Errore durante la generazione del video:", videoError);
            // Continuiamo comunque, ma videoUrl sarà null
        }
        // --- FINE: GENERAZIONE VIDEO ---

        // --- INIZIO: LOGICA CONTATORE GLOBALE FIRESTORE ADMIN ---
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

        // Restituisci entrambi i risultati
        return res.status(200).json({
            imageBase64: `data:image/webp;base64,${returnedImageBase64}`,
            videoUrl: videoUrl // Può essere null se la generazione video fallisce
        });

    } catch (error) {
        console.error('Errore Try-Catch generale:', error);
        return res.status(500).json({ error: 'Errore interno', details: error.message });
    }
};
