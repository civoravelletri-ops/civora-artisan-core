const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

if (!admin.apps.length) {
    const firebaseConfig = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
    admin.initializeApp({ credential: admin.credential.cert(firebaseConfig) });
}
const db = admin.firestore();

// QUESTA FUNZIONE RISOLVE IL PROBLEMA CORS
function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
    setCorsHeaders(res);

    // Gestione obbligatoria per il blocco CORS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

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
        return res.status(500).json({ error: error.message || 'Errore interno del server.' });
    }
};

async function handleBazarCalculateAndPay(req, res) {
    const { cartItems, vendorId, clientClaimedTotal, userId } = req.body;
    const CIVORA_COMMISSION = 0.03;

    const item = cartItems[0];
    const productRef = db.collection('vendors').doc(vendorId).collection('products').doc(item.docId);

    let productData;
    await db.runTransaction(async (transaction) => {
        const productDoc = await transaction.get(productRef);
        if (!productDoc.exists) throw new Error("Prodotto non trovato.");
        productData = productDoc.data();

        const now = admin.firestore.Timestamp.now().toMillis();
        const lockedUntilMs = productData.lockedUntil ? productData.lockedUntil.toMillis() : 0;

        if (productData.status === 'sold') throw new Error("Prodotto già venduto.");
        if (productData.lockedBy !== userId || lockedUntilMs <= now) throw new Error("Priorità scaduta.");
    });

    const netPrice = parseFloat(productData.priceNettoVendor || productData.price);
    const deliveryCost = parseFloat(productData.deliveryCost || 0);
    const commission = parseFloat((netPrice * CIVORA_COMMISSION).toFixed(2));
    const priceCliente = parseFloat((netPrice + commission).toFixed(2));
    const totalToPay = parseFloat((priceCliente + deliveryCost).toFixed(2));

    const vendorData = (await db.collection('vendors').doc(vendorId).get()).data();
    if (!vendorData || !vendorData.stripeAccountId) throw new Error("Vendor Stripe non configurato.");

    const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(totalToPay * 100),
        currency: 'eur',
        application_fee_amount: Math.round(commission * 100),
        transfer_data: { destination: vendorData.stripeAccountId },
        metadata: { vendorId, productId: item.docId, bazarPriceNetto: netPrice.toString(), commissionCivora: commission.toString(), deliveryCost: deliveryCost.toString(), buyerUserId: userId }
    });

    return res.status(200).json({ clientSecret: paymentIntent.client_secret });
}

async function handleBazarFinalizeOrder(req, res) {
    const { paymentIntentId, vendorId, productId, userId, customerShippingData, orderNotes, deliveryNotesForRider } = req.body;

    let productRef = db.collection('vendors').doc(vendorId).collection('products').doc(productId);
    let finalProductData;

    await db.runTransaction(async (transaction) => {
        const productDoc = await transaction.get(productRef);
        if (!productDoc.exists) {
            await stripe.refunds.create({ payment_intent: paymentIntentId });
            throw new Error("Prodotto non trovato.");
        }
        finalProductData = productDoc.data();
        transaction.update(productRef, {
            status: finalProductData.quantity <= 1 ? 'sold' : 'active',
            quantity: finalProductData.quantity - 1,
            lockedBy: null,
            lockedUntil: null
        });
    });

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const orderRef = db.collection('orders').doc();
    const orderNumber = `B-${new Date().getTime().toString().slice(-8)}`;

    await orderRef.set({
        orderNumber, vendorId, shippingAddress: customerShippingData, paymentIntentId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        totalAmount: intent.amount / 100, cartItems: [{ productId, name: finalProductData.name }],
        buyerUserId: userId
    });

    try {
        const vendorDoc = await db.collection('vendors').doc(vendorId).get();
        const nomeNegozio = vendorDoc.exists ? (vendorDoc.data().store_name || 'Bazar') : 'Bazar';
        let numeroCliente = customerShippingData.phone.replace(/\s+/g, '');
        if (!numeroCliente.startsWith('+')) numeroCliente = '+39' + numeroCliente;

        const messaggio = `Ciao da ${nomeNegozio}, ordine #${orderNumber} confermato!`;
        const MACRODROID_URL = "https://trigger.macrodroid.com/51db87e2-5593-48a5-9df5-a59f5dc9cf07/bazar_sms";
        await fetch(`${MACRODROID_URL}?phone=${encodeURIComponent(numeroCliente)}&message=${encodeURIComponent(messaggio)}`);
    } catch (e) { console.error(e); }

    return res.status(200).json({ orderId: orderRef.id, orderNumber });
}

