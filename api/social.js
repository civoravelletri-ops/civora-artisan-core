const admin = require('firebase-admin');
const { GoogleAuth } = require('google-auth-library');

// Inizializzazione Firebase Admin
if (!admin.apps.length) {
    try {
        let rawKey = (process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '').trim();
        if (!rawKey.startsWith('{')) {
            rawKey = Buffer.from(rawKey, 'base64').toString('utf8');
        }
        const serviceAccount = JSON.parse(rawKey);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('[Firebase Admin] ✅ Inizializzato con successo su social.js!');
    } catch (err) {
        console.error('[Firebase Admin Error] Errore inizializzazione:', err.message);
    }
}

let db;
try {
    db = admin.firestore();
} catch (dbErr) {
    console.error('[Firebase Admin DB Error]:', dbErr.message);
}

// 🔑 Helper per autenticazione ufficiale con Google Cloud Vertex AI
async function getVertexAuthContext() {
    if (!process.env.GOOGLE_CREDENTIALS) return null;
    try {
        let rawCreds = process.env.GOOGLE_CREDENTIALS.trim();
        if (!rawCreds.startsWith('{')) {
            rawCreds = Buffer.from(rawCreds, 'base64').toString('utf8');
        }
        const credentials = JSON.parse(rawCreds);
        const auth = new GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });
        const client = await auth.getClient();
        const accessToken = (await client.getAccessToken()).token;
        const projectId = credentials.project_id || process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_PROJECT_ID;
        const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
        return { accessToken, projectId, location };
    } catch (e) {
        console.warn('[Vertex Auth Error]:', e.message);
        return null;
    }
}

// 🧠 Motore di chiamata AI (ESATTAMENTE COME IL TUO ORIGINALE)
async function callAiCompletion({ messages, temperature, max_tokens }) {
    // 1. TENTATIVO CON GOOGLE VERTEX AI
    const vertex = await getVertexAuthContext();
    if (vertex) {
        const { accessToken, projectId, location } = vertex;
        const vertexUrl = `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${projectId}/locations/${location}/endpoints/openapi/chat/completions`;
        const vertexModels = ["google/gemini-1.5-flash", "google/gemini-2.0-flash", "gemini-1.5-flash"];

        for (const model of vertexModels) {
            try {
                const res = await fetch(vertexUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: messages,
                        temperature: temperature || 0.35,
                        max_tokens: max_tokens || 500
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    return data;
                }
            } catch (vErr) {}
        }
    }

    // 2. PARACADUTE SU GROQ (Ripristinati i tuoi modelli originali)
    const groqKey = (process.env.GROQ_API_KEY || '').trim();
    if (groqKey) {
        const groqModels = ["openai/gpt-oss-20b", "openai/gpt-oss-120b"];
        for (const model of groqModels) {
            try {
                const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${groqKey}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: messages,
                        temperature: temperature || 0.3,
                        max_tokens: Math.min(max_tokens || 300, 300)
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    return data;
                }
            } catch (gErr) {}
        }
    }
    return null;
}

module.exports = async function handler(req, res) {
    // Permessi CORS originali
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        // Controllo di sicurezza sul body
        let body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { body = {}; }
        }

        const contesto = body.contesto;
        if (!contesto) {
            return res.status(400).json({ errore: "Dati di contesto mancanti nella richiesta." });
        }

        // =========================================================
        // 🔒 BLOCCO COPYWRITER MARKETING PER I POST (ORIGINALE)
        // =========================================================
        
        let systemPrompt = `Sei un Senior Social Media Copywriter da Agenzia di Marketing di Lusso. Crea post magnetici per promuovere servizi e prodotti. Rispondi solo con il testo del post.`;
        
        let userPromptText = `Dati: Negozio: "${contesto.store_name || 'Salone'}", Servizio: "${contesto.nome || 'Servizio'}", Prezzo: ${contesto.prezzo || '0'}€, Link: ${contesto.link_shop || 'https://www.civora.it'}`;
        
        // Aggiungo il pezzettino per i bottoni "Regalo/Promo" che hai sul gestionale
        if (contesto.note_extra) {
            userPromptText += `, Note extra: ${contesto.note_extra}`;
        }

        const postAiData = await callAiCompletion({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPromptText }
            ],
            temperature: 0.2,
            max_tokens: 500
        });

        const postOutput = postAiData?.choices?.[0]?.message?.content || "";
        
        if (!postOutput) {
            throw new Error("L'Intelligenza Artificiale non ha restituito alcun testo.");
        }

        res.status(200).json({ post: postOutput.trim() });

    } catch (error) {
        console.error("[api/social.js] Errore critico:", error);
        res.status(500).json({ errore: "Errore interno del server: " + error.message });
    }
};
