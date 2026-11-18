import { GoogleAuth } from 'google-auth-library';

let googleAuthClient = null;

async function getGoogleAuth() {
    const rawCreds = process.env.GOOGLE_CREDENTIALS;
    if (!rawCreds) throw new Error("GOOGLE_CREDENTIALS mancante nelle variabili d'ambiente di Vercel");

    const credentials = typeof rawCreds === 'string' && rawCreds.trim().startsWith('{')
        ? JSON.parse(rawCreds)
        : JSON.parse(Buffer.from(rawCreds, 'base64').toString('utf8'));

    if (!googleAuthClient) {
        googleAuthClient = new GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });
    }
    const client = await googleAuthClient.getClient();
    const token = (await client.getAccessToken()).token;
    return { token, projectId: credentials.project_id };
}

async function imageToGeminiPart(urlOrBase64) {
    if (!urlOrBase64 || typeof urlOrBase64 !== 'string') return null;

    if (urlOrBase64.startsWith('data:image/')) {
        const match = urlOrBase64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
        if (match) {
            return { inlineData: { mimeType: match[1], data: match[2] } };
        }
    }

    if (urlOrBase64.startsWith('http://') || urlOrBase64.startsWith('https://')) {
            let host = '';
            try {
                host = new URL(urlOrBase64).hostname.toLowerCase();
            } catch (e) {
                return null;
            }
            if (
                host === 'localhost' ||
                host.startsWith('127.') ||
                host.startsWith('10.') ||
                host.startsWith('192.168.') ||
                host.startsWith('169.254.') ||
                /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
                host === '::1' ||
                host.endsWith('.local')
            ) {
                return null;
            }
            const imgRes = await fetch(urlOrBase64, { signal: AbortSignal.timeout(12000) });
        if (!imgRes.ok) throw new Error(`Errore download immagine (${imgRes.status})`);
        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
        const mimeType = contentType.split(';')[0].trim();
        const arrayBuf = await imgRes.arrayBuffer();
        return {
            inlineData: {
                mimeType: mimeType,
                data: Buffer.from(arrayBuf).toString('base64')
            }
        };
    }
    return null;
}

