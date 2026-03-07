
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

// Inizializzazione Firebase Admin
if (!admin.apps.length) {
    const firebaseConfig = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
    admin.initializeApp({ credential: admin.credential.cert(firebaseConfig) });
}
const db = admin.firestore();

// Funzione di utilità
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
        return res.status(500).json({ error: error.message });
    }
};

async function handleBazarCalculateAndPay(req, res) {
    const { cartItems, vendorId, clientClaimedTotal } = req.body;
    const CIVORA_COMMISSION = 0.03;

    // Recupera il prodotto dal DB del venditore
    const item = cartItems[0];
    const productRef = db.collection('vendors').doc(vendorId).collection('products').doc(item.docId);
    const snap = await productRef.get();
    
    if (!snap.exists) throw new Error("Prodotto non trovato.");
    const data = snap.data();

    // Calcoli Bazar
    const netPrice = parseFloat(data.priceNettoVendor);
    const deliveryCost = parseFloat(data.deliveryCost || 0);
    const commission = parseFloat((netPrice * CIVORA_COMMISSION).toFixed(2));
    const priceCliente = parseFloat((netPrice + commission).toFixed(2));
    const totalToPay = parseFloat((priceCliente + deliveryCost).toFixed(2));

    // Sicurezza Prezzo
    if (Math.abs(totalToPay * 100 - clientClaimedTotal) > 100) {
        throw new Error("Discrepanza nei prezzi rilevata.");
    }

    // Stripe
    const vendorData = (await db.collection('vendors').doc(vendorId).get()).data();
    const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(totalToPay * 100),
        currency: 'eur',
        application_fee_amount: Math.round(commission * 100),
        transfer_data: { destination: vendorData.stripeAccountId },
        metadata: { vendorId, bazarPriceNetto: netPrice.toString() }
    });

    return res.status(200).json({ clientSecret: paymentIntent.client_secret, summary: { realTotal: totalToPay } });
}

async function handleBazarFinalizeOrder(req, res) {
    const { paymentIntentId, vendorId, customerShippingData, orderNotes } = req.body;
    
    // Finalizzazione ordine in Firebase
    const orderRef = db.collection('orders').doc();
    const orderNumber = `B-${new Date().getTime().toString().slice(-8)}`;
    
    await orderRef.set({
        orderNumber,
        status: 'pending',
        vendorId,
        shippingAddress: customerShippingData,
        orderNotes,
        paymentIntentId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        orderCategory: 'product'
    });

    return res.status(200).json({ orderId: orderRef.id, orderNumber });
}
