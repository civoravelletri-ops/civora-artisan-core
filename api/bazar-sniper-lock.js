const admin = require('firebase-admin');

if (!admin.apps.length) {
    const firebaseConfig = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
    admin.initializeApp({ credential: admin.credential.cert(firebaseConfig) });
}
const db = admin.firestore();

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

    const { vendorId, productId, userId } = req.body;
    const LOCK_DURATION_MS = 120 * 1000; // 2 minuti

    if (!vendorId || !productId || !userId) {
        return res.status(400).json({ success: false, error: 'Dati mancanti: vendorId, productId o userId.' });
    }

    try {
        const result = await db.runTransaction(async (transaction) => {
            const productRef = db.collection('vendors').doc(vendorId).collection('products').doc(productId);
            const productDoc = await transaction.get(productRef);

            if (!productDoc.exists) {
                throw new Error('Prodotto non trovato o rimosso.');
            }

            const productData = productDoc.data();
            const now = admin.firestore.Timestamp.now().toMillis();
            
            if (productData.status === 'sold' || productData.quantity <= 0) {
                return { status: 'SOLD' };
            }

            // Pulisce i lucchetti vecchi e tiene solo quelli attivi
            let activeLocks = productData.activeLocks || {};
            let validLocks = {};
            for (let uid in activeLocks) {
                if (activeLocks[uid] > now) {
                    validLocks[uid] = activeLocks[uid];
                }
            }

            // 1. Controlla se TU hai già un lucchetto valido
            if (validLocks[userId]) {
                return { status: 'LOCKED_BY_YOU', lockedUntil: validLocks[userId] };
            }

            // 2. Calcola le quantità ancora disponibili per essere bloccate
            const lockedCount = Object.keys(validLocks).length;
            const availableQuantity = productData.quantity - lockedCount;

            // 3. Se c'è spazio, ti diamo il lucchetto!
            if (availableQuantity > 0) {
                const newLockedUntil = now + LOCK_DURATION_MS;
                validLocks[userId] = newLockedUntil; // Aggiunge il tuo lucchetto
                
                transaction.update(productRef, {
                    activeLocks: validLocks,
                    // Puliamo i vecchi campi per sicurezza
                    lockedBy: admin.firestore.FieldValue.delete(),
                    lockedUntil: admin.firestore.FieldValue.delete()
                });

                return { status: 'LOCKED_BY_YOU', lockedUntil: newLockedUntil };
            } 
            // 4. Se non c'è spazio, cerchiamo il lucchetto che scade prima per il timer
            else {
                const minExpiry = Math.min(...Object.values(validLocks));
                return { status: 'LOCKED_BY_OTHER', lockedUntil: minExpiry };
            }
        });

        if (result.status === 'SOLD') {
            return res.status(200).json({ success: false, message: 'Prodotto già venduto o esaurito.', status: 'SOLD' });
        } else if (result.status === 'LOCKED_BY_OTHER') {
            return res.status(200).json({ success: false, message: 'Tutti i pezzi sono momentaneamente bloccati, entra in coda!', status: 'LOCKED_BY_OTHER', lockedUntil: result.lockedUntil });
        } else if (result.status === 'LOCKED_BY_YOU') {
            return res.status(200).json({ success: true, message: 'Prodotto bloccato per te!', status: 'LOCKED_BY_YOU', lockedUntil: result.lockedUntil });
        }

    } catch (error) {
        console.error("Errore nella transazione bazar-sniper-lock:", error.message);
        return res.status(500).json({ success: false, error: error.message || 'Errore durante il blocco del prodotto.' });
    }
};
