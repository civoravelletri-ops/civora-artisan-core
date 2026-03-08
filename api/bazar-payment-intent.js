const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

// Inizializzazione Firebase Admin
if (!admin.apps.length) {
    const firebaseConfig = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
    admin.initializeApp({ credential: admin.credential.cert(firebaseConfig) });
}
const db = admin.firestore();

// Funzione di utilità per i CORS
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
            if (action === 'CALCULATE_AND_PAY') {
                return await handleBazarCalculateAndPay(req, res);
            } else if (action === 'FINALIZE_ORDER') {
                return await handleBazarFinalizeOrder(req, res);
            } else if (action === 'RELEASE_LOCK') {  // <--- NUOVA RIGA AGGIUNTA
                return await handleBazarReleaseLock(req, res);
            }
            return res.status(400).json({ error: 'Azione sconosciuta' });
    } catch (error) {
        console.error("❌ ERRORE BAZAR:", error);
        // Rispondo 400 così il browser sa che è un errore logico e non blocca per CORS
        return res.status(400).json({ error: error.message || 'Errore interno del server.' });
    }
};

async function handleBazarCalculateAndPay(req, res) {
    const { cartItems, vendorId, clientClaimedTotal, userId } = req.body;
    const CIVORA_COMMISSION = 0.03;

    if (!userId) {
        throw new Error("Utente non identificato. Ricarica la pagina per favore.");
    }

    const item = cartItems[0];
    const productRef = db.collection('vendors').doc(vendorId).collection('products').doc(item.docId);

    let productData;
    await db.runTransaction(async (transaction) => {
        const productDoc = await transaction.get(productRef);

        if (!productDoc.exists) {
            throw new Error("Prodotto non trovato o non più disponibile.");
        }
        productData = productDoc.data();

        const now = admin.firestore.Timestamp.now().toMillis();
        const lockedUntilMs = productData.lockedUntil ? productData.lockedUntil.toMillis() : 0;

        if (productData.status === 'sold') {
            throw new Error("Prodotto già venduto definitivamente.");
        }
        if (productData.lockedBy !== userId || lockedUntilMs <= now) {
            throw new Error("La tua priorità su questo prodotto è scaduta o è stata persa.");
        }
    });

    const netPrice = parseFloat(productData.priceNettoVendor || productData.price);
    const deliveryCost = parseFloat(productData.deliveryCost || 0);
    const commission = parseFloat((netPrice * CIVORA_COMMISSION).toFixed(2));
    const priceCliente = parseFloat((netPrice + commission).toFixed(2));
    const totalToPay = parseFloat((priceCliente + deliveryCost).toFixed(2));

    if (Math.abs(totalToPay * 100 - clientClaimedTotal) > 100) {
        console.warn(`DISCREPANZA PREZZO: Calcolato ${totalToPay*100}, ricevuto ${clientClaimedTotal}`);
        throw new Error("Discrepanza nei prezzi rilevata. Riprova l'acquisto.");
    }

    const vendorData = (await db.collection('vendors').doc(vendorId).get()).data();
    if (!vendorData || !vendorData.stripeAccountId) {
        throw new Error("Il venditore non ha un account Stripe configurato.");
    }

    const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(totalToPay * 100),
        currency: 'eur',
        application_fee_amount: Math.round(commission * 100),
        transfer_data: { destination: vendorData.stripeAccountId },
        metadata: {
            vendorId,
            productId: item.docId,
            bazarPriceNetto: netPrice.toString(),
            commissionCivora: commission.toString(),
            deliveryCost: deliveryCost.toString(),
            buyerUserId: userId
        }
    });

    return res.status(200).json({ clientSecret: paymentIntent.client_secret, summary: { realTotal: totalToPay } });
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

        let newQuantity = finalProductData.quantity - 1;

        const updateFields = {
            lockedBy: null,
            lockedUntil: null,
            waitingList: admin.firestore.FieldValue.delete(),
            quantity: newQuantity
        };

        if (newQuantity <= 0) {
            updateFields.status = 'sold';
            updateFields.quantity = 0;
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

    // INVIO SMS MACRODROID
    try {
        const vendorDoc = await db.collection('vendors').doc(vendorId).get();
        const nomeNegozio = vendorDoc.exists ? (vendorDoc.data().store_name || 'Bazar') : 'Bazar';

        let numeroCliente = customerShippingData.phone.replace(/\s+/g, '');
        if (!numeroCliente.startsWith('+')) {
            numeroCliente = '+39' + numeroCliente;
        }

        const messaggioSmsCliente = `Ciao da ${nomeNegozio}, grazie per l'acquisto! Il tuo ordine #${orderNumber} e' in elaborazione. Preparati alla chiamata del corriere per ricevere l'ordine.`;

        const MACRODROID_WEBHOOK_URL_BASE = "https://trigger.macrodroid.com/51db87e2-5593-48a5-9df5-a59f5dc9cf07/bazar_sms";

        const macrodroidUrlCliente = `${MACRODROID_WEBHOOK_URL_BASE}?phone=${encodeURIComponent(numeroCliente)}&message=${encodeURIComponent(messaggioSmsCliente)}`;

        await fetch(macrodroidUrlCliente)
            .then(response => {
                if (!response.ok) {
                    console.warn(`Webhook MacroDroid cliente fallito con status: ${response.status}`);
                }
            })
            .catch(e => console.error("Errore MacroDroid:", e));

    } catch (smsError) {
        console.error("Errore generale invio SMS MacroDroid:", smsError);
    }

    // MANDIAMO LA RISPOSTA FINALE CORRETTA AL CLIENTE
    return res.status(200).json({ success: true, orderId: orderRef.id, orderNumber });
}
async function handleBazarReleaseLock(req, res) {
    const { vendorId, productId, userId } = req.body;
    if (!vendorId || !productId || !userId) return res.status(400).json({ error: 'Dati mancanti' });

    const productRef = db.collection('vendors').doc(vendorId).collection('products').doc(productId);

    await db.runTransaction(async (transaction) => {
        const productDoc = await transaction.get(productRef);
        if (productDoc.exists) {
            const data = productDoc.data();
            // Sblocca SOLO se è ancora bloccato da questo utente e NON è già stato venduto
            if (data.lockedBy === userId && data.status !== 'sold') {
                transaction.update(productRef, {
                    lockedBy: null,
                    lockedUntil: null,
                    waitingList: admin.firestore.FieldValue.delete()
                });
            }
        }
    });

    return res.status(200).json({ success: true });
}
