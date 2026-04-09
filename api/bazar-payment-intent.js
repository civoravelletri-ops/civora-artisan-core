const { GoogleAuth } = require('google-auth-library');
const admin = require('firebase-admin'); // Necessario per Firebase Admin SDK
let db; // Questa variabile verrà usata per il tuo Firestore

// --- INIZIO: INIZIALIZZAZIONE FIRESTORE ADMIN SDK (Basata sul tuo bazar.js, pulita) ---
// La logica di inizializzazione viene eseguita una sola volta quando la funzione Vercel si carica
if (!admin.apps.length) {
    try {
        const firebaseConfig = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
        admin.initializeApp({ credential: admin.credential.cert(firebaseConfig) });
    } catch (error) {
        console.error("ERRORE CRITICO: Impossibile inizializzare Firebase Admin SDK. Controlla FIREBASE_SERVICE_ACCOUNT_KEY:", error.message);
        // È fondamentale non bloccare il caricamento della funzione, ma registrare l'errore.
        // db rimarrà non definito e i tentativi di accesso falliranno, ma non blocca l'API per altri scopi.
    }
}
// Se l'inizializzazione è riuscita o era già avvenuta, assegna l'istanza del database
if (admin.apps.length) {
    db = admin.firestore();
}
// --- FINE: INIZIALIZZAZIONE FIRESTORE ADMIN SDK ---

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
        
        // IL NUOVO MOTORE UNIFICATO DI GOOGLE
        const modelId = 'gemini-2.5-flash-image'; 

        // Il nuovo URL per Gemini usa "generateContent" invece di "predict"
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
                    ]
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
                    // --- INIZIO: LOGICA CONTATORE GLOBALE FIRESTORE (con i tuoi nomi personalizzati) ---
                    // Solo se il database è stato inizializzato correttamente all'inizio del file
                    if (db) {
                        try {
                            const globalStatsRef = db.collection('civora_analytics').doc('ai_gen'); // La tua Collezione e Documento

                            await globalStatsRef.update({
                                total_generated_images_ai: admin.firestore.FieldValue.increment(1) // Il tuo Campo
                            });

                        } catch (error) {
                            // Se il documento non esiste (codice 5 per "NotFound"), crealo
                            if (error.code === 5 || (error.details && error.details.includes('not found'))) {
                                try {
                                    // Se il db è stato inizializzato correttamente, possiamo usarlo qui
                                    if (db) {
                                        await db.collection('civora_analytics').doc('ai_gen').set({ // Crea con i tuoi nomi
                                            total_generated_images_ai: 1 // Inizializza il tuo Campo
                                        });
                                    }
                                } catch (setError) {
                                    console.error("Errore nel creare/inizializzare contatore globale (nel catch):", setError);
                                }
                            } else {
                                console.error("Errore nell'incrementare il contatore globale AI:", error);
                            }
                        }
                    } else {
                        console.warn("DB Firebase Admin non inizializzato, contatore globale non aggiornato.");
                    }
                    // --- FINE: LOGICA CONTATORE GLOBALE FIRESTORE ---

                    return res.status(200).json({ imageBase64: `data:image/webp;base64,${returnedImageBase64}` });
                } else {
                    console.error("Risposta anomala da Gemini:", JSON.stringify(data, null, 2));
                    return res.status(500).json({ error: 'Nessuna immagine restituita da Google.' });
                }

            } catch (error) {
                    console.error('Errore Try-Catch (generate-look):', error); // Aggiunto nome funzione per log più chiari
                    return res.status(500).json({ error: 'Errore interno', details: error.message });
                }
            };