async function handleBazarFinalizeOrder(req, res) {
    const { paymentIntentId, vendorId, productId, userId, customerShippingData, orderNotes, deliveryNotesForRider } = req.body;

    let productRef = db.collection('vendors').doc(vendorId).collection('products').doc(productId);
    let finalProductData;

    await db.runTransaction(async (transaction) => {
        const productDoc = await transaction.get(productRef);

        if (!productDoc.exists) {
            await stripe.refunds.create({ payment_intent: paymentIntentId });
            throw new Error("Prodotto non trovato durante la finalizzazione. Rimborso avviato.");
        }

        finalProductData = productDoc.data();
        const now = admin.firestore.Timestamp.now().toMillis();
        const lockedUntilMs = finalProductData.lockedUntil ? finalProductData.lockedUntil.toMillis() : 0;

        if (finalProductData.status === 'sold') {
            await stripe.refunds.create({ payment_intent: paymentIntentId });
            throw new Error("Prodotto già venduto definitivamente da un altro acquirente. Rimborso avviato.");
        }

        if (finalProductData.lockedBy !== userId || lockedUntilMs <= now) {
            await stripe.refunds.create({ payment_intent: paymentIntentId });
            throw new Error("La tua priorità su questo prodotto è scaduta. Rimborso avviato.");
        }

        // Se tutto è ok, FINALMENTE marchiamo il prodotto come venduto!
        // E decrementiamo la quantità.
        let newQuantity = finalProductData.quantity - 1;

        const updateFields = {
            lockedBy: null,
            lockedUntil: null,
            waitingList: admin.firestore.FieldValue.delete(),
            quantity: newQuantity
        };

        if (newQuantity <= 0) {
            updateFields.status = 'sold'; // Lo stato 'sold' è definitivo e blocca tutto
            updateFields.quantity = 0; // Assicurati che non vada mai negativo
        }

        transaction.update(productRef, updateFields);
    });

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (!intent || intent.status !== 'succeeded') {
        throw new Error("Il Payment Intent non è riuscito o non è valido.");
    }
    const soldiVeriPagati = intent.amount / 100;

    const orderRef = db.collection('orders').doc();
    const orderNumber = `B-${new Date().getTime().toString().slice(-8)}`;

    const purchasedItem = {
        docId: intent.metadata.productId,
        quantity: 1,
        type: 'bazar_product',
        price: parseFloat(intent.amount / 100 - intent.application_fee_amount / 100).toFixed(2),
        priceNettoVendor: parseFloat(intent.metadata.bazarPriceNetto),
        commissionCivoraPercentage: parseFloat(intent.application_fee_amount / 100) / parseFloat(intent.amount / 100 - intent.application_fee_amount / 100),
        productName: finalProductData.name,
        vendorId: intent.metadata.vendorId,
        imageUrl: finalProductData.imageUrls?.[0] || null,
        deliveryCost: parseFloat(intent.metadata.deliveryCost)
    };

    await orderRef.set({
        orderNumber,
        status: 'pending',
        vendorId,
        shippingAddress: customerShippingData,
        orderNotes: orderNotes || '',
        deliveryNotesForRider: deliveryNotesForRider || '',
        paymentIntentId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        orderCategory: 'bazar',
        totalAmount: soldiVeriPagati,
        cartItems: [purchasedItem],
        buyerUserId: userId
    });

    // =======================================================================
    // INVIO SMS ALL'ACQUIRENTE (NON AL NEGOZIANTE) TRAMITE MACRODROID
    // =======================================================================
    try {
        const vendorDoc = await db.collection('vendors').doc(vendorId).get();
        const nomeNegozio = vendorDoc.exists ? (vendorDoc.data().store_name || 'Bazar') : 'Bazar';

        let numeroCliente = customerShippingData.phone.replace(/\s+/g, '');
        if (!numeroCliente.startsWith('+')) {
            numeroCliente = '+39' + numeroCliente;
        }

        const messaggioSmsCliente = `Ciao da ${nomeNegozio}, grazie per l'acquisto! Il tuo ordine #${orderNumber} e' in elaborazione. Preparati alla chiamata del corriere per ricevere l'ordine.`;

        // ⚠️ QUESTO È IL TUO URL DI MACRODROID, NON CAMBIARLO SE FUNZIONA GIÀ! ⚠️
        const MACRODROID_WEBHOOK_URL_BASE = "https://trigger.macrodroid.com/51db87e2-5593-48a5-9df5-a59f5dc9cf07/bazar_sms";

        const macrodroidUrlCliente = `${MACRODROID_WEBHOOK_URL_BASE}?phone=${encodeURIComponent(numeroCliente)}&message=${encodeURIComponent(messaggioSmsCliente)}`;

        await fetch(macrodroidUrlCliente)
            .then(response => {
                if (!response.ok) {
                    console.warn(`Webhook MacroDroid cliente fallito con status: ${response.status} - ${response.statusText}`);
                }
            })
            .catch(e => console.error("Errore di rete nell'invio del webhook MacroDroid al cliente:", e));

    } catch (smsError) {
        console.error("Errore generale durante l'invio dell'SMS all'acquirente via MacroDroid:", smsError);
    }
    // =======================================================================
