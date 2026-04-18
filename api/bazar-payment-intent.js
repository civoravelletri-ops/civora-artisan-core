const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

// --- INIZIALIZZAZIONE FIREBASE ---
if (!admin.apps.length) {
    const firebaseConfig = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
    admin.initializeApp({ credential: admin.credential.cert(firebaseConfig) });
}
const db = admin.firestore();

module.exports = async (req, res) => {
    // CORS HEADERS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { action } = req.body;

    try {
        if (action === 'CALCULATE_AND_PAY') {
            const { cartItems, vendorId, tempGuestCartRef, clientClaimedTotal } = req.body;

            // 1. Recupera account Stripe del venditore
            const vendorDoc = await db.collection('vendors').doc(vendorId).get();
            if (!vendorDoc.exists) throw new Error("Venditore non trovato");
            const vendorStripeAccountId = vendorDoc.data().stripeAccountId;
            if (!vendorStripeAccountId) throw new Error("Il venditore non ha Stripe configurato");

            // 2. Calcolo Totale e Commissione Civora (Application Fee)
            // Nel Bazar, il calcolo della fee viene passato dal frontend o calcolato qui
            const item = cartItems[0];
            const price = parseFloat(item.price);
            const delivery = parseFloat(item.deliveryCost || 0);
            const commissionRate = parseFloat(item.commissionCivoraPercentage || 0.05);
            
            const serverFee = price * commissionRate;
            const grandTotal = price + delivery;

            // 3. Creazione Payment Intent (Metodo DIRECT: Tasse al Venditore)
            const paymentIntent = await stripe.paymentIntents.create({
                amount: Math.round(grandTotal * 100),
                currency: 'eur',
                automatic_payment_methods: { enabled: true },
                application_fee_amount: Math.round(serverFee * 100), // La tua commissione pulita
                metadata: {
                    vendorId: vendorId,
                    type: 'BAZAR_ORDER',
                    tempCartRef: tempGuestCartRef
                }
            }, {
                stripeAccount: vendorStripeAccountId, // <--- IL VENDITORE PAGA LE TASSE DI STRIPE
            });

            return res.status(200).json({
                clientSecret: paymentIntent.client_secret,
                summary: {
                    realGoods: price,
                    realShipping: delivery,
                    realFee: serverFee,
                    realTotal: grandTotal
                }
            });
        }

        if (action === 'FINALIZE_ORDER') {
            // Qui andrebbe la logica per creare l'ordine nel database dopo il pagamento
            // Per ora restituiamo successo per non bloccare il sistema
            return res.status(200).json({ orderId: "BAZAR-" + Date.now(), orderNumber: "BZ-" + Date.now() });
        }

        return res.status(400).json({ error: "Azione non riconosciuta" });

    } catch (error) {
        console.error("ERRORE BAZAR:", error);
        return res.status(500).json({ error: error.message });
    }
};
