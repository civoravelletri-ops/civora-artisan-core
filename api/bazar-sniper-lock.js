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
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

    const { vendorId, productId, userId } = req.body;
    const LOCK_DURATION_MS = 120 * 1000; // 2 minuti

    if (!vendorId || !productId || !userId) {
        return res.status(400).json({ success: false, error: 'Dati mancanti.' });
    }

    try {
        const result = await db.runTransaction(async (transaction) => {
            const productRef = db.collection('vendors').doc(vendorId).collection('products').doc(productId);
            const productDoc = await transaction.get(productRef);

            if (!productDoc.exists) throw new Error('Prodotto non trovato.');
            const productData = productDoc.data();
            const now = Date.now();
            
            if (productData.status === 'sold' || productData.quantity <= 0) {
                return { status: 'SOLD' };
            }

            // Prendiamo i lucchetti e scartiamo quelli vecchi/scaduti
            let activeLocks = productData.activeLocks || [];
            activeLocks = activeLocks.filter(lock => lock.expiresAt > now);

            // Controlliamo se questo utente ha GIÀ un lucchetto valido
            const userLock = activeLocks.find(lock => lock.uid === userId);
            if (userLock) {
                return { status: 'LOCKED_BY_YOU', lockedUntil: userLock.expiresAt };
            }

            // Calcoliamo quanti oggetti sono LIBERI (Quantità totale - Lucchetti attivi)
            const availableQuantity = (productData.quantity || 1) - activeLocks.length;

            if (availableQuantity > 0) {
                // C'è posto! Assegniamo un lucchetto a questo utente
                const newExpiresAt = now + LOCK_DURATION_MS;
                activeLocks.push({ uid: userId, expiresAt: newExpiresAt });
                
                transaction.update(productRef, { activeLocks });
                return { status: 'LOCKED_BY_YOU', lockedUntil: newExpiresAt };
            } else {
                // Tutto esaurito temporaneamente. Troviamo il lucchetto che scade prima per il timer
                const closestExpiry = Math.min(...activeLocks.map(l => l.expiresAt));
                return { status: 'LOCKED_BY_OTHER', lockedUntil: closestExpiry };
            }
        });

        if (result.status === 'SOLD') {
            return res.status(200).json({ success: false, message: 'Prodotto esaurito.', status: 'SOLD' });
        } else if (result.status === 'LOCKED_BY_OTHER') {
            return res.status(200).json({ success: false, message: 'Tutti i pezzi sono in cassa.', status: 'LOCKED_BY_OTHER', lockedUntil: result.lockedUntil });
        } else if (result.status === 'LOCKED_BY_YOU') {
            return res.status(200).json({ success: true, message: 'Bloccato per te!', status: 'LOCKED_BY_YOU', lockedUntil: result.lockedUntil });
        }

    } catch (error) {
        console.error("Errore sniper-lock:", error);
        return res.status(500).json({ success: false, error: 'Errore durante il blocco.' });
    }
};
