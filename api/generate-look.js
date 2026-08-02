const { GoogleAuth } = require('google-auth-library');
// --- INIZIO: AGGIUNTE PER FIRESTORE ADMIN SDK ---
const admin = require('firebase-admin');
let firebaseAdminApp; // Dichiarazione per l'istanza dell'app Firebase Admin
// --- FINE: AGGIUNTE PER FIRESTORE ADMIN SDK ---

// --- INIZIO: AUTOPILOTA DINAMICO MODELLI ---
// Questa variabile rimarrà in memoria su Vercel finché l'istanza è attiva ("warm").
// Se l'applicazione si riavvia, ripartirà da questo valore predefinito.
let currentModelId = 'gemini-3.1-flash-image';

/**
 * Recupera in tempo reale tutti i modelli attivi da Google Vertex AI,
 * analizza i nomi e seleziona il modello più recente e compatibile.
 */
async function getBestActiveModel(projectId, accessToken, currentTarget) {
    try {
        const listUrl = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models`;
        const res = await fetch(listUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!res.ok) {
            console.warn("Impossibile contattare la lista dei modelli Vertex. Codice stato:", res.status);
            return currentTarget; // Fallback al modello corrente se la lista non risponde
        }

        const data = await res.json();
        // Estrae i nomi dei modelli rimuovendo il percorso completo
        const availableModels = (data.publisherModels || []).map(m => m.name.split('/').pop());

        if (availableModels.length === 0) {
            return currentTarget;
        }

        // Se il modello target originale è ancora attivo e valido, manteniamolo
        if (availableModels.includes(currentTarget)) {
            return currentTarget;
        }

        // Se il modello originale è spento, cerchiamo il miglior sostituto.
        // Diamo priorità a modelli dedicati alle immagini (flash-image)
        let candidates = availableModels.filter(name => name.includes('flash-image'));

        // Se non esistono modelli "flash-image", passiamo a quelli "flash" generici (multimodali)
        if (candidates.length === 0) {
            candidates = availableModels.filter(name => name.includes('flash'));
        }

        // Se ancora non troviamo nulla, prendiamo un qualsiasi modello "gemini"
        if (candidates.length === 0) {
            candidates = availableModels.filter(name => name.startsWith('gemini'));
        }

        if (candidates.length === 0) {
            return currentTarget;
        }

        // Ordiniamo i candidati estraendo la versione numerica (es. "3.5", "2.5") per prendere il più alto/nuovo
        candidates.sort((a, b) => {
            const getVersion = (name) => {
                const match = name.match(/(\d+\.\d+|\d+)/);
                return match ? parseFloat(match[0]) : 0;
            };
            return getVersion(b) - getVersion(a);
        });

        return candidates[0]; // Restituiamo il modello più aggiornato
    } catch (err) {
        console.error("Errore generico durante l'auto-scoperta dei modelli:", err.message);
        return currentTarget; // In caso di errore di rete, restituiamo il target per sicurezza
    }
}
// --- FINE: AUTOPILOTA DINAMICO MODELLI ---

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
        return res.status(200).json({ message: "BINGO! Motore acceso (Versione GEMINI AUTOPILOTE DYNAMIC)!" });
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
        const location = 'global';
        
        // Determiniamo il modello da usare partendo dalla variabile in memoria
        let modelId = currentModelId;

        // ATTENZIONE: per il server "global" l'URL ha un formato diverso!
        let url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`;

        const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");
        const detectedMimeType = imageBase64.match(/^data:(image\/[a-z]+);base64,/);
        const finalMimeType = detectedMimeType ? detectedMimeType[1] : "image/webp";

        // Verifichiamo se è stata inviata anche una referenceImageBase64
        const { referenceImageBase64 } = req.body;

        let partsForGemini = [
            {
                text: prompt
            },
            {
                inlineData: {
                    mimeType: finalMimeType,
                    data: cleanBase64
                }
            }
        ];

        // Se c'è una foto di riferimento, la aggiungiamo al payload per Gemini
        if (referenceImageBase64) {
            const cleanReferenceBase64 = referenceImageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");
            const detectedReferenceMimeType = referenceImageBase64.match(/^data:(image\/[a-z]+);base64,/);
            const finalReferenceMimeType = detectedReferenceMimeType ? detectedReferenceMimeType[1] : "image/jpeg";

            partsForGemini.push({
                inlineData: {
                    mimeType: finalReferenceMimeType,
                    data: cleanReferenceBase64
                }
            });
        }

        const payload = {
            contents: [{
                role: "user",
                parts: partsForGemini
            }],
            generationConfig: {
                responseModalities: ["TEXT", "IMAGE"]
            }
        };

        // Eseguiamo la prima richiesta con il modello corrente
        let response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        let data = await response.json();

        // --- SISTEMA DI AUTOPILOTA / RECUPERO AUTOMATICO ---
        // Se Google risponde con un errore che fa presupporre l'inattività del modello (es. 404 o 400)
        if (!response.ok && (response.status === 404 || response.status === 400)) {
            console.warn(`Tentativo con il modello ${modelId} fallito (Status: ${response.status}). Avvio recupero automatico...`);
            
            // Chiamiamo la funzione per determinare il miglior modello attivo in questo istante
            const recoveredModelId = await getBestActiveModel(projectId, accessToken, 'gemini-3.1-flash-image');

            // Se il modello consigliato è diverso da quello che ha appena dato errore, procediamo al recupero
            if (recoveredModelId && recoveredModelId !== modelId) {
                console.log(`Rilevato nuovo modello attivo compatibile: ${recoveredModelId}. Riprovo la chiamata...`);
                
                // Aggiorniamo la cache in memoria globale e locale
                currentModelId = recoveredModelId;
                modelId = recoveredModelId;

                // Ricostruiamo l'indirizzo con il nuovo modello
                url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`;

                // Rieseguiamo la chiamata a Google
                response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                data = await response.json();
            }
        }
        // --------------------------------------------------

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
            // --- INIZIO: LOGICA CONTATORE GLOBALE FIRESTORE ADMIN ---
            if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
                try {
                    // Inizializza Firebase Admin SDK solo una volta per istanza della funzione
                    if (!firebaseAdminApp) {
                        const decodedCredentialsString = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8');
                        const adminCredentials = JSON.parse(decodedCredentialsString);
                        firebaseAdminApp = admin.initializeApp({
                            credential: admin.credential.cert(adminCredentials)
                        }, 'globalCounterApp');
                    }
                    const db = admin.firestore(firebaseAdminApp);

                    const globalStatsRef = db.collection('civora_analytics').doc('ai_gen');

                    // Tentiamo di aggiornare il documento
                    await globalStatsRef.update({
                        total_generated_images_ai: admin.firestore.FieldValue.increment(1)
                    });

                } catch (error) {
                    // Se il documento non esiste, crealo
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
