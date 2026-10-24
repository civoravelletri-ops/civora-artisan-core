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
            
                        const GATEWAY_BASE_URL = (process.env.CIVORA_WHATSAPP_GATEWAY_URL || 'https://civora-whatsapp-gateway.onrender.com').replace(/\/+$/, '');
            
                        // Funzione rapida per spedire messaggi diretti tramite il server Render
                        async function sendWhatsAppMessage(replyText) {
                            try {
                                await fetch(`${GATEWAY_BASE_URL}/send-message`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        vendorId: vendorId,
                                        phone: senderJid || senderPhone,
                                        message: replyText
                                    })
                                });
                            } catch (sendErr) {
                                console.error("[AutoPilot Gateway] Errore invio:", sendErr.message);
                            }
                        }
            
                        // -------------------------------------------------------------
                        // 🤵 IL RAGAZZO: RACCOLTA DATI ISTANTANEA (IN PARALLELO)
                        // -------------------------------------------------------------
                        const [clientTipsDoc, servicesSnap, productsSnap, clientSnap, chatHistorySnap, trainingDoc, collaboratorsSnap, chatProfileDoc] = await Promise.all([
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
            
                            // 6. Pacchetto Addestramento & Clone
                            db.collection('vendors').doc(vendorId).collection('personal_ai_chat').doc('Training').get().catch(() => ({ exists: false })),
            
                            // 7. 👥 Squadra del Salone (Collaboratori e Staff)
                            db.collection('vendors').doc(vendorId).collection('collaborators').where('isActive', '==', true).get().catch(() => ({ docs: [] })),
            
                            // 8. 📁 Fascicolo Chat Personale del Numero di Telefono
                            db.collection('vendors').doc(vendorId).collection('whatsapp_chats').doc(cleanPhone).get().catch(() => ({ exists: false }))
                        ]);
            
                        // =========================================================================
                        // 🎯 RICONOSCIMENTO IMMEDIATO NOME CLIENTE
                        // =========================================================================
                        let isKnownClient = false;
                        let clientFirstName = "";
                        let clientFullName = "";
                        let clientNotesFormula = "";
                        let isVip = false;
            
                        if (!clientSnap.empty) {
                            const cData = clientSnap.docs[0].data();
                            isKnownClient = true;
                            clientFirstName = (cData.name || "").trim();
                            clientFullName = `${clientFirstName} ${cData.surname || ''}`.trim();
                            clientNotesFormula = cData.notes || "";
                            isVip = Array.isArray(cData.tags) && cData.tags.includes('VIP');
                        } else if (pushName && pushName.length >= 2 && !pushName.includes("@")) {
                            clientFirstName = pushName.trim().split(" ")[0];
                            clientFullName = pushName.trim();
                        }
            
                        const storeName = vendorData.store_name || vendorData.owner_name || "il nostro salone";
                        const chatDocRef = db.collection('vendors').doc(vendorId).collection('whatsapp_chats').doc(cleanPhone);
                        const messagesCol = chatDocRef.collection('messages');
            
                        // Formattatore orario leggibile per lo storico chat
                        const nowRomeStr = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
            
                        const chatData = (chatProfileDoc && chatProfileDoc.exists) ? (chatProfileDoc.data() || {}) : null;
                        const currentConsent = chatData ? chatData.aiConsentStatus : null;
            
                        // =========================================================================
                        // 🚦 CASO 1: PRIMISSIMO CONTATTO (FASCICOLO NON ESISTE O NESSUN CONSENSO)
                        // =========================================================================
                        if (!chatData || !currentConsent) {
                            // Registra subito la scheda del cliente nel database
                            await chatDocRef.set({
                                phone: cleanPhone,
                                customerName: clientFullName || pushName || 'Cliente',
                                firstContactAt: admin.firestore.FieldValue.serverTimestamp(),
                                firstContactDate: nowRomeStr,
                                aiConsentStatus: 'pending',
                                pendingInitialMessage: messageText,
                                lastMessage: messageText,
                                updatedAt: admin.firestore.FieldValue.serverTimestamp()
                            }, { merge: true });
            
                            // Salva il messaggio ricevuto
                            await messagesCol.add({
                                role: 'user',
                                content: messageText,
                                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                                dateTimeRome: nowRomeStr
                            });
            
                            // Messaggio veloce, sintetico e trasparente
                            const greetingName = clientFirstName ? `Ciao ${clientFirstName}! 👋` : `Ciao! 👋`;
                            const firstContactMsg = `${greetingName}\nSono l'assistente virtuale con Intelligenza Artificiale di *${storeName}*, addestrata dal titolare per darti informazioni, gestire prenotazioni e ordini.\n\nPer continuare:\n1️⃣ Digita *1* per chattare con me subito\n2️⃣ Digita *2* per attendere la risposta del titolare in persona`;
            
                            await sendWhatsAppMessage(firstContactMsg);
            
                            await messagesCol.add({
                                role: 'assistant',
                                content: firstContactMsg,
                                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                                dateTimeRome: nowRomeStr
                            });
            
                            return res.status(200).json({ success: true, status: "consent_requested", phone: cleanPhone });
                        }
            
                        // =========================================================================
                        // 🚦 CASO 2: IL CLIENTE È IN ATTESA E STA DIGITANDO 1 OPPURE 2
                        // =========================================================================
                        if (currentConsent === 'pending') {
                            const cleanedAnswer = messageText.trim().toLowerCase();
                            const isAccept = /^(1|uno|si|sì|ok|accetto|1️⃣)$/i.test(cleanedAnswer);
                            const isDecline = /^(2|due|no|rifiuto|2️⃣)$/i.test(cleanedAnswer);
            
                            // Salva il messaggio della risposta (es. "1" o "2")
                            await messagesCol.add({
                                role: 'user',
                                content: messageText,
                                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                                dateTimeRome: nowRomeStr
                            });
            
                            if (isDecline) {
                                await chatDocRef.set({
                                    aiConsentStatus: 'declined',
                                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                                }, { merge: true });
            
                                const declineMsg = `Perfetto, nessun problema! 👤 Ho avvisato il titolare: ti risponderà personalmente appena possibile. A presto!`;
                                await sendWhatsAppMessage(declineMsg);
            
                                await messagesCol.add({
                                    role: 'assistant',
                                    content: declineMsg,
                                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                                    dateTimeRome: nowRomeStr
                                });
            
                                return res.status(200).json({ success: true, status: "consent_declined" });
                            }
            
                            if (!isAccept) {
                                // Non ha digitato né 1 né 2: promemoria veloce
                                const remindMsg = `Per poterti assistere, digita *1* per chattare con l'assistente IA oppure *2* per attendere il titolare. 😊`;
                                await sendWhatsAppMessage(remindMsg);
            
                                await messagesCol.add({
                                    role: 'assistant',
                                    content: remindMsg,
                                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                                    dateTimeRome: nowRomeStr
                                });
            
                                return res.status(200).json({ success: true, status: "consent_reminded" });
                            }
            
                            // Ha digitato 1 (ACCETTATO!): Sblocca il consenso e ripesca la sua domanda originaria
                            await chatDocRef.set({
                                aiConsentStatus: 'accepted',
                                consentAcceptedAt: admin.firestore.FieldValue.serverTimestamp(),
                                updatedAt: admin.firestore.FieldValue.serverTimestamp()
                            }, { merge: true });
            
                            const originalQuestion = chatData.pendingInitialMessage || messageText;
                            console.log(`[AutoPilot] 🟢 Consenso ACCETTATO da ${cleanPhone}! Riprendo la domanda: "${originalQuestion}"`);
            
                            // Istruiamo l'IA a confermare con calore l'accoglienza e rispondere subito alla domanda iniziale
                            messageText = `[SISTEMA: Il cliente ha appena premuto 1 accettando l'assistente IA. Salutalo con calore ed entusiasmo dicendogli che sei pronta, e rispondi subito alla domanda che aveva fatto prima: "${originalQuestion}"]`;
                        }
            
                        // =========================================================================
                        // 🚦 CASO 3: SE IL CLIENTE AVEVA SCELTO DI PARLARE SOLO CON L'UMANO
                        // =========================================================================
                        if (currentConsent === 'declined') {
                            console.log(`[AutoPilot] 🛑 Chat gestita manualmente per ${cleanPhone}. Pilota IA in pausa.`);
                            return res.status(200).json({ status: "skipped", reason: "Chat gestita manualmente dal titolare" });
                        }
            
                        // =========================================================================
                        // 🚀 CASO 4: CONSENSO ATTIVO! IL CERVELLO DELL'IA ENTRA IN AZIONE
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
            
                        const storeAddress = vendorData.address || "in salone";
                        const storeHours = vendorData.public_opening_hours || vendorData.opening_hours || "Orari standard";
                        const specializations = (vendorData.customization_specializations || []).join(', ');
                        
                        const tipsData = clientTipsDoc.exists ? clientTipsDoc.data() : {};
                        const parkingInfo = tipsData.parkingTips || "";
                        const directionsInfo = tipsData.directions || "";
            
                        const servicesNameMap = new Map();
                        servicesSnap.docs.forEach(d => {
                            const s = d.data();
                            if (s.productName) servicesNameMap.set(d.id, s.productName);
                        });
            
                        const servicesList = servicesSnap.docs
                            .map(d => d.data())
                            .filter(s => s.productName && s.isAvailable !== false)
                            .map(s => `- ${s.productName}: ${s.price}€ (${s.totalOccupiedTimeMinutes || s.serviceDuration || 30} min)`)
                            .slice(0, 25)
                            .join('\n');
            
                        const productsList = productsSnap.docs
                            .map(d => d.data())
                            .filter(p => p.productName || p.name)
                            .map(p => `- ${p.productName || p.name}${p.brand ? ` (${p.brand})` : ''}: ${p.price || 0}€`)
                            .slice(0, 15)
                            .join('\n');
            
                        // Squadra del salone
                        const teamEntries = [];
                        const ownerName = vendorData.owner_name || vendorData.store_name || "Titolare";
                        const ownerJob = vendorData.owner_job_title ? ` (${vendorData.owner_job_title})` : '';
                        const ownerSpecs = vendorData.owner_specialties ? `\n  - Specializzazioni: ${vendorData.owner_specialties}` : '';
                        const ownerBio = vendorData.owner_bio ? `\n  - Bio: ${vendorData.owner_bio}` : '';
                        const ownerAiNotes = vendorData.owner_ai_notes ? `\n  - Istruzioni IA: ${vendorData.owner_ai_notes}` : '';
                        
                        let ownerServs = "Tutti i servizi del salone";
                        if (Array.isArray(vendorData.servicesOffered) && vendorData.servicesOffered.length > 0) {
                            const mapped = vendorData.servicesOffered.map(id => servicesNameMap.get(id)).filter(Boolean);
                            if (mapped.length > 0) ownerServs = mapped.join(', ');
                        }
                        teamEntries.push(`• 👑 ${ownerName}${ownerJob} [Titolare Principale]:\n  - Servizi che esegue: ${ownerServs}${ownerSpecs}${ownerBio}${ownerAiNotes}`);
            
                        if (collaboratorsSnap.docs && collaboratorsSnap.docs.length > 0) {
                            collaboratorsSnap.docs.forEach(doc => {
                                const c = doc.data();
                                const cRole = (c.role === 'owner') ? '👑 Socio / Co-Titolare' : '✂️ Staff / Collaboratore';
                                const cJob = c.jobTitle ? ` (${c.jobTitle})` : '';
                                const cSpecs = c.specialties ? `\n  - Specializzazioni: ${c.specialties}` : '';
                                const cBio = c.bio ? `\n  - Bio: ${c.bio}` : '';
                                const cAiNotes = c.aiNotes ? `\n  - Istruzioni IA: ${c.aiNotes}` : '';
            
                                let cServs = "Servizi standard del salone";
                                if (Array.isArray(c.servicesOffered) && c.servicesOffered.length > 0) {
                                    const mapped = c.servicesOffered.map(id => servicesNameMap.get(id)).filter(Boolean);
                                    if (mapped.length > 0) cServs = mapped.join(', ');
                                }
                                teamEntries.push(`• ${cRole}: ${c.name}${cJob}\n  - Servizi che esegue: ${cServs}${cSpecs}${cBio}${cAiNotes}`);
                            });
                        }
                        const teamListFormatted = teamEntries.join('\n\n');
            
                        let customerRecognitionGuideline = "";
                        if (isKnownClient) {
                            customerRecognitionGuideline = `STAI PARLANDO CON UN CLIENTE ABITUALE REGISTRATO: "${clientFullName}"${isVip ? ' (CLIENTE VIP ⭐️)' : ''}.
            - REGOLE DI ACCOGLIENZA: Salutalo calorosamente per nome (es. "Ciao ${clientFirstName}!"). Sa già chi siete!
            - Trattalo con grande confidenza, affetto e calore da persona di casa.
            ${clientNotesFormula ? `- NOTE TECNICHE/FORMULE DEL CLIENTE: "${clientNotesFormula}"` : ''}`;
                        } else if (clientFirstName) {
                            customerRecognitionGuideline = `STAI PARLANDO CON UN CLIENTE DI NOME: "${clientFirstName}". Sii accogliente e caloroso.`;
                        } else {
                            customerRecognitionGuideline = `STAI PARLANDO CON UN CLIENTE NUOVO. Sii impeccabilmente gentile, accogliente e professionale.`;
                        }
            
                        let conversationHistory = [];
                        if (chatHistorySnap.docs && chatHistorySnap.docs.length > 0) {
                            conversationHistory = chatHistorySnap.docs.map(doc => ({
                                role: doc.data().role === 'assistant' ? 'assistant' : 'user',
                                content: doc.data().content
                            })).reverse();
                        }
            
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
            2. Sei l'assistente virtuale ufficiale del salone, trasparente, efficiente e con il calore del titolare.
            3. Se chiedono prezzi o trattamenti, usa ESCLUSIVAMENTE quelli presenti nel listino dati qui sotto. Zero sconti inventati.
            4. COMPRENDI LO SLANG: Capisci al volo espressioni colloquiali o dialettali ("al volo", "un buco", "sfumatura", "fresco", "a che ora staccate") e rispondi con calore e naturalezza.
            5. CONOSCI LA SQUADRA: Se chiedono chi lavora nel salone, quanti siete, chi esegue determinati servizi o chi è specializzato in cosa, rispondi con precisione usando ESCLUSIVAMENTE i dati della squadra riportati qui sotto.
            
            ============================================================
            PROFILO DEL CLIENTE CHE TI HA SCRITTO:
            ============================================================
            ${customerRecognitionGuideline}
            
            ============================================================
            PACCHETTO 2: DATI REALI DEL NEGOZIO E SQUADRA (FATTI VERI)
            ============================================================
            DATI ATTIVITÀ:
            - Nome Salone: ${storeName}
            - Indirizzo esatto: ${storeAddress}
            - Orari di apertura: ${storeHours}
            ${specializations ? `- Specializzazioni: ${specializations}` : ''}
            ${parkingInfo ? `- Info Parcheggio: ${parkingInfo}` : ''}
            ${directionsInfo ? `- Indicazioni stradali: ${directionsInfo}` : ''}
            
            SQUADRA E STAFF DEL SALONE (CHI LAVORA QUI E COSA FA):
            ${teamListFormatted}
            
            MENU SERVIZI E PREZZI DISPONIBILI:
            ${servicesList || "Listino trattamenti disponibile in salone."}
            
            PRODOTTI IN VENDITA DISPONIBILI:
            ${productsList || "Prodotti professionali disponibili in negozio."}`;
            
                        const messagesPayload = [
                            { role: "system", content: systemPrompt },
                            ...conversationHistory,
                            { role: "user", content: messageText }
                        ];
            
                        let aiReply = `Ciao ${clientFullName || ''}! Come posso aiutarti oggi da ${storeName}?`;
            
                        const GROQ_CANDIDATES = [
                            "llama-3.3-70b-versatile",
                            "llama-3.1-8b-instant",
                            "openai/gpt-oss-120b",
                            "llama3-8b-8192"
                        ];
            
                        for (const modelId of GROQ_CANDIDATES) {
                            try {
                                const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                                    method: "POST",
                                    headers: {
                                        "Authorization": `Bearer ${(GROQ_API_KEY || '').trim()}`,
                                        "Content-Type": "application/json"
                                    },
                                    body: JSON.stringify({
                                        model: modelId,
                                        messages: messagesPayload,
                                        temperature: 0.3,
                                        max_tokens: 300
                                    })
                                });
            
                                if (groqRes.ok) {
                                    const groqData = await groqRes.json();
                                    const content = groqData.choices?.[0]?.message?.content?.trim();
                                    if (content) {
                                        aiReply = content;
                                        console.log(`[AutoPilot] ✅ Risposta generata con successo da Groq (${modelId})!`);
                                        break;
                                    }
                                } else {
                                    console.warn(`[Groq Info] Modello ${modelId} non attivo sulla chiave, provo il successivo...`);
                                }
                            } catch (aiErr) {
                                console.warn(`[AutoPilot] Tentativo fallito su ${modelId}:`, aiErr.message);
                            }
                        }
            
                        // 💾 Salvataggio messaggi e aggiornamento scheda cliente con data e ora precisa
                        try {
                            await Promise.all([
                                messagesCol.add({
                                    role: 'user',
                                    content: (currentConsent === 'pending') ? (chatData.pendingInitialMessage || 'Accettazione IA') : messageText,
                                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                                    dateTimeRome: nowRomeStr
                                }),
                                messagesCol.add({
                                    role: 'assistant',
                                    content: aiReply,
                                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                                    dateTimeRome: nowRomeStr
                                }),
                                chatDocRef.set({
                                    phone: cleanPhone,
                                    customerName: clientFullName || pushName || 'Cliente',
                                    lastMessage: aiReply,
                                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                                    lastActiveDate: nowRomeStr
                                }, { merge: true })
                            ]);
                        } catch (memErr) {
                            console.warn("[Memoria Chat] Errore salvataggio:", memErr.message);
                        }
            
                        // 🚀 Invio risposta al Gateway WhatsApp
                        await sendWhatsAppMessage(aiReply);
                        console.log(`[AutoPilot] 🚀 Risposta inviata al cliente "${clientFullName || cleanPhone}"!`);
            
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
