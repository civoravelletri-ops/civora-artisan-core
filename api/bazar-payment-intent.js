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
    const { cartItems, vendorId, clientClaimedTotal, userId } = req.body; // NUOVO: Prendiamo anche l'userId
    const CIVORA_COMMISSION = 0.03;

    const item = cartItems[0]; // Per il Bazar Lampo, c'è sempre un solo articolo
    const productRef = db.collection('vendors').doc(vendorId).collection('products').doc(item.docId);

    // =========================================================================
    // NUOVO: Controllo del Lucchetto tramite Transazione
    // Ci assicuriamo che l'oggetto sia bloccato dall'utente corretto e non scaduto.
    // =========================================================================
    let productData;
    await db.runTransaction(async (transaction) => {
        const productDoc = await transaction.get(productRef);

        if (!productDoc.exists) {
            throw new Error("Prodotto non trovato o non più disponibile.");
        }
        productData = productDoc.data(); // Salviamo i dati per usarli dopo

        const now = admin.firestore.Timestamp.now().toMillis();
        const lockedUntilMs = productData.lockedUntil ? productData.lockedUntil.toMillis() : 0;

        if (productData.status === 'sold') {
            throw new Error("Prodotto già venduto definitivamente.");
        }
        if (productData.lockedBy !== userId || lockedUntilMs <= now) {
            // Se non è bloccato da questo utente o il lucchetto è scaduto
            // Qui potremmo anche aggiornare il lucchetto se scaduto, ma lo gestisce già sniper-lock
            throw new Error("La tua priorità su questo prodotto è scaduta o è stata persa.");
        }
        // Se tutto è ok, continua. Non aggiorniamo nulla qui, il lucchetto è già stato messo.
    });


    // Calcoli Bazar: Qui il server ricalcola il prezzo da zero
    const netPrice = parseFloat(productData.priceNettoVendor || productData.price); // Usiamo productData
    const deliveryCost = parseFloat(productData.deliveryCost || 0);
    const commission = parseFloat((netPrice * CIVORA_COMMISSION).toFixed(2));
    const priceCliente = parseFloat((netPrice + commission).toFixed(2));
    const totalToPay = parseFloat((priceCliente + deliveryCost).toFixed(2));

    // Sicurezza Prezzo: Confronta il prezzo calcolato dal server con quello inviato dal browser
    if (Math.abs(totalToPay * 100 - clientClaimedTotal) > 100) {
        console.warn(`DISCREPANZA PREZZO: Calcolato ${totalToPay*100}, ricevuto ${clientClaimedTotal}`);
        throw new Error("Discrepanza nei prezzi rilevata. Riprova l'acquisto.");
    }

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
            deliveryCost: deliveryCost.toString(),
            buyerUserId: userId // NUOVO: Salva anche l'ID dell'acquirente nei metadati
        }
    });

    return res.status(200).json({ clientSecret: paymentIntent.client_secret, summary: { realTotal: totalToPay } });
}

