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
        return res.status(200).json({ message: "BINGO! Motore acceso (Versione GEMINI 2.5 FLASH IMAGE)!" });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Metodo non consentito, usa POST.' });
    }

    try {
       const { imageBase64, referenceImageBase64, prompt } = req.body;
console.log("Dati ricevuti da Vercel - Immagine cliente presente:", !!imageBase64, "Riferimento presente:", !!referenceImageBase64);
       if (!imageBase64 || !prompt) {
           return res.status(400).json({ error: 'Immagine o comando mancanti.' });
       }

        if (!process.env.GOOGLE_CREDENTIALS) {
                    return res.status(500).json({ error: 'Chiave Google Cloud mancante.' });
                }
                // --- INIZIO: CONTROLLO CREDENZIALI FIRESTORE ADMIN (usando il tuo nome) ---
                        if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
                            console.error("FIREBASE_SERVICE_ACCOUNT_KEY non configurata. Il contatore globale non funzionerà.");
                            // Non blocchiamo la richiesta, ma logghiamo l'errore.
                        }
                        // --- FINE: CONTROLLO CREDENZIALI FIRESTORE ADMIN ---
                // --- FINE: CONTROLLO CREDENZIALI FIRESTORE ADMIN ---

                const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

                const auth = new GoogleAuth({
                    credentials,
                    scopes:['https://www.googleapis.com/auth/cloud-platform']
                });

                const client = await auth.getClient();
                const accessToken = (await client.getAccessToken()).token;

        const projectId = credentials.project_id;
        const location = 'us-central1'; 
        
        // IL NUOVO MOTORE UNIFICATO DI GOOGLE
        const modelId = 'gemini-3-flash';

        // Il nuovo URL per Gemini usa "generateContent" invece di "predict"
        const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`;

        const mimeMatch = imageBase64.match(/^data:(image\/[a-z]+);base64,/);
                const detectedMimeType = mimeMatch ? mimeMatch[1] : "image/webp";
                const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

                // Prepariamo il vassoio per l'AI
                                const parts = [];

                                // 1. Aggiungiamo la foto cliente (Immagine 1)
                                parts.push({
                                    text: "Immagine 1 (Cliente):"
                                });
                                parts.push({
                                    inlineData: { mimeType: detectedMimeType, data: cleanBase64 }
                                });

                                // 2. Aggiungiamo la foto riferimento (Immagine 2)
                                if (referenceImageBase64) {
                                    const refMimeMatch = referenceImageBase64.match(/^data:(image\/[a-z]+);base64,/);
                                    const refMimeType = refMimeMatch ? refMimeMatch[1] : "image/jpeg";
                                    const cleanRefBase64 = referenceImageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

                                    parts.push({
                                        text: "Immagine 2 (Modello di riferimento):"
                                    });
                                    parts.push({
                                        inlineData: { mimeType: refMimeType, data: cleanRefBase64 }
                                    });
                                }

                                // 3. Istruzione finale che collega Immagine 1 e Immagine 2
                                parts.push({
                                    text: prompt + " Usa l'Immagine 2 per modificare l'Immagine 1."
                                });

                                const payload = {
                                    contents: [{ role: "user", parts: parts }]
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

        // Gemini restituisce un array di "parts", noi cerchiamo quello che contiene l'immagine
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
                    // --- INIZIO: LOGICA CONTATORE GLOBALE FIRESTORE ADMIN (con i tuoi nomi personalizzati) ---
                    // --- INIZIO: LOGICA CONTATORE GLOBALE FIRESTORE ADMIN (con i tuoi nomi personalizzati e la tua variabile d'ambiente) ---
                                if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) { // Ora usa il tuo nome di variabile
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
                                        const db = admin.firestore(firebaseAdminApp); // Usa l'istanza corretta del db

                                        const globalStatsRef = db.collection('civora_analytics').doc('ai_gen'); // La tua Collezione e Documento

                                        // Tentiamo di aggiornare il documento
                                        await globalStatsRef.update({
                                            total_generated_images_ai: admin.firestore.FieldValue.increment(1) // Il tuo Campo
                                        });

                                    } catch (error) {
                                        // Se il documento non esiste (codice 5 per "NotFound"), crealo
                                        if (error.code === 5 || (error.details && error.details.includes('not found'))) {
                                            try {
                                                                        // Decodifica Base64 prima di fare il JSON.parse
                                                                        const decodedCredentialsString = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8');
                                                                        const adminCredentials = JSON.parse(decodedCredentialsString); 
                                                                        if (!firebaseAdminApp) { // Doppio controllo per evitare reinizializzazioni
                                                                            firebaseAdminApp = admin.initializeApp({
                                                                                credential: admin.credential.cert(adminCredentials)
                                                                            }, 'globalCounterApp');
                                                                        }
                                                const db = admin.firestore(firebaseAdminApp);
                                                await db.collection('civora_analytics').doc('ai_gen').set({ // Crea con i tuoi nomi
                                                    total_generated_images_ai: 1 // Inizializza il tuo Campo
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
                    // --- FINE: LOGICA CONTATORE GLOBALE FIRESTORE ADMIN ---

                    return res.status(200).json({ imageBase64: `data:image/webp;base64,${returnedImageBase64}` });
                } else {
                    console.error("Risposta anomala da Gemini:", JSON.stringify(data, null, 2));
                    return res.status(500).json({ error: 'Nessuna immagine restituita da Google.' });
                }

            } catch (error) {
                console.error('Errore Try-Catch:', error);
                return res.status(500).json({ error: 'Errore interno', details: error.message });
            }
        };