async function callGeminiVertex({ systemPrompt, messages = [], imageUrls = [], temperature = 0.4, maxTokens = 1500, expectJson = false, retryAttempt = 0 }) {
    const { token, projectId } = await getGoogleAuth();
    const location = 'us-central1';
    const modelId = 'gemini-3.5-flash-lite';
    const url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`;

    const contents = [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const parts = [{ text: msg.content || '' }];

        if (i === messages.length - 1 && msg.role !== 'assistant' && imageUrls.length > 0) {
            for (const imgUrl of imageUrls) {
                try {
                    const imgPart = await imageToGeminiPart(imgUrl);
                    if (imgPart) parts.push(imgPart);
                } catch (e) {
                    console.warn('[Gemini Giudizio] Immagine saltata:', e.message);
                }
            }
        }

        contents.push({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: parts
        });
    }

    const generationConfig = {
        temperature: temperature,
        maxOutputTokens: maxTokens
    };
    if (expectJson) {
        generationConfig.responseMimeType = 'application/json';
    }

    const payload = {
        contents: contents,
        generationConfig: generationConfig,
        safetySettings: [
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' }
        ]
    };

    if (systemPrompt) {
        payload.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (res.status === 429 && retryAttempt < 2) {
        console.warn(`[Gemini 429 Auto-Retry] Attendo 2s e riprovo (Tentativo ${retryAttempt + 1})...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return callGeminiVertex({ systemPrompt, messages, imageUrls, temperature, maxTokens, expectJson, retryAttempt: retryAttempt + 1 });
    }

    if (!res.ok) {
        const details = await res.text();
        throw new Error(`Gemini API Error (${res.status}): ${details}`);
    }

    const data = await res.json();
    return (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

const ALLOWED_ORIGINS = [
    'https://localmente-v3-core.web.app',
    'https://localmente-v3-core.firebaseapp.com',
    'https://localmente-site.web.app',
    'https://localmente-site.firebaseapp.com',
    'https://www.civora.it',
    'https://civora.it'
];

export default async function handler(req, res) {
    const origin = req.headers.origin;
    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (req.headers.host && (req.headers.host.includes('localhost') || req.headers.host.includes('127.0.0.1'))) {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const payload = req.body;
        const action = payload.action || 'giudizio';

        // =====================================================================================
        // AZIONE 1 (PRIORITÀ): IL GIUDIZIO DEL CONCIERGE (CON GEMINI 3.5 FLASH-LITE)
        // =====================================================================================
        if (action === 'giudizio') {
            const productData = payload;
            const imagesToAnalyze = productData.allImages && productData.allImages.length > 0
                ? productData.allImages.slice(0, 3)
                : (productData.imageUrl ? [productData.imageUrl] : []);

            const promptSystem = `Sei l'AI Core di Civora. Il tuo compito è analizzare i dati visivi e testuali per aiutare il negoziante o il cliente.
REGOLE DI ANALISI:
1. Se l'input contiene TRASCRIZIONI DI APPUNTI o REGOLE: Il tuo "summary" deve essere la lista pulita e ordinata di quelle regole per addestrare l'assistente Jonny.
2. Se l'input riguarda un PRODOTTO: Comportati come un Concierge onesto, osservando le immagini (se presenti) e descrivendo il valore reale con pregi (pros) e cose da considerare (cons).
3. Se vedi dati ARTIGIANALI: Enfatizza l'unicità e il lavoro manuale.
4. DEVI SEMPRE RISPONDERE SOLO CON UN OGGETTO JSON VALIDO.

Formato JSON:
{
    "summary": "Contenuto principale (regole estratte o giudizio breve sul prodotto)...",
    "pros": ["Punto di forza 1", "Punto di forza 2"],
    "cons": ["Eventuale limite o cosa da considerare"]
}`;

            const promptUser = `Dati del prodotto:
- Nome: ${productData.productName}
- Categoria: ${productData.productCategory}
- Marca: ${productData.brand || 'Artigianale/Non specificata'}
- Prezzo: €${productData.price}
- Condizione: ${productData.condition || 'new'}
- Descrizione Negoziante: ${productData.shortDescription || productData.productDescription || 'Nessuna'}`;

            let rawJsonText = await callGeminiVertex({
                systemPrompt: promptSystem,
                messages: [{ role: 'user', content: promptUser }],
                imageUrls: imagesToAnalyze,
                temperature: 0.5,
                maxTokens: 1200,
                expectJson: true
            });

            rawJsonText = rawJsonText.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
            const start = rawJsonText.indexOf('{');
            const end = rawJsonText.lastIndexOf('}');
            if (start !== -1 && end !== -1) rawJsonText = rawJsonText.substring(start, end + 1);

            const aiJudgmentJSON = JSON.parse(rawJsonText);
            return res.status(200).json(aiJudgmentJSON);
        }

        // =====================================================================================
        // AZIONE 2: IL CERVELLO DELL'ASSISTENTE (ESTRAZIONE DATI E MEMORIA)
        // =====================================================================================
        else if (action === 'formatta_regole_ai') {
            const { testo_grezzo, memoria_precedente } = payload;

            const promptSystem = `Sei un analista di dati per negozi. Il tuo compito è AGGIORNARE il cervello di un assistente digitale.
Riceverai nuove istruzioni dal negoziante e dovrai unirle a quelle vecchie.

DEVI RISPONDERE ESCLUSIVAMENTE CON UN OGGETTO JSON.

Campi da estrarre/aggiornare:
- store_owner: Nome del titolare.
- phone_fixed: Numero di telefono fisso.
- whatsapp: Numero WhatsApp.
- email_business: Email per i clienti.
- compiled_instructions: Tutto il resto delle regole (prezzi, orari, info) formattate in HTML <ul><li> chiaro e professionale.

REGOLE:
- Se un dato (es. whatsapp) non è presente nel testo nuovo ma c'era nel vecchio, MANTIENI il vecchio.
- Se il testo nuovo dà un nuovo numero, SOSTITUISCI il vecchio.
- compiled_instructions deve essere un unico blocco HTML che unisce tutto in modo logico.`;

            const promptUser = `MEMORIA ATTUALE (JSON): ${memoria_precedente || '{}'}\n\nNUOVE ISTRUZIONI: ${testo_grezzo}`;

            let rawJsonText = await callGeminiVertex({
                systemPrompt: promptSystem,
                messages: [{ role: 'user', content: promptUser }],
                temperature: 0.2,
                maxTokens: 2048,
                expectJson: true
            });

            rawJsonText = rawJsonText.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
            const start = rawJsonText.indexOf('{');
            const end = rawJsonText.lastIndexOf('}');
            if (start !== -1 && end !== -1) rawJsonText = rawJsonText.substring(start, end + 1);

            return res.status(200).json({ risultato: JSON.parse(rawJsonText) });
        }

        // =====================================================================================
        // AZIONE 3: CHAT AI CONCIERGE (VENDITA E PREVENTIVI REAL-TIME CON TRIS)
        // =====================================================================================
        else if (action === 'ai_concierge_chat') {
            const { chatHistory, serviceName, vendorName, rawInstructions, isTrisActive, deliveryStrategy } = payload;

            let logisticInstructions = "";
            if (isTrisActive) {
                logisticInstructions = `
✅ IL MODELLO TRIS È ATTIVO PER QUESTO NEGOZIO.
Spiega al cliente che può pagare ora e:
- Se è una riparazione: Un Rider passerà a ritirare l'oggetto a casa (Logistica: ${deliveryStrategy}).
- Se sono fotocopie/documenti: Può caricare i file subito dopo il pagamento per trovarli già stampati ed evitare la fila.
- Specifica che la sicurezza del ritiro è garantita da contenitori con lucchetto anti-manomissione.`;
            } else {
                logisticInstructions = `
❌ IL MODELLO TRIS NON È ATTIVO.
Informa il cliente che dopo il pagamento dovrà recarsi fisicamente in negozio per consegnare l'oggetto o ritirare il lavoro.`;
            }

            const promptSystem = `Sei l'AI Concierge di Civora per il negozio "${vendorName}".
Servizio richiesto: "${serviceName}".

MANUALE PREZZI E REGOLE DEL NEGOZIO:
${rawInstructions}

ISTRUZIONI LOGISTICHE DA COMUNICARE:
${logisticInstructions}

⚠️ REGOLE DI CHIUSURA VENDITA:
1. Tu NON processi pagamenti. Il tuo compito è convincere il cliente e generare il preventivo finale.
2. Il tuo UNICO modo per far procedere il cliente al pagamento è scrivere il comando:[PRENOTA:valore]
3. Quando il cliente accetta il prezzo, spiegagli i vantaggi logistici (TRIS o Salva-fila) e scrivi SEMPRE il comando[PRENOTA:valore] alla fine del messaggio.
4. NON inventare prezzi. Se non sono nel manuale, chiedi dettagli al cliente per calcolarli.
5. Usa un tono da "Commesso Esperto": cordiale, rassicurante e professionale.`;

            const recentHistory = Array.isArray(chatHistory) ? chatHistory.slice(-15) : [];
            const rispostaAI = await callGeminiVertex({
                systemPrompt: promptSystem,
                messages: recentHistory,
                temperature: 0.5,
                maxTokens: 1200,
                expectJson: false
            });

            return res.status(200).json({ risultato: rispostaAI });
        }

                                        // =====================================================================================
                                                // AZIONE 4: INVIO SMS OTP TRAMITE MACRODROID (PONTE SMARTPHONE) - AGGIORNATO CON IL TUO URL
                                                // =====================================================================================
                                                else if (action === 'invia-sms-negoziante' || action === 'salva-prenotazione-ai') {
                                                                                            return res.status(410).json({ error: 'Funzione dismessa.' });
                                                                                        }

                                        // Se l'azione non è riconosciuta
                                        else {
                                            return res.status(400).json({ error: 'Azione non riconosciuta' });
                                        }

    } catch (error) {
        console.error("Errore nel Router Civora:", error);
        res.status(500).json({ error: error.message });
    }
}
