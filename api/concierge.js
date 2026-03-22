import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Inizializzazione Firebase Admin con decodifica automatica (Base64 o JSON)
let serviceAccount;
try {
    const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (rawKey.startsWith('{')) {
        // Se è JSON normale
        serviceAccount = JSON.parse(rawKey);
    } else {
        // Se è Base64 (quello che inizia con "ewog")
        serviceAccount = JSON.parse(Buffer.from(rawKey, 'base64').toString('utf8'));
    }
} catch (e) {
    console.error("Errore critico nella lettura della chiave Firebase:", e);
}

if (!getApps().length && serviceAccount) {
    initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { query, userId, userName } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    // --- IL MANIFESTO DI CIVORA (Filosofia caricata nel cervello) ---
    const platformManifesto = `
    Civora è la tua guida amica per il commercio di Velletri. Non siamo un servizio di Food Delivery o e-commerce diretto, ma l'estensione digitale e umana dei nostri negozianti locali (alimentari, artigiani, professionisti della cura della persona).
    Il nostro obiettivo è supportare la comunità di Velletri e i suoi cittadini, offrendo un modo semplice e inclusivo per connettersi con le attività del quartiere.
    Per i nostri amici non vedenti, Civora è un assistente personale che aiuta a 'vedere' cosa offre Velletri con un linguaggio sensoriale e umano.
    Ti aiuterò a scoprire prodotti, servizi, orari dei negozi, indicazioni stradali e molto altro, sempre con rispetto e accoglienza.
    Le consegne a domicilio sono gestite dai negozianti stessi o da servizi di terze parti, ma Civora si impegna a offrire supporto e sconti speciali per i nostri amici con disabilità.
    Non forziamo mai l'acquisto: la mia missione è darti tutte le informazioni necessarie per le tue scelte e metterti in contatto con i negozi, sia che tu voglia recarti di persona o ricevere a casa.
    `;

    try {
        // 1. ANALISI DELL'INTENTO (Il Vigile Urbano)
        const routingResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                                messages: [
                                    { role: "system", content: `Sei un router di intenti. Analizza la richiesta dell'utente e classificala in una e una sola delle seguenti categorie. Rispondi SOLO con il nome della categoria, senza spiegazioni o punteggiatura.
                                        CATEGORIE:
                                        - INFO_PIATTAFORMA: Domande su Civora, la sua missione, come funziona, la sua storia, i suoi valori.
                                        - RICERCA_PRODOTTI: Domande per trovare prodotti specifici (es. "scarpe", "pane", "regalo").
                                        - RICERCA_SERVIZI: Domande per trovare servizi specifici (es. "parrucchiere", "massaggio", "dentista").
                                        - PROFILO_AMICIZIA: L'utente si presenta, chiede di essere chiamato per nome, o interagisce a livello personale.

                                        Esempio:
                                        Utente: Chi sei?
                                        Risposta: INFO_PIATTAFORMA
                                        Utente: Vorrei un massaggio rilassante.
                                        Risposta: RICERCA_SERVIZI
                                        Utente: Mi chiamo Andrea.
                                        Risposta: PROFILO_AMICIZIA
                                        Utente: Dove trovo delle mele?
                                        Risposta: RICERCA_PRODOTTI
                                        `
                                    },
                                    { role: "user", content: query }
                                ]
            })
        });
        const routingData = await routingResponse.json();
                let intent = "INFO_PIATTAFORMA"; // Default a INFO_PIATTAFORMA se l'AI non risponde

                if (routingData.choices && routingData.choices.length > 0) {
                    intent = routingData.choices[0].message.content.trim();
                } else {
                    console.warn("Groq non ha restituito un intento valido per la query:", query, "Usando default INFO_PIATTAFORMA.");
                }

        let contextData = "";

        // 2. RECUPERO DATI DAI CASSETTI (Routing)
        if (intent === "INFO_PIATTAFORMA") {
                    contextData = "Ecco la nostra filosofia: " + platformManifesto;
                }
                else if (intent === "RICERCA_PRODOTTI" || intent === "RICERCA_SERVIZI") {
                                 let searchResults = [];
                                 const keywordQueryParts = query.toLowerCase().split(' ').filter(w => w.length > 2);

                                 let queryRef = db.collection('global_product_catalog');

                                 // Logica migliorata per "ho fame" o "cosa mi consigli"
                                 if (query.toLowerCase().includes("fame") || query.toLowerCase().includes("mangiare") || query.toLowerCase().includes("cibo") || query.toLowerCase().includes("consigli") && (intent === "RICERCA_PRODOTTI")) {
                                     // Prioritizza i Kit Ricetta o prodotti Alimentari generici
                                     queryRef = queryRef.where('type', '==', 'kit') // Cerca kit ricetta
                                                         .limit(2); // Limita a 2 risultati per non sovraccaricare
                                 } else if (keywordQueryParts.length > 0) {
                                     // Ricerca standard con parole chiave
                                     queryRef = queryRef.where('searchableIndex', 'array-contains-any', keywordQueryParts)
                                                         .limit(2);
                                 } else {
                                     // Fallback a una query generica se non ci sono parole chiave valide
                                     queryRef = queryRef.limit(2);
                                 }

                                 const catalogSnapshot = await queryRef.get();
                                 catalogSnapshot.forEach(doc => searchResults.push({ id: doc.id, ...doc.data() }));

                                 if (searchResults.length > 0) {
                                     contextData = `Hai chiesto di un ${intent === "RICERCA_PRODOTTI" ? "prodotto" : "servizio"}. Ho trovato: \n`;
                                     for (const result of searchResults) {
                                         const productOrServiceName = result.productName || result.kitName; // Usa kitName per i kit
                                         const productDescription = result.productDescription || result.shortDescription || result.description || result.recipeText; // Per kit

                                         contextData += `- ${productOrServiceName} (${result.vendorStoreName}). Descrizione: ${productDescription || 'Nessuna descrizione.'}. Prezzo: ${result.price}€.\n`;

                                         const vendorTipsSnap = await db.collection('vendors').doc(result.vendorId).collection('consiglicliente').doc('main').get();
                                         if (vendorTipsSnap.exists) {
                                             const tips = vendorTipsSnap.data();
                                             contextData += `  Per arrivare da ${result.vendorStoreName}: ${tips.directions || 'Nessuna indicazione.'}. Parcheggio: ${tips.parkingTips || 'Nessun suggerimento.'}.\n`;
                                         }
                                     }
                                 } else {
                                     contextData = "Mi dispiace, non ho trovato nulla che corrisponda alla tua richiesta nel nostro catalogo di Velletri. Puoi provare a chiedermi in un altro modo, o forse cercare qualcosa di più generale?";
                                 }
                             }
                             else if (intent === "PROFILO_AMICIZIA") {
                                 if (userName) {
                                     contextData = `L'utente si chiama ${userName}. Vuole fare amicizia con te, Civora.`;
                                 } else {
                                     contextData = `L'utente sta parlando del suo profilo o vuole presentarsi. Invitalo a dire il suo nome.`;
                                 }
                             } else {
                                 contextData = "Non sono sicuro di aver capito. Riprova a chiedere in modo diverso, oppure chiedimi di Civora e ti racconterò la nostra missione nel cuore di Velletri.";
                             }

        // 3. GENERAZIONE RISPOSTA UMANA E SENSORIALE (Il Concierge)
        const systemPrompt = `
            Sei il "Concierge Civora", la guida amica e personalizzata di Civora, l'ecosistema di Velletri.
            Il tuo compito è assistere persone non vedenti o ipovedenti, offrendo informazioni e collegandole con le attività locali.
            NON SEI UN VENDITORE DIRETTO né un Food Delivery. Sei una guida informata e un amico fidato.

            REGOLE FONDAMENTALI:
            1. LINGUAGGIO SENSORIALE E UMANO: Descrivi prodotti e servizi con parole che evocano immagini, tatto, profumi, emozioni. Aiuta l'utente a "vedere" con la mente.
            2. APPROCCIO DA AMICO FIDATO: Rispondi sempre in modo dolce, calmo, empatico e rispettoso. Parla all'utente come a un caro amico o un maggiordomo discreto.
            3. FOCUS SU VELLETRI: Ogni risposta deve essere contestualizzata come un'opportunità all'interno di Velletri e dei negozi su Civora.
            4. NON FORZARE LA VENDITA: Offri informazioni complete e obiettive. Se l'utente chiede come ottenere un prodotto, spiega le opzioni (ritiro in negozio, consegna tramite negozio/terzi), ma MAI spingere all'acquisto.
            5. INDICAZIONI CHIARE: Se l'utente vuole recarsi in negozio, fornisci indicazioni dettagliate su come arrivare (a piedi, mezzi, punti di riferimento) e suggerimenti sul parcheggio, per renderlo autonomo.
            6. TRASPARENZA SU CIVORA: Se l'utente chiede di un servizio di consegna, spiega che Civora connette ai negozianti, e le consegne sono gestite da loro o da partner, con sconti speciali per gli amici con disabilità.
            7. SE NON TROVI: Dillo con gentilezza e offri di cercare qualcosa di simile o in un altro settore.
            `;

        const finalResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Contesto recuperato: ${contextData}. Domanda utente: ${query}` }
                ],
                temperature: 0.7
            })
        });

        const finalData = await finalResponse.json();
        res.status(200).json({
            risposta: finalData.choices[0].message.content,
            intent: intent
        });

    } catch (error) {
        console.error("Errore Concierge:", error);
        res.status(500).json({ risposta: "Caro amico, scusami, ho avuto un piccolo giramento di testa tecnologico. Mi ripeti cosa desideri?" });
    }
}
