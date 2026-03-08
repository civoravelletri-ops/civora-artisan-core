const admin = require('firebase-admin');

// Inizializzazione Firebase Admin
// Questa parte è la stessa del tuo bazar-payment-intent.js
// Si assicura che il server Vercel possa parlare con il tuo database Firebase
if (!admin.apps.length) {
    const firebaseConfig = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
    admin.initializeApp({ credential: admin.credential.cert(firebaseConfig) });
}
const db = admin.firestore();

// Funzione per gestire i permessi (CORS)
// Serve a far capire al browser che è permesso chiamare questo server Vercel
function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Permette a qualsiasi sito (il tuo) di chiamarlo
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); // Permette di usare i comandi POST e OPTIONS
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); // Permette di inviare dati in formato JSON
}

// =========================================================================
// LA LOGICA PRINCIPALE DEL VIGILE URBANO
// =========================================================================
module.exports = async (req, res) => {
    setCorsHeaders(res); // Imposta i permessi
    if (req.method === 'OPTIONS') return res.status(200).end(); // Risponde subito se è una richiesta "preflight"
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' }); // Accetta solo richieste POST

    const { vendorId, productId, userId } = req.body; // Prendiamo i dati che ci manda il telefono dell'utente

    // Durata del lucchetto (in millisecondi)
    // 2 minuti = 120 secondi = 120.000 millisecondi
    const LOCK_DURATION_MS = 120 * 1000;

    if (!vendorId || !productId || !userId) {
        return res.status(400).json({ success: false, error: 'Dati mancanti: vendorId, productId o userId.' });
    }

    try {
            const result = await db.runTransaction(async (transaction) => {
                const productRef = db.collection('vendors').doc(vendorId).collection('products').doc(productId);
                const productDoc = await transaction.get(productRef);

                if (!productDoc.exists) throw new Error('Prodotto non trovato.');

                const productData = productDoc.data();
                const now = admin.firestore.Timestamp.now().toMillis();

                // Default quantità a 1 se manca per prodotti vecchi
                const totalQuantity = productData.quantity || 1;

                if (productData.status === 'sold' || totalQuantity <= 0) {
                    return { status: 'SOLD' };
                }

                // Mappa dei lucchetti attivi { "id_utente": timestamp_scadenza }
                let activeLocks = productData.activeLocks || {};
                let validLocksCount = 0;
                let userHasLock = false;
                let nearestExpiry = null;

                // 1. Pulizia dei lucchetti scaduti e conteggio di quelli validi
                for (const [uid, expiryMs] of Object.entries(activeLocks)) {
                    if (expiryMs > now) {
                        validLocksCount++;
                        if (uid === userId) userHasLock = true;
                        if (!nearestExpiry || expiryMs < nearestExpiry) nearestExpiry = expiryMs;
                    } else {
                        delete activeLocks[uid]; // Elimina lucchetto scaduto
                    }
                }

                // 2. Se l'utente ha GIÀ un lucchetto valido, lo lasciamo passare
                if (userHasLock) {
                    return { status: 'LOCKED_BY_YOU', lockedUntil: activeLocks[userId] };
                }

                // 3. Verifichiamo se ci sono unità disponibili (Quantità Totale - Lucchetti Validi)
                const availableQuantity = totalQuantity - validLocksCount;

                if (availableQuantity > 0) {
                    // C'è posto! Assegniamo il lucchetto a questo utente
                    const newLockedUntil = now + LOCK_DURATION_MS;
                    activeLocks[userId] = newLockedUntil;

                    transaction.update(productRef, {
                        activeLocks: activeLocks,
                        // Puliamo eventuali vecchi campi legacy
                        lockedBy: admin.firestore.FieldValue.delete(),
                        lockedUntil: admin.firestore.FieldValue.delete()
                    });

                    return { status: 'LOCKED_BY_YOU', lockedUntil: newLockedUntil };
                } else {
                    // Tutti gli oggetti sono attualmente bloccati nelle casse altrui
                    return { status: 'LOCKED_BY_OTHER', lockedUntil: nearestExpiry };
                }
            });

            // Risposte al client (Rimangono identiche)
            if (result.status === 'SOLD') {
                return res.status(200).json({ success: false, message: 'Prodotto terminato.', status: 'SOLD' });
            } else if (result.status === 'LOCKED_BY_OTHER') {
                return res.status(200).json({ success: false, message: 'Tutte le unità sono in cassa. Entra in coda!', status: 'LOCKED_BY_OTHER', lockedUntil: result.lockedUntil });
            } else if (result.status === 'LOCKED_BY_YOU') {
                return res.status(200).json({ success: true, message: 'Unità bloccata per te!', status: 'LOCKED_BY_YOU', lockedUntil: result.lockedUntil });
            }

        } catch (error) {
        console.error("Errore nella transazione bazar-sniper-lock:", error.message);
        // Se il prodotto non esiste più o altri errori inaspettati
        return res.status(500).json({ success: false, error: error.message || 'Errore durante il blocco del prodotto.' });
    }
};
