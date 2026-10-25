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

// 🧠 Motore di chiamata AI (Google Vertex AI con paracadute Groq)
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
                        temperature: temperature || 0.4,
                        max_tokens: max_tokens || 500
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    console.log(`[Google Vertex AI] ✅ Risposta da ${model}!`);
                    return data;
                }
            } catch (vErr) {
                console.warn(`[Google Vertex AI] Tentativo ${model} fallito:`, vErr.message);
            }
        }
    }

    // 2. PARACADUTE AUTOMATICO SU GROQ
    const groqKey = (process.env.GROQ_API_KEY || '').trim();
    if (groqKey) {
        const groqModels = ["llama3-70b-8192", "mixtral-8x7b-32768"]; // Modelli Groq per il copywriting
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
                        temperature: temperature || 0.4,
                        max_tokens: max_tokens || 500
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    console.log(`[Groq Fallback] ✅ Risposta da ${model}!`);
                    return data;
                }
            } catch (gErr) {}
        }
    }
    return null;
}

module.exports = async function handler(req, res) {
    // Permessi CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const body = req.body || {};
        const contesto = body.contesto;

        if (!contesto) {
            return res.status(400).json({ errore: "Dati di contesto mancanti nella richiesta." });
        }

        // =========================================================
        // 🎨 COPYWRITER MARKETING PER I POST SOCIAL
        // =========================================================
        
        let systemPrompt = `Sei un Senior Social Media Copywriter di un'Agenzia di Marketing di Lusso.
Il tuo obiettivo è creare post magnetici, eleganti ed emozionali per promuovere servizi e prodotti di saloni di bellezza o barbieri.
Usa emoji pertinenti ma senza esagerare.
Struttura il post con:
1. Un gancio iniziale (Hook) accattivante.
2. Il corpo centrale che valorizza il servizio.
3. Una Call to Action (CTA) chiara per invitare a prenotare.
Rispondi SOLO con il testo finale del post, senza aggiungere premesse o commenti.`;

        let userPromptText = `Crea un post per questo servizio:
- Nome Salone: "${contesto.store_name || 'Il nostro Salone'}"
- Nome Servizio: "${contesto.nome || 'Trattamento'}"
- Descrizione Servizio: "${contesto.descrizione || ''}"
- Prezzo: ${contesto.prezzo || '0'}€
- Durata: ${contesto.durata || '30'} minuti
- Link per prenotare: ${contesto.link_shop || 'https://www.civora.it'}`;

        // Se l'utente ha inserito note extra o cliccato le shortcut (Promo, Regalo, ecc.) le aggiungiamo!
        if (contesto.note_extra) {
            userPromptText += `\n\nRICHIESTA SPECIALE DEL NEGOZIANTE: "${contesto.note_extra}". Includi questa indicazione nel post.`;
        }

        const postAiData = await callAiCompletion({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPromptText }
            ],
            temperature: 0.6, // Un po' di creatività per i post
            max_tokens: 500
        });

        const postOutput = postAiData?.choices?.[0]?.message?.content || "C'è stato un problema nella generazione del post. Riprova tra poco.";
        
        res.status(200).json({ post: postOutput.trim() });

    } catch (error) {
        console.error("[api/social.js] Errore critico:", error);
        res.status(500).json({ errore: "Errore interno del server: " + error.message });
    }
};
