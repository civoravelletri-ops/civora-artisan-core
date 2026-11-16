const { GoogleAuth } = require('google-auth-library');

let googleAuthClient = null;

async function getGoogleAuth() {
    const rawCreds = process.env.GOOGLE_CREDENTIALS;
    if (!rawCreds) throw new Error('GOOGLE_CREDENTIALS mancante nelle variabili d\'ambiente di Vercel.');

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
            return {
                inlineData: {
                    mimeType: match[1],
                    data: match[2]
                }
            };
        }
    }

    if (urlOrBase64.startsWith('http://') || urlOrBase64.startsWith('https://')) {
        const imgRes = await fetch(urlOrBase64, { signal: AbortSignal.timeout(12000) });
        if (!imgRes.ok) {
            throw new Error(`Impossibile scaricare immagine (${imgRes.status})`);
        }
        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
        const mimeType = contentType.split(';')[0].trim();
        const arrayBuf = await imgRes.arrayBuffer();
        const base64Data = Buffer.from(arrayBuf).toString('base64');
        return {
            inlineData: {
                mimeType: mimeType,
                data: base64Data
            }
        };
    }

    return null;
}

async function callGeminiMagia({ systemPrompt, userText, imageUrls = [], temperature = 0.4, maxTokens = 2048, expectJson = false, retryAttempt = 0 }) {
    const { token, projectId } = await getGoogleAuth();
    const location = 'us-central1';
    const modelId = 'gemini-3.5-flash-lite';
    const url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`;

    const parts = [{ text: userText }];
    for (const imgUrl of imageUrls) {
        try {
            const imgPart = await imageToGeminiPart(imgUrl);
            if (imgPart) parts.push(imgPart);
        } catch (imgErr) {
            console.warn('[Gemini Magia] Immagine saltata:', imgErr.message);
        }
    }

    const generationConfig = {
        temperature: temperature,
        maxOutputTokens: maxTokens
    };
    if (expectJson) {
        generationConfig.responseMimeType = 'application/json';
    }

    const payload = {
        contents: [{ role: 'user', parts: parts }],
        generationConfig: generationConfig,
        safetySettings: [
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' }
        ]
    };

    if (systemPrompt) {
        payload.systemInstruction = {
            parts: [{ text: systemPrompt }]
        };
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
        return callGeminiMagia({ systemPrompt, userText, imageUrls, temperature, maxTokens, expectJson, retryAttempt: retryAttempt + 1 });
    }

    if (!res.ok) {
        const details = await res.text();
        throw new Error(`Gemini API Error (${res.status}): ${details}`);
    }

    const data = await res.json();
    return (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const { action, contesto } = body;
        const campo = body.campo || "";
        const task = action || campo;

        if (!contesto) {
            return res.status(400).json({ errore: "Dati di contesto mancanti nella richiesta." });
        }

        let systemPrompt = "";
        const currentSector = contesto.settore || "";

        if (currentSector === "cura_persona") {
            systemPrompt = `Sei un copywriter e marketing specialist per saloni di bellezza e cura della persona.
Scrivi testi eleganti, caldi, persuasivi e commerciali in lingua italiana.
Rispondi DIRETTAMENTE con il contenuto richiesto senza introduzioni, senza virgolette e senza spiegazioni.`;
        } else if (currentSector === "veterinario") {
            systemPrompt = `Sei un copywriter per cliniche veterinarie. Tono empatico e professionale in lingua italiana.`;
        } else if (currentSector === "agrigarden") {
            systemPrompt = `Sei l'Assistente Digitale per AgriGarden. Tono rustico e umano in lingua italiana.`;
        } else {
            systemPrompt = `Sei un copywriter commerciale in lingua italiana.`;
        }

        let userPromptContent = '';
        const isAgendaVisionTask = (task === "importazione_agenda_ia" || campo === "importazione_agenda_ia");
        const isProductAutoFillTask = (task === "compila_prodotto_ia" || campo === "compila_prodotto_ia");
        const isSimpleProductVisionTask = (task === "visione_immagine" || campo === "visione_immagine");

        const rawImageUrl = contesto.imageUrl || contesto.imageBase64 || "";
        const imageUrlsList = Array.isArray(contesto.imageUrls)
            ? contesto.imageUrls.filter(Boolean).slice(0, 3)
            : (rawImageUrl ? [rawImageUrl] : []);

        const hasImages = imageUrlsList.length > 0;
        const isVisionCall = isAgendaVisionTask || ((isProductAutoFillTask || isSimpleProductVisionTask) && hasImages);
        const isJsonOutput = (task === "estimate_shipping_attributes" || isAgendaVisionTask || isProductAutoFillTask || isSimpleProductVisionTask);

        // 📸 GESTIONE SPECIALE VISION: IMPORTAZIONE VISIVA AGENDA DA FOTO
        if (isAgendaVisionTask) {
            const currentYear = contesto.currentYear || new Date().getFullYear();

            systemPrompt = `Sei un assistente esperto di OCR e decifratura di agende e calendari per saloni di bellezza e barbieri.
L'anno corrente di riferimento da usare è il ${currentYear}.

REGOLE CRUCIALI:
1. Estrai TUTTI gli appuntamenti visibili nell'immagine dall'inizio alla fine, SENZA OMETTERNE NESSUNO e senza fermarti a metà lista. Controlla ogni colonna, giorno o sezione.
2. Se sull'agenda è indicata una settimana (es. "Settimana dal 28 Ottobre al 3 Novembre"), calcola con precisione il giorno progressivo per ogni riga della tabella:
   - Lunedì = 28 Ottobre -> ${currentYear}-10-28
   - Martedì = 29 Ottobre -> ${currentYear}-10-29
   - Mercoledì = 30 Ottobre -> ${currentYear}-10-30
   - Giovedì = 31 Ottobre -> ${currentYear}-10-31
   - Venerdì = 01 Novembre -> ${currentYear}-11-01
   - Sabato = 02 Novembre -> ${currentYear}-11-02
3. Usa SEMPRE il formato data "YYYY-MM-DD" e l'ora "HH:MM" a 24 ore.
4. Se per un appuntamento non è scritto il nome del cliente ma solo il servizio/lettera, lascia "cliente": "".

Rispondi ESCLUSIVAMENTE con un oggetto JSON valido contenente la chiave "prenotazioni", strutturato esattamente così:
{
  "prenotazioni": [
    {
      "data": "YYYY-MM-DD",
      "ora": "HH:MM",
      "cliente": "Nome del cliente se presente, altrimenti stringa vuota",
      "telefono": "Numero di telefono se presente, altrimenti stringa vuota",
      "servizio": "Nome o abbreviazione del servizio rilevato",
      "note": "Eventuali note o cancellature rilevate, altrimenti stringa vuota"
    }
  ]
}`;
            userPromptContent = `Estrai TUTTI gli appuntamenti presenti in questa foto dell'agenda usando l'anno ${currentYear}, calcolando la data esatta per ogni giorno della settimana. Includi ogni singolo cliente fino alla fine della pagina. Restituisci solo JSON.`;
        }
        // 🛍️ SUPER CERVELLO PRODOTTI: COMPILA TUTTO DA FOTO E/O VOCE
        else if (isProductAutoFillTask) {
            const categorieList = Array.isArray(contesto.categorieDisponibili) ? contesto.categorieDisponibili : [];
            const categorieTesto = categorieList.length > 0
                ? categorieList.map(c => `- "${c.name}" (Sottocategorie: ${(c.subcategories || []).join(', ') || 'nessuna'})`).join('\n')
                : 'Nessuna lista fornita';

            const weightOptions = [
                "Busta / Ultraleggero (Fino a 250g)",
                "Pacco Piccolo (250g - 1kg)",
                "Pacco Medio / Zaino (1kg - 3kg)",
                "Pesante (3kg - 5kg)",
                "Ingombrante (Oltre 5kg)",
                "Fuori Misura / Consegna Dedicata (es. Bici, TV)"
            ];

            systemPrompt = `Sei l'assistente esperto per i negozianti di Civora (Centro Commerciale locale).
Il tuo compito è osservare le immagini del prodotto (se presenti) e/o leggere gli appunti dettati a voce dal negoziante, e compilare in italiano tutti i campi della scheda prodotto in modo preciso, reale e onesto.

REGOLE FONDAMENTALI:
1. NON inventare marche, prezzi o caratteristiche che non vedi nelle foto e che il negoziante non ha detto. Se non sai il prezzo metti null. Se non sai la quantità metti null.
2. Per "productCategory" e "subCategory", scegli ESATTAMENTE uno dei nomi presenti nella lista delle categorie abilitate del negozio (se nessuna è adatta, scegli la più vicina tra quelle disponibili).
3. Per "condition", usa SOLO uno di questi valori: "new", "used_like_new", "used_good", "refurbished". (Se non è specificato usato o ricondizionato, metti "new").
4. Per "weight_class", scegli ESATTAMENTE una di queste 6 opzioni:
${weightOptions.map(w => `   - "${w}"`).join('\n')}
5. Compila "variantGroupLabel", "subVariantLabel", "productColors" e "productSizes" SOLO se il negoziante ha menzionato varianti/taglie/colori o se è evidente che ci sono più opzioni (altrimenti lasciali vuoti "").
6. "shortDescription" deve essere massimo 140 caratteri.
7. "productDescription" deve essere chiara, persuasiva ma realistica, in 1-2 paragrafi (max 700 caratteri).
8. Rispondi ESCLUSIVAMENTE con un oggetto JSON valido con questa struttura esatta:
{
  "productName": "Titolo chiaro e commerciale del prodotto",
  "brand": "Marca se visibile o detta, altrimenti stringa vuota",
  "productCategory": "Nome esatto della categoria dalla lista",
  "subCategory": "Nome esatto della sottocategoria dalla lista, o stringa vuota",
  "price": null,
  "quantity": null,
  "condition": "new",
  "weight_class": "Pacco Piccolo (250g - 1kg)",
  "delicato": false,
  "shortDescription": "Slogan breve massimo 140 caratteri",
  "productDescription": "Descrizione completa e utile per il cliente",
  "productTags": "parola1, parola2, parola3, parola4, parola5",
  "keywords": "frase ricerca 1, frase ricerca 2, frase ricerca 3",
  "material": "Materiale principale se noto, altrimenti stringa vuota",
  "dimensions": "Misure o formato se noto, altrimenti stringa vuota",
  "targetAudience": "Uno tra: '', 'Unisex / Tutti', 'Uomo', 'Donna', 'Bambini e Ragazzi', 'Casa e Famiglia', 'Sport e Tempo Libero', 'Animali'",
  "officialColor": "Colore principale dell'articolo se visibile, altrimenti stringa vuota",
  "style": "Stile se rilevante, altrimenti stringa vuota",
  "variantGroupLabel": "",
  "subVariantLabel": "",
  "productColors": "",
  "productSizes": ""
}`;

            const noteUtente = (contesto.noteUtente || contesto.testoVoce || "").trim();
            const infoGiaInserite = [
                contesto.nome ? `Nome già scritto: ${contesto.nome}` : '',
                contesto.marca ? `Marca già scritta: ${contesto.marca}` : '',
                contesto.prezzo ? `Prezzo già scritto: €${contesto.prezzo}` : ''
            ].filter(Boolean).join(' | ');

            userPromptContent = `APPUNTI / VOCE DEL NEGOZIANTE:
${noteUtente || "Nessun appunto vocale fornito, basati sulle immagini."}

${infoGiaInserite ? `DATI GIÀ PRESENTI NEL MODULO:\n${infoGiaInserite}\n` : ''}
CATEGORIE ABILITATE DEL NEGOZIO (SCEGLI SOLO DA QUI):
${categorieTesto}

Analizza tutto e restituisci SOLO il JSON completo.`;
        }
        // 📸 COMPATIBILITÀ BOTTONE SINGOLO "MAGIA DALLA FOTO"
        else if (isSimpleProductVisionTask) {
            systemPrompt = `Sei un esperto di e-commerce locale per Civora. Osserva l'immagine del prodotto e crea titolo e descrizione chiari in italiano.
Rispondi ESCLUSIVAMENTE con un JSON valido:
{
  "titolo": "Nome prodotto chiaro e preciso",
  "descrizione": "Descrizione commerciale chiara e fedele a ciò che si vede nell'immagine (max 600 caratteri)"
}`;
            userPromptContent = "Analizza questa immagine del prodotto e restituisci titolo e descrizione in JSON.";
        } else if (currentSector === "cura_persona") {
            const isProfile = campo.endsWith("_profile");
            const entityName = isProfile ? (contesto.store_name || "questo studio") : (contesto.product_name || "questo servizio");
            const entityType = isProfile ? (contesto.myTypeStore || "salone di bellezza") : "cura della persona";
            const baseInfo = `Attività: "${entityName}" (${entityType}).`;
            const currentText = (contesto.currentFieldValue || "").trim();

            if (campo === "short_description_profile") {
                userPromptContent = `${baseInfo}\nCrea un breve slogan ad effetto (massimo 120 caratteri) che catturi l'attenzione. Rispondi solo con lo slogan.`;
            } else if (campo === "description_profile") {
                userPromptContent = `${baseInfo}\nScrivi una descrizione accogliente ed elegante per i clienti di ESATTAMENTE 2 brevi paragrafi (circa 500-650 caratteri in totale). Non superare i 750 caratteri totali.`;
            } else if (campo === "tags_profile") {
                userPromptContent = `${baseInfo}\nGenera 7-10 parole chiave (tags) separate ESCLUSIVAMENTE da virgola, senza numeri e senza punti elenco. Esempio: bellezza, relax, cura viso, benessere, trattamenti`;
            } else if (campo === "specializations_profile") {
                userPromptContent = `${baseInfo}\nGenera 5-7 specializzazioni chiave separate ESCLUSIVAMENTE da virgola, senza numeri e senza punti elenco. Esempio: Taglio personalizzato, Trattamenti bio, Colore naturale, Modellatura barba`;
            } else {
                userPromptContent = `${baseInfo}\nGenera il contenuto per "${campo}". Testo base: "${currentText}"`;
            }
        } else if (currentSector === "veterinario") {
            if (campo === "short_description_profile_vet") {
                userPromptContent = `Clinica: "${contesto.store_name}". Crea uno slogan accattivante (max 120 caratteri).`;
            } else if (campo === "description_profile_vet") {
                userPromptContent = `Clinica: "${contesto.store_name}". Scrivi una descrizione di 2 brevi paragrafi (max 650 caratteri).`;
            } else if (campo === "tags_profile_vet" || campo === "specializations_profile_vet") {
                userPromptContent = `Clinica: "${contesto.store_name}". Genera 6-8 voci separate da virgola, senza elenchi numerati.`;
            } else {
                userPromptContent = `Genera il contenuto per "${campo}".`;
            }
        } else if (campo === "storia_azienda") {
            userPromptContent = `Riscrivi questa filosofia aziendale per un vivaio: "${(contesto.testo || '').trim()}".`;
        } else if (task === "estimate_shipping_attributes") {
            systemPrompt = `Rispondi ESCLUSIVAMENTE con un JSON valido: {"weight": 3.5, "length": 25, "width": 25, "height": 60}`;
            userPromptContent = `Estima peso e dimensioni per: "${contesto.productName || contesto.nome}".`;
        } else {
            // 🛍️ BOTTONI AI MAGIA SINGOLI PER I PRODOTTI DEL CENTRO COMMERCIALE
            const nome = contesto.nome || contesto.productName || "";
            const categoria = contesto.categoria || contesto.productCategory || "";
            const marca = contesto.marca || contesto.brand || "";
            const prezzo = contesto.prezzo || contesto.price || "";
            const descrizioneAttuale = contesto.descrizione || contesto.shortDescription || "";

            systemPrompt = `Sei un copywriter esperto di e-commerce per negozi locali su Civora.
Scrivi in italiano chiaro, naturale e convincente.
Rispondi DIRETTAMENTE solo con il testo richiesto, senza virgolette, senza introduzioni (es. non scrivere "Ecco il titolo:") e senza spiegazioni.`;

            const schedaInfo = `Prodotto: "${nome}" | Categoria: "${categoria}"${marca ? ` | Marca: "${marca}"` : ''}${prezzo ? ` | Prezzo: €${prezzo}` : ''}${descrizioneAttuale ? ` | Note: "${descrizioneAttuale}"` : ''}`;

            if (task === "titolo") {
                userPromptContent = `${schedaInfo}\nMigliora e rendi chiaro, professionale e appetibile il Titolo di questo prodotto (massimo 70 caratteri). Rispondi solo con il nuovo titolo.`;
            } else if (task === "descrizione_breve") {
                userPromptContent = `${schedaInfo}\nCrea una descrizione breve (slogan) chiara e d'impatto di MASSIMO 140 caratteri. Rispondi solo con lo slogan.`;
            } else if (task === "descrizione_completa") {
                userPromptContent = `${schedaInfo}\nScrivi una descrizione completa e onesta in 2 brevi paragrafi (circa 400-650 caratteri totali) spiegando caratteristiche e vantaggi per chi compra. Non inventare dati tecnici falsi. Rispondi solo con la descrizione.`;
            } else if (task === "tags") {
                userPromptContent = `${schedaInfo}\nGenera 6-8 parole chiave brevi (tags) separate ESCLUSIVAMENTE da virgola (es. regalo, pelle, artigianale, moda, qualità). Niente numeri né punti elenco.`;
            } else if (task === "keywords") {
                userPromptContent = `${schedaInfo}\nGenera 5-7 frasi o termini di ricerca che un cliente digiterebbe per trovare questo prodotto, separati ESCLUSIVAMENTE da virgola. Niente numeri né punti elenco.`;
            } else {
                userPromptContent = `${schedaInfo}\nGenera un contenuto conciso e utile per "${task}".`;
            }
        }

        const imagesToSend = isVisionCall ? imageUrlsList : [];
        const tempToUse = (isAgendaVisionTask || isProductAutoFillTask) ? 0.2 : 0.7;
        const tokensToUse = (isAgendaVisionTask || isProductAutoFillTask) ? 4096 : 1000;

        let testoGenerato = await callGeminiMagia({
            systemPrompt,
            userText: userPromptContent,
            imageUrls: imagesToSend,
            temperature: tempToUse,
            maxTokens: tokensToUse,
            expectJson: isJsonOutput
        });

        if (!testoGenerato) {
            return res.status(500).json({ errore: "Risposta vuota da Gemini." });
        }

        testoGenerato = testoGenerato.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
        testoGenerato = testoGenerato.replace(/^["']+|["']+$/g, "").trim();

        if (isJsonOutput) {
            try {
                const start = testoGenerato.indexOf('{');
                const end = testoGenerato.lastIndexOf('}');
                if (start !== -1 && end !== -1) {
                    testoGenerato = testoGenerato.substring(start, end + 1);
                }
                JSON.parse(testoGenerato);
                return res.status(200).json({ risultato: testoGenerato });
            } catch (e) {
                return res.status(200).json({ risultato: testoGenerato });
            }
        }

        return res.status(200).json({ risultato: testoGenerato });

    } catch (error) {
        console.error("[api/magia.js] Errore:", error);
        res.status(500).json({ errore: "Errore: " + error.message });
    }
};
