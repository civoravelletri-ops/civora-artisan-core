const admin = require('firebase-admin');

// Inizializzazione ultra-sicura: decodifica automaticamente sia JSON normale che Base64 ("ewog...")
if (!admin.apps.length) {
    try {
        let rawKey = (process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '').trim();
        
        // Se inizia con "ewog" o non inizia con "{", è un Base64 e lo decifriamo
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

module.exports = async function handler(req, res) {
    // Permessi CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const body = req.body || {};
        const GROQ_API_KEY = process.env.GROQ_API_KEY;

        if (!GROQ_API_KEY) {
            return res.status(500).json({ errore: "Manca la chiave d'accesso GROQ_API_KEY nelle variabili d'ambiente di Vercel." });
        }

        // =========================================================================
        // 🟢 BLOCCO WHATSAPP AUTOPILOT (BUTTAFUORI + MAGGIORDOMO INTELLIGENTE)
        // =========================================================================
        if (body.isWhatsAppAutoPilot && body.vendorId) {
            const vendorId = body.vendorId;
            const senderPhone = body.senderPhone || '';
            const senderJid = body.senderJid || senderPhone;
            const messageText = (body.messageText || "").trim();
            const pushName = (body.pushName || "").trim();

            if (!messageText) {
                return res.status(200).json({ status: "skipped", reason: "Messaggio vuoto" });
            }

            // -------------------------------------------------------------
            // 💂‍♂️ IL BUTTAFUORI INCORRUTTIBILE (Controllo Permessi)
            // -------------------------------------------------------------
            const vendorDoc = await db.collection('vendors').doc(vendorId).get();
            if (!vendorDoc.exists) {
                console.log(`[Buttafuori] 🛑 Salone ${vendorId} non trovato.`);
                return res.status(200).json({ status: "skipped", reason: "Salone inesistente" });
            }

            const vendorData = vendorDoc.data() || {};
            const isWaConnected = vendorData.whatsapp_connected === true;
            const isAutoPilotOn = vendorData.whatsapp_ai_autopilot === true;

            if (!isWaConnected || !isAutoPilotOn) {
                console.log(`[Buttafuori] 🛑 Accesso negato per ${vendorId}. Connesso: ${isWaConnected}, Pilota IA: ${isAutoPilotOn}`);
                return res.status(200).json({ 
                    status: "skipped", 
                    reason: "Pilota automatico o WhatsApp disattivati dal negoziante" 
                });
            }

            console.log(`[Buttafuori] 🟢 VIA LIBERA per "${vendorData.store_name || vendorId}". Chiamo il Maggiordomo...`);

            // -------------------------------------------------------------
            // 🤵 IL MAGGIORDOMO: RACCOLTA DATI ISTANTANEA (IN PARALLELO)
            // -------------------------------------------------------------
            let cleanPhone = senderPhone.replace(/\D/g, '');
            if (!cleanPhone.startsWith('39') && cleanPhone.length === 10) cleanPhone = '39' + cleanPhone;

            const phoneVariants = Array.from(new Set([
                senderPhone,
                cleanPhone,
                `+${cleanPhone}`,
                cleanPhone.startsWith('39') ? cleanPhone.substring(2) : cleanPhone
            ].filter(Boolean)));

            // Esegue tutte le letture del database in contemporanea (circa 50ms)
                        const [clientTipsDoc, servicesSnap, productsSnap, clientSnap, chatHistorySnap, trainingDoc] = await Promise.all([
                            // 1. Consigli salone (parcheggi e indicazioni)
                            db.collection('vendors').doc(vendorId).collection('consiglicliente').doc('main').get().catch(() => ({ exists: false })),
                            
                            // 2. Menu Servizi del salone
                            db.collection('artisan_services').where('vendorId', '==', vendorId).get().catch(() => ({ docs: [] })),
                            
                            // 3. Vetrina Prodotti
                            db.collection('offers').where('vendorId', '==', vendorId).get().catch(() => ({ docs: [] })),
                            
                            // 4. Controllo Rubrica Salone
                            db.collection('vendors').doc(vendorId).collection('clients')
                                .where('phone', 'in', phoneVariants.slice(0, 10))
                                .limit(1).get().catch(() => ({ empty: true })),
                            
                            // 5. Memoria ultimi messaggi chat
                            db.collection('vendors').doc(vendorId).collection('whatsapp_chats').doc(cleanPhone)
                                .collection('messages').orderBy('timestamp', 'desc').limit(6).get().catch(() => ({ docs: [] })),
            
                            // 6. 🧠 NUOVO: Pacchetto Addestramento & Clone (personal_ai_chat -> Training)
                            db.collection('vendors').doc(vendorId).collection('personal_ai_chat').doc('Training').get().catch(() => ({ exists: false }))
                        ]);
            
                        // =========================================================================
                        // PACCHETTO 1: ISTRUZIONI, PERSONALITÀ & MENTE DEL TITOLARE (IL CLONE)
                        // =========================================================================
                        const trainingData = (trainingDoc && trainingDoc.exists) ? trainingDoc.data() : null;
                        const hasCustomTraining = trainingData && trainingData.ai_ethics_accepted === true;
            
                        let personalityDirectives = "";
                        if (hasCustomTraining) {
                            if (trainingData.compiled_ai_persona) {
                                personalityDirectives = trainingData.compiled_ai_persona;
                            } else {
                                const soulWords = trainingData.ai_owner_soul_notes ? `\n- SLANG E MODO DI PARLARE NATURALE DEL TITOLARE: ${trainingData.ai_owner_soul_notes}` : '';
                                const strictRules = trainingData.ai_strict_rules ? `\n- REGOLE FERREE / PALETTI INVALICABILI: ${trainingData.ai_strict_rules}` : '';
                                personalityDirectives = `${soulWords}${strictRules}\n- RADAR RELAZIONALE ATTIVO: Adatta calore e confidenza in base a chi ti scrive (massima confidenza con gli amici in rubrica, accoglienza esplorativa con i numeri nuovi).`;
                            }
                        } else {
                            personalityDirectives = `Rispondi con calore, naturalezza e massima educazione come una receptionist impeccabile.`;
                        }
            
                        // =========================================================================
                        // PACCHETTO 2: DATI REALI, CATALOGO & INFORMAZIONI DI FATTO (IL NEGOZIO)
                        // =========================================================================
                        const storeName = vendorData.store_name || vendorData.owner_name || "il nostro salone";
                        const storeAddress = vendorData.address || "in salone";
                        const storeHours = vendorData.public_opening_hours || vendorData.opening_hours || "Orari standard";
                        const specializations = (vendorData.customization_specializations || []).join(', ');
                        
                        const tipsData = clientTipsDoc.exists ? clientTipsDoc.data() : {};
                        const parkingInfo = tipsData.parkingTips || "";
                        const directionsInfo = tipsData.directions || "";
            
                        // Listino Servizi Reali
                        const servicesList = servicesSnap.docs
                            .map(d => d.data())
                            .filter(s => s.productName && s.isAvailable !== false)
                            .map(s => `- ${s.productName}: ${s.price}€ (${s.totalOccupiedTimeMinutes || s.serviceDuration || 30} min)`)
                            .slice(0, 20)
                            .join('\n');
            
                        // Prodotti Reali
                        const productsList = productsSnap.docs
                            .map(d => d.data())
                            .filter(p => p.productName || p.name)
                            .map(p => `- ${p.productName || p.name}${p.brand ? ` (${p.brand})` : ''}: ${p.price || 0}€`)
                            .slice(0, 15)
                            .join('\n');
            
                        // =========================================================================
                                    // 🎯 RADAR PSICOLOGICO: RICONOSCIMENTO IMMEDIATO DEL CLIENTE
                                    // =========================================================================
                                    let isKnownClient = false;
                                    let clientFirstName = "";
                                    let clientFullName = "";
                                    let clientNotesFormula = "";
                                    let isVip = false;

                                    if (!clientSnap.empty) {
                                        // 1. TROVATO NELLA RUBRICA CIVORA (CLIENTE ABITUALE)
                                        const cData = clientSnap.docs[0].data();
                                        isKnownClient = true;
                                        clientFirstName = (cData.name || "").trim();
                                        clientFullName = `${clientFirstName} ${cData.surname || ''}`.trim();
                                        clientNotesFormula = cData.notes || "";
                                        isVip = Array.isArray(cData.tags) && cData.tags.includes('VIP');
                                    } else if (pushName && pushName.length >= 2 && !pushName.includes("@")) {
                                        // 2. NUOVO SU CIVORA, MA HA IL NOME SU WHATSAPP
                                        clientFirstName = pushName.trim().split(" ")[0];
                                        clientFullName = pushName.trim();
                                    }

                                    // Istruzioni psicologiche di accoglienza per l'IA
                                    let customerRecognitionGuideline = "";
                                    if (isKnownClient) {
                                        customerRecognitionGuideline = `STAI PARLANDO CON UN CLIENTE ABITUALE REGISTRATO: "${clientFullName}"${isVip ? ' (CLIENTE VIP ⭐️)' : ''}.
                        - REGOLE DI ACCOGLIENZA: Salutalo subito calorosamente per nome fin dalla prima parola (es. "Ciao ${clientFirstName}!").
                        - NON presentare il salone come se fosse la prima volta (sa già chi siete!).
                        - Trattalo con grande confidenza, affetto e calore da persona di casa.
                        ${clientNotesFormula ? `- NOTE TECNICHE/FORMULE DEL CLIENTE: "${clientNotesFormula}" (Se chiede cosa ha fatto l'altra volta o vuole ripetere il servizio, fagli riferimento a questa formula).` : ''}`;
                                    } else if (clientFirstName) {
                                        customerRecognitionGuideline = `STAI PARLANDO CON UN NUOVO CLIENTE, MA CONOSCI IL SUO NOME DA WHATSAPP: "${clientFirstName}".
                        - REGOLE DI ACCOGLIENZA: Dagli un caloroso benvenuto a nome del salone usando subito il suo nome di battesimo (es. "Ciao ${clientFirstName}! Benvenuto da ${storeName}!").
                        - Mostrati felice di accoglierlo ed esplora con dolcezza cosa desidera fare.`;
                                    } else {
                                        customerRecognitionGuideline = `STAI PARLANDO CON UN NUMERO SCONOSCIUTO (Nessun nome registrato).
                        - REGOLE DI ACCOGLIENZA: Dagli un caloroso benvenuto a nome del salone (es. "Ciao e benvenuto da ${storeName}! Come possiamo aiutarti oggi?").
                        - Sii impeccabilmente gentile, accogliente e rassicurante.`;
                                    }

                                    // Storico Conversazione
                                    let conversationHistory = [];
                                    if (chatHistorySnap.docs && chatHistorySnap.docs.length > 0) {
                                        conversationHistory = chatHistorySnap.docs.map(doc => ({
                                            role: doc.data().role === 'assistant' ? 'assistant' : 'user',
                                            content: doc.data().content
                                        })).reverse();
                                    }

                                    // -------------------------------------------------------------
                                    // 🧠 FUSIONE DEI DUE PACCHETTI NEL CERVELLO DELL'IA
                                    // -------------------------------------------------------------
                                    const nowRome = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
                                    const todayRome = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Rome' });

                                    const systemPrompt = `Sei l'assistente virtuale ufficiale del salone "${storeName}" su WhatsApp.
                        Oggi è ${todayRome}, ore ${nowRome}.

                        ============================================================
                        PACCHETTO 1: CHI SEI E COME DEVI PARLARE (PERSONALITÀ E ISTRUZIONI)
                        ============================================================
                        ${personalityDirectives}

                        REGOLE FERREE DI COMUNICAZIONE:
                        1. Rispondi SEMPRE in massimo 2 o 3 frasi brevi, naturali e facili da leggere su smartphone.
                        2. Sii trasparente: sei l'assistente del salone con il carattere e il calore del titolare.
                        3. Se chiedono prezzi o trattamenti, usa ESCLUSIVAMENTE quelli presenti nel listino dati qui sotto. Zero sconti inventati.
                        4. COMPRENDI LO SLANG: Capisci al volo espressioni colloquiali o dialettali ("al volo", "un buco", "sfumatura", "fresco", "a che ora staccate") e rispondi con calore e naturalezza.

                        ============================================================
                        PROFILO DEL CLIENTE CHE TI HA SCRITTO:
                        ============================================================
                        ${customerRecognitionGuideline}

                        ============================================================
                        PACCHETTO 2: DATI REALI DEL NEGOZIO (FATTI VERI)
                        ============================================================
                        DATI ATTIVITÀ:
                        - Nome Salone: ${storeName}
                        - Indirizzo esatto: ${storeAddress}
                        - Orari di apertura: ${storeHours}
                        ${specializations ? `- Specializzazioni: ${specializations}` : ''}
                        ${parkingInfo ? `- Info Parcheggio: ${parkingInfo}` : ''}
                        ${directionsInfo ? `- Indicazioni stradali: ${directionsInfo}` : ''}

                        MENU SERVIZI E PREZZI DISPONIBILI:
                        ${servicesList || "Listino trattamenti disponibile in salone."}

                        PRODOTTI IN VENDITA DISPONIBILI:
                        ${productsList || "Prodotti professionali disponibili in negozio."}`;

            const messagesPayload = [
                { role: "system", content: systemPrompt },
                ...conversationHistory,
                { role: "user", content: messageText }
            ];

            // Chiamata all'Intelligenza Artificiale (Groq - Llama 3.3)
            let aiReply = `Ciao ${clientFullName}! Ti ringraziamo per averci scritto da ${storeName}. Come possiamo aiutarti oggi?`;

            try {
                const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${GROQ_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: "llama-3.3-70b-versatile",
                        messages: messagesPayload,
                        temperature: 0.4,
                        max_tokens: 300
                    })
                });

                if (groqRes.ok) {
                    const groqData = await groqRes.json();
                    aiReply = groqData.choices?.[0]?.message?.content?.trim() || aiReply;
                } else {
                    console.error("[Groq Error]", await groqRes.text());
                }
            } catch (aiErr) {
                console.error("[AutoPilot] Errore chiamata Groq:", aiErr.message);
            }

            // -------------------------------------------------------------
            // 💾 SALVATAGGIO MEMORIA CHAT NELLA CARTELLA DEL SALONE
            // -------------------------------------------------------------
            try {
                const chatDocRef = db.collection('vendors').doc(vendorId).collection('whatsapp_chats').doc(cleanPhone);
                const messagesCol = chatDocRef.collection('messages');

                await Promise.all([
                    messagesCol.add({
                        role: 'user',
                        content: messageText,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    }),
                    messagesCol.add({
                        role: 'assistant',
                        content: aiReply,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    }),
                    chatDocRef.set({
                        phone: cleanPhone,
                        customerName: clientFullName,
                        lastMessage: aiReply,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true })
                ]);
            } catch (memErr) {
                console.warn("[Memoria Chat] Errore salvataggio:", memErr.message);
            }

            // -------------------------------------------------------------
            // 🚀 INVIO RISPOSTA AL SERVER RENDER (IL POSTINO)
            // -------------------------------------------------------------
            const GATEWAY_BASE_URL = (process.env.CIVORA_WHATSAPP_GATEWAY_URL || 'https://civora-whatsapp-gateway.onrender.com').replace(/\/+$/, '');
            
            try {
                await fetch(`${GATEWAY_BASE_URL}/send-message`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        vendorId: vendorId,
                        phone: senderJid || senderPhone,
                        message: aiReply
                    })
                });
                console.log(`[AutoPilot] 🚀 Risposta inviata al cliente "${clientFullName}" (${cleanPhone})!`);
            } catch (sendErr) {
                console.error("[AutoPilot] Errore invio Gateway Render:", sendErr.message);
            }

            return res.status(200).json({ success: true, client: clientFullName, reply: aiReply });
        }

        // =========================================================================
        // 🔒 BLOCCO COPYWRITER MARKETING PER I POST (INTATTO E SIGILLATO)
        // =========================================================================
        const contesto = body.contesto;
        if (!contesto) {
            return res.status(400).json({ errore: "Dati di contesto mancanti nella richiesta." });
        }

        let systemPrompt = `Sei un Senior Social Media Copywriter da Agenzia di Marketing di Lusso. Crea post magnetici per promuovere servizi e prodotti. Rispondi solo con il testo del post.`;
        let userPromptText = `Dati: Negozio: "${contesto.store_name || 'Salone'}", Servizio: "${contesto.nome || 'Servizio'}", Prezzo: ${contesto.prezzo || '0'}€, Link: ${contesto.link_shop || 'https://www.civora.it'}`;

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPromptText }
                ],
                temperature: 0.2,
                max_tokens: 800
            })
        });

        const data = await response.json();
        const postOutput = data.choices?.[0]?.message?.content || "";
        res.status(200).json({ post: postOutput.trim() });

    } catch (error) {
        console.error("[api/social.js] Errore critico:", error);
        res.status(500).json({ errore: "Errore interno del server: " + error.message });
    }
};