async function handleBazarFinalizeOrder(req, res) {
    const { paymentIntentId, vendorId, productId, userId, customerShippingData, orderNotes, deliveryNotesForRider } = req.body; // NUOVO: Aggiunti productId e userId

    // =========================================================================
    // NUOVO: Transazione per marcare il prodotto come VENDUTO
    // Questo è il momento critico. Solo chi ha pagato e ha il lucchetto valido vince.
    // =========================================================================
    let productRef = db.collection('vendors').doc(vendorId).collection('products').doc(productId);
    let finalProductData; // Per avere i dati aggiornati del prodotto

    await db.runTransaction(async (transaction) => {
        const productDoc = await transaction.get(productRef);

        if (!productDoc.exists) {
            // Se il prodotto non esiste più, rimborsiamo!
            await stripe.refunds.create({ payment_intent: paymentIntentId });
            throw new Error("Prodotto non trovato durante la finalizzazione. Rimborso avviato.");
        }

        finalProductData = productDoc.data();
        const now = admin.firestore.Timestamp.now().toMillis();
        const lockedUntilMs = finalProductData.lockedUntil ? finalProductData.lockedUntil.toMillis() : 0;

        // Ultimo controllo: L'utente che ha pagato è ancora quello con il lucchetto valido?
        if (finalProductData.status === 'sold') {
            // Caso raro: il pagamento è arrivato in ritardo e un altro ha già venduto
            // Rimborsiamo il pagamento e mandiamo un errore.
            await stripe.refunds.create({ payment_intent: paymentIntentId });
            throw new Error("Prodotto già venduto definitivamente da un altro acquirente. Rimborso avviato.");
        }

        if (finalProductData.lockedBy !== userId || lockedUntilMs <= now) {
            // Caso in cui il lucchetto non è più suo o è scaduto.
            // Rimborsiamo e mandiamo un errore.
            await stripe.refunds.create({ payment_intent: paymentIntentId });
            throw new Error("La tua priorità su questo prodotto è scaduta. Rimborso avviato.");
        }

        // Se tutto è ok, FINALMENTE marchiamo il prodotto come venduto!
        transaction.update(productRef, {
            status: 'sold', // Lo stato 'sold' è definitivo e blocca tutto
            lockedBy: null,
            lockedUntil: null,
            waitingList: admin.firestore.FieldValue.delete(), // Rimuoviamo la lista d'attesa
            quantity: admin.firestore.FieldValue.increment(-1) // NUOVO: Riduci la quantità di 1
        });

        // Se la quantità arriva a zero, assicurati che lo status sia sold e non venga più bloccato
        if (finalProductData.quantity === 1) { // Se prima era 1, dopo decremento diventa 0
            transaction.update(productRef, { status: 'sold' });
        } else if (finalProductData.quantity > 1) {
            // Se c'erano più pezzi, la vendita non lo rende sold, solo decrementa quantità e rimuove il lucchetto.
            // Il lucchetto può essere riapplicato per il prossimo pezzo.
            transaction.update(productRef, { lockedBy: null, lockedUntil: null });
        } else if (finalProductData.quantity <= 0) { // Giusto per sicurezza se la quantità era già 0 o negativa
             transaction.update(productRef, { status: 'sold', quantity: 0 });
        }

    }); // Fine della transazione


    // Se la transazione è andata a buon fine, il prodotto è MARKATO come 'sold'
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (!intent || intent.status !== 'succeeded') {
        throw new Error("Il Payment Intent non è riuscito o non è valido.");
    }
    const soldiVeriPagati = intent.amount / 100; // Importo totale pagato dal cliente

    const orderRef = db.collection('orders').doc();
    const orderNumber = `B-${new Date().getTime().toString().slice(-8)}`; // Genera un numero d'ordine

    // Creiamo l'oggetto purchasedItem dai metadati del Payment Intent per coerenza
    const purchasedItem = {
        docId: intent.metadata.productId,
        quantity: 1, // Sempre 1 per Bazar Lampo
        type: 'bazar_product',
        price: parseFloat(intent.amount / 100 - intent.application_fee_amount / 100).toFixed(2), // Prezzo prodotto senza commissione Civora
        priceNettoVendor: parseFloat(intent.metadata.bazarPriceNetto),
        commissionCivoraPercentage: parseFloat(intent.metadata.commissionCivora) / parseFloat(intent.metadata.bazarPriceNetto), // Ricalcola percentuale
        productName: finalProductData.name, // Prendiamo il nome dal database
        vendorId: intent.metadata.vendorId,
        imageUrl: finalProductData.imageUrls?.[0] || null, // Prendiamo la prima immagine
        deliveryCost: parseFloat(intent.metadata.deliveryCost)
    };

    // Salvataggio dell'ordine in Firebase
    await orderRef.set({
        orderNumber,
        status: 'pending', // Inizialmente in stato 'pending'
        vendorId,
        shippingAddress: customerShippingData,
        orderNotes: orderNotes || '', // Note aggiuntive
        deliveryNotesForRider: deliveryNotesForRider || '', // Note per il rider (se presenti)
        paymentIntentId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(), // Timestamp di creazione
        orderCategory: 'bazar', // Categoria specifica per il Bazar
        totalAmount: soldiVeriPagati, // L'importo totale pagato, VERIFICATO DA STRIPE
        cartItems: [purchasedItem], // L'articolo acquistato (ora un array contenente il singolo item)
        buyerUserId: userId // NUOVO: Memorizza l'ID dell'acquirente
    });

    // =======================================================================
    // NUOVO: Logica per la Lotteria del Ripescaggio (se necessario)
    // =======================================================================
    // Se c'è una waiting list, un altro utente verrà ripescato.
    // ATTENZIONE: Questa logica qui si applica se un acquisto fallisce o un lucchetto scade
    // Questo è il caso in cui il pagamento di Mirko fallisce.
    // Per ora la logica di ripescaggio verrà avviata da una funzione a tempo in Firebase.
    // Qui il prodotto è stato venduto, quindi non ci sarà ripescaggio.

    // =======================================================================
    // NOVITÀ: INVIO SMS TRAMITE MACRODROID (corretto per le variabili locali)
    // =======================================================================
    try {
        const vendorDoc = await db.collection('vendors').doc(vendorId).get();
        const nomeNegozio = vendorDoc.exists ? (vendorDoc.data().store_name || 'Bazar') : 'Bazar';

        let numeroCliente = customerShippingData.phone.replace(/\s+/g, '');
        if (!numeroCliente.startsWith('+')) { numeroCliente = '+39' + numeroCliente; }

        const messaggioSmsCliente = `Ciao da ${nomeNegozio}, grazie per l'acquisto! Il tuo ordine #${orderNumber} è in elaborazione. Preparati alla chiamata del corriere per ricevere l'ordine.`;
        const MACRODROID_WEBHOOK_URL_BASE = "https://trigger.macrodroid.com/51db87e2-5593-48a5-9df5-a59f5dc9cf07/bazar_sms"; // <--- IL TUO URL
        const macrodroidUrlCliente = `${MACRODROID_WEBHOOK_URL_BASE}?phone=${encodeURIComponent(numeroCliente)}&message=${encodeURIComponent(messaggioSmsCliente)}`;

        await fetch(macrodroidUrlCliente)
            .then(response => {
                if (!response.ok) {
                    console.warn(`Webhook MacroDroid cliente fallito con status: ${response.status} - ${response.statusText}`);
                }
            })
            .catch(e => console.error("Errore di rete nell'invio del webhook MacroDroid al cliente:", e));

        // NUOVO: Invio SMS anche al Negoziante (se ha configurato il numero per gli ordini)
        if (vendorDoc.exists) {
            const vendorData = vendorDoc.data();
            if (vendorData.order_notification_whatsapp_number && vendorData.order_notification_methods?.includes('whatsapp')) {
                let numeroNegoziante = vendorData.order_notification_whatsapp_number.replace(/\s+/g, '');
                if (!numeroNegoziante.startsWith('+')) { numeroNegoziante = '+39' + numeroNegoziante; } // Aggiunge prefisso se manca

                const messaggioSmsNegoziante = `NUOVO ORDINE BAZAR #${orderNumber}! Prodotto: ${purchasedItem.productName}. Cliente: ${customerShippingData.name} - ${customerShippingData.phone}. Prepara la spedizione!`;
                const macrodroidUrlNegoziante = `${MACRODROID_WEBHOOK_URL_BASE}?phone=${encodeURIComponent(numeroNegoziante)}&message=${encodeURIComponent(messaggioSmsNegoziante)}`;

                await fetch(macrodroidUrlNegoziante)
                    .then(response => {
                        if (!response.ok) {
                            console.warn(`Webhook MacroDroid negoziante fallito con status: ${response.status} - ${response.statusText}`);
                        }
                    })
                    .catch(e => console.error("Errore di rete nell'invio del webhook MacroDroid al negoziante:", e));
            }
        }

    } catch (smsError) {
        console.error("Errore generale durante l'invio dell'SMS via MacroDroid:", smsError);
    }
    // =======================================================================

    return res.status(200).json({ orderId: orderRef.id, orderNumber });
}
