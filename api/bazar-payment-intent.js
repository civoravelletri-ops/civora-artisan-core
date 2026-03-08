const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

if (!admin.apps.length) {
    const firebaseConfig = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
    admin.initializeApp({ credential: admin.credential.cert(firebaseConfig) });
}
const db = admin.firestore();

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { action } = req.body;

    try {
        if (action === 'CALCULATE_AND_PAY') return await handleBazarCalculateAndPay(req, res);
        else if (action === 'FINALIZE_ORDER') return await handleBazarFinalizeOrder(req, res);
        else if (action === 'RELEASE_LOCK') return await handleBazarReleaseLock(req, res);
        return res.status(400).json({ error: 'Azione sconosciuta' });
    } catch (error) {
        return res.status(400).json({ error: error.message || 'Errore interno.' });
    }
};

async function handleBazarCalculateAndPay(req, res) {
    const { cartItems, vendorId, clientClaimedTotal, userId } = req.body; 
    const CIVORA_COMMISSION = 0.03;

    if (!userId) throw new Error("Utente non identificato.");

    const item = cartItems[0]; 
    const productRef = db.collection('vendors').doc(vendorId).collection('products').doc(item.docId);

    let productData;
    await db.runTransaction(async (transaction) => {
        const productDoc = await transaction.get(productRef);
        if (!productDoc.exists) throw new Error("Prodotto non trovato.");
        productData = productDoc.data();

        const now = Date.now();
        const activeLocks = productData.activeLocks || [];
        const userLock = activeLocks.find(l => l.uid === userId && l.expiresAt > now);

        if (productData.status === 'sold' || productData.quantity <= 0) throw new Error("Prodotto esaurito.");
        if (!userLock) throw new Error("La tua priorità è scaduta.");
    });

    const netPrice = parseFloat(productData.priceNettoVendor || productData.price);
    const deliveryCost = parseFloat(productData.deliveryCost || 0);
    const commission = parseFloat((netPrice * CIVORA_COMMISSION).toFixed(2));
    const totalToPay = parseFloat((netPrice + commission + deliveryCost).toFixed(2));

    const vendorData = (await db.collection('vendors').doc(vendorId).get()).data();
    
    const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(totalToPay * 100),
        currency: 'eur',
        application_fee_amount: Math.round(commission * 100),
        transfer_data: { destination: vendorData.stripeAccountId },
        metadata: { vendorId, productId: item.docId, buyerUserId: userId, deliveryCost: deliveryCost.toString(), bazarPriceNetto: netPrice.toString() }
    });

    return res.status(200).json({ clientSecret: paymentIntent.client_secret, summary: { realTotal: totalToPay } });
}

async function handleBazarFinalizeOrder(req, res) {
    const { paymentIntentId, vendorId, productId, userId, customerShippingData, orderNotes, deliveryNotesForRider } = req.body;
    let productRef = db.collection('vendors').doc(vendorId).collection('products').doc(productId);
    let finalProductData;

    await db.runTransaction(async (transaction) => {
        const productDoc = await transaction.get(productRef);
        if (!productDoc.exists) { await stripe.refunds.create({ payment_intent: paymentIntentId }); throw new Error("Errore."); }
        
        finalProductData = productDoc.data();
        const now = Date.now();
        let activeLocks = finalProductData.activeLocks || [];
        const userLock = activeLocks.find(l => l.uid === userId && l.expiresAt > now);

        if (finalProductData.status === 'sold' || finalProductData.quantity <= 0 || !userLock) {
            await stripe.refunds.create({ payment_intent: paymentIntentId });
            throw new Error("Troppo tardi, rimborso avviato.");
        }

        // Togliamo il lucchetto dell'utente e abbassiamo la quantità di 1
        activeLocks = activeLocks.filter(l => l.uid !== userId);
        let newQuantity = finalProductData.quantity - 1;

        const updateFields = { activeLocks, quantity: newQuantity };
        if (newQuantity <= 0) { updateFields.status = 'sold'; updateFields.quantity = 0; }
        
        transaction.update(productRef, updateFields);
    });

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const orderRef = db.collection('orders').doc();
    const orderNumber = `B-${new Date().getTime().toString().slice(-8)}`;

    const purchasedItem = {
        docId: intent.metadata.productId,
        quantity: 1,
        type: 'bazar_product',
        price: parseFloat(intent.amount / 100 - intent.application_fee_amount / 100).toFixed(2),
        productName: finalProductData.name,
        vendorId: intent.metadata.vendorId,
        imageUrl: finalProductData.imageUrls?.[0] || null,
        deliveryCost: parseFloat(intent.metadata.deliveryCost)
    };

    await orderRef.set({
        orderNumber, status: 'pending', vendorId, shippingAddress: customerShippingData,
        paymentIntentId, createdAt: admin.firestore.FieldValue.serverTimestamp(),
        orderCategory: 'bazar', totalAmount: intent.amount / 100, cartItems: [purchasedItem], buyerUserId: userId
    });

    // SMS MACRODROID
    try {
        let phone = customerShippingData.phone.replace(/\s+/g, '');
        if (!phone.startsWith('+')) phone = '+39' + phone;
        const msg = `Grazie per l'acquisto! Ordine #${orderNumber} in elaborazione.`;
        fetch(`https://trigger.macrodroid.com/51db87e2-5593-48a5-9df5-a59f5dc9cf07/bazar_sms?phone=${encodeURIComponent(phone)}&message=${encodeURIComponent(msg)}`).catch(e=>{});
    } catch (e) {}

    return res.status(200).json({ success: true, orderId: orderRef.id, orderNumber });
}

async function handleBazarReleaseLock(req, res) {
    const { vendorId, productId, userId } = req.body;
    if (!vendorId || !productId || !userId) return res.status(400).json({ error: 'Dati mancanti' });

    const productRef = db.collection('vendors').doc(vendorId).collection('products').doc(productId);

    await db.runTransaction(async (transaction) => {
        const productDoc = await transaction.get(productRef);
        if (productDoc.exists) {
            let activeLocks = productDoc.data().activeLocks || [];
            // Rimuoviamo SOLO il lucchetto di questo utente, lasciando intatti quelli degli altri!
            const newLocks = activeLocks.filter(l => l.uid !== userId);
            transaction.update(productRef, { activeLocks: newLocks });
        }
    });

    return res.status(200).json({ success: true });
}
