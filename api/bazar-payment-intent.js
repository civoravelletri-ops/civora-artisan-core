const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

// Inizializzazione Firebase Admin
if (!admin.apps.length) {
    const firebaseConfig = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
    admin.initializeApp({ credential: admin.credential.cert(firebaseConfig) });
}
const db = admin.firestore();

// Funzione di utilità per i CORS (importante per le chiamate dal tuo frontend)
function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { action } = req.body;

    try {
        if (action === 'CALCULATE_AND_PAY') {
            return await handleBazarCalculateAndPay(req, res);
        } else if (action === 'FINALIZE_ORDER') {
            return await handleBazarFinalizeOrder(req, res);
        }
        return res.status(400).json({ error: 'Azione sconosciuta' });
    } catch (error) {
        console.error("❌ ERRORE BAZAR:", error);
        // Per debug, puoi mandare più dettagli dell'errore.
        // In produzione, potresti voler inviare un messaggio più generico.
        return res.status(500).json({ error: error.message || 'Errore interno del server.' });
    }
};

async function handleBazarCalculateAndPay(req, res) {
    const { cartItems, vendorId, clientClaimedTotal } = req.body;
    const CIVORA_COMMISSION = 0.03; // Percentuale di commissione Civora

    // Recupera il prodotto dal DB del venditore per una verifica di sicurezza
    const item = cartItems[0]; // Per il Bazar Lampo, c'è sempre un solo articolo
    const productRef = db.collection('vendors').doc(vendorId).collection('products').doc(item.docId);
    const snap = await productRef.get();

    if (!snap.exists) {
        throw new Error("Prodotto non trovato o non più disponibile.");
    }
    const data = snap.data();

    // Calcoli Bazar: Qui il server ricalcola il prezzo da zero
    const netPrice = parseFloat(data.priceNettoVendor || data.price); // Usa priceNettoVendor se esiste, altrimenti il vecchio price
    const deliveryCost = parseFloat(data.deliveryCost || 0);
    const commission = parseFloat((netPrice * CIVORA_COMMISSION).toFixed(2));
    const priceCliente = parseFloat((netPrice + commission).toFixed(2));
    const totalToPay = parseFloat((priceCliente + deliveryCost).toFixed(2));

    // Sicurezza Prezzo: Confronta il prezzo calcolato dal server con quello inviato dal browser
    // Un margine di tolleranza di 1 euro-centesimo (100 in centesimi di Stripe) per floating point issues
    if (Math.abs(totalToPay * 100 - clientClaimedTotal) > 100) {
        console.warn(`DISCREPANZA PREZZO: Calcolato ${totalToPay*100}, ricevuto ${clientClaimedTotal}`);
        throw new Error("Discrepanza nei prezzi rilevata. Riprova l'acquisto.");
    }

    // Inizializzazione del Payment Intent con Stripe
    const vendorData = (await db.collection('vendors').doc(vendorId).get()).data();
    if (!vendorData || !vendorData.stripeAccountId) {
        throw new Error("Il venditore non ha un account Stripe configurato.");
    }

    const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(totalToPay * 100), // Importo in centesimi
        currency: 'eur',
        application_fee_amount: Math.round(commission * 100), // Commissione Civora
        transfer_data: { destination: vendorData.stripeAccountId }, // Trasferisce al venditore
        metadata: {
            vendorId,
            productId: item.docId,
            bazarPriceNetto: netPrice.toString(),
            commissionCivora: commission.toString(),
            deliveryCost: deliveryCost.toString()
        }
    });

    return res.status(200).json({ clientSecret: paymentIntent.client_secret, summary: { realTotal: totalToPay } });
}

async function handleBazarFinalizeOrder(req, res) {
    const { paymentIntentId, vendorId, customerShippingData, orderNotes, purchasedItem } = req.body;

    // VERIFICA DI SICUREZZA FINALE: Chiediamo a Stripe l'importo effettivamente pagato
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (!intent || intent.status !== 'succeeded') {
        throw new Error("Il Payment Intent non è riuscito o non è valido.");
    }
    const soldiVeriPagati = intent.amount / 100; // Importo totale pagato dal cliente

    // Preparazione dei dati per Firestore
    const orderRef = db.collection('orders').doc();
    const orderNumber = `B-${new Date().getTime().toString().slice(-8)}`; // Genera un numero d'ordine

    // Salvataggio dell'ordine in Firebase
    await orderRef.set({
        orderNumber,
        status: 'pending', // Inizialmente in stato 'pending'
        vendorId,
        shippingAddress: customerShippingData,
        orderNotes: orderNotes || '', // Note aggiuntive
        paymentIntentId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(), // Timestamp di creazione
        orderCategory: 'bazar', // Categoria specifica per il Bazar
        totalAmount: soldiVeriPagati, // L'importo totale pagato, VERIFICATO DA STRIPE
        cartItems: purchasedItem ? [purchasedItem] : [] // L'articolo acquistato
    });

    // =======================================================================
    // NOVITÀ: INVIO SMS TRAMITE MACRODROID (corretto per le variabili locali)
    // =======================================================================
    try {
        // Recupero il nome del negozio dal database (per il messaggio SMS)
        const vendorDoc = await db.collection('vendors').doc(vendorId).get();
        const nomeNegozio = vendorDoc.exists ? (vendorDoc.data().store_name || 'Bazar') : 'Bazar';

        // Prendo il numero di telefono del cliente e mi assicuro che abbia il prefisso internazionale
        let numeroCliente = customerShippingData.phone.replace(/\s+/g, ''); // Rimuove eventuali spazi
        if (!numeroCliente.startsWith('+')) {
            numeroCliente = '+39' + numeroCliente; // Aggiunge il prefisso italiano se manca
        }

        // Creo il messaggio SMS
        const messaggioSms = `Ciao da ${nomeNegozio}, grazie per l'acquisto! Il tuo ordine e' in elaborazione. Preparati alla chiamata del corriere per ricevere l'ordine.`;

        // ⚠️ CORREZIONE QUI ⚠️
        // Incolla l'URL COMPLETO del tuo webhook MacroDroid QUI
        // ESEMPIO: "https://trigger.macrodroid.com/51db87e2-5593-48a5-9df5-a59f5dc9cf07/bazar_sms"
        const MACRODROID_WEBHOOK_URL_BASE = "https://trigger.macrodroid.com/51db87e2-5593-48a5-9df5-a59f5dc9cf07/bazar_sms";

        // Costruisco il link per il Webhook di MacroDroid
        // Ora appendiamo i parametri all'URL BASE
        const macrodroidUrl = `${MACRODROID_WEBHOOK_URL_BASE}?phone=${encodeURIComponent(numeroCliente)}&message=${encodeURIComponent(messaggioSms)}`;

        // Spedisco il comando al telefono.
        // Usiamo 'await' per assicurarci che Vercel abbia inviato l'impulso prima di terminare la funzione,
        // ma gestiamo gli errori per non bloccare l'utente se l'SMS fallisce.
        await fetch(macrodroidUrl)
            .then(response => {
                if (!response.ok) {
                    console.warn(`Webhook MacroDroid fallito con status: ${response.status} - ${response.statusText}`);
                    // Puoi leggere la risposta per dettagli: return response.text().then(text => console.warn(text));
                }
            })
            .catch(e => console.error("Errore di rete nell'invio del webhook MacroDroid:", e));

    } catch (smsError) {
        console.error("Errore generale durante l'invio dell'SMS via MacroDroid:", smsError);
        // Continua comunque il flusso di risposta al cliente, l'ordine è già salvato.
    }
    // =======================================================================

    return res.status(200).json({ orderId: orderRef.id, orderNumber });
}
