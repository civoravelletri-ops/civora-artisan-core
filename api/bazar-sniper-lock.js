const admin = require('firebase-admin');

// Inizializzazione Firebase Admin
if (!admin.apps.length) {
    const firebaseConfig = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
    admin.initializeApp({ credential: admin.credential.cert(firebaseConfig) });
}
const db = admin.firestore();

// Funzione per gestire i permessi (CORS)
function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// =========================================================================
// LOGICA PRINCIPALE: IL VIGILE URBANO DEI LUCCHETTI MULTIPLI
// =========================================================================
module.exports = async (req, res) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

    const { vendorId, productId, userId } = req.body;

    // Durata di un singolo lucchetto (2 minuti)
    const LOCK_DURATION_MS = 120 * 1000; 

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

            if (productData.status === 'sold' || (productData.quantity && productData.quantity <= 0)) {
                return { status: 'SOLD' }; // Già venduto o quantità esaurita
            }

            // Inizializza o pulisci i lucchetti attivi
            let activeLocks = productData.activeLocks || {};
            let waitingList = productData.waitingList || {};

            // 1. Pulisci lucchetti scaduti
            for (const key in activeLocks) {
                if (activeLocks.hasOwnProperty(key)) {
                    if (activeLocks[key] <= now) {
                        delete activeLocks[key];
                    }
                }
            }

            // 2. Rimuovi utenti dalla waitingList se il loro blocco è già presente
            for (const key in waitingList) {
                if (waitingList.hasOwnProperty(key)) {
                    if (activeLocks[key]) { // Se l'utente ha già un lucchetto attivo, non deve stare in coda
                        delete waitingList[key];
                    }
                }
            }
            
            // Calcola quanti pezzi sono attualmente bloccati
            const currentlyLockedCount = Object.keys(activeLocks).length;
            const availableQuantity = productData.quantity - currentlyLockedCount;

            // 3. Verifica se l'utente ha già un lucchetto attivo
            if (activeLocks[userId] && activeLocks[userId] > now) {
                // L'utente ha già un lucchetto valido, lo mantiene
                return { 
                    status: 'LOCKED_BY_YOU', 
                    lockedUntil: activeLocks[userId],
                    activeLockCount: currentlyLockedCount,
                    remainingQuantity: availableQuantity
                }; 
            }

            // 4. Se ci sono pezzi disponibili, assegna un nuovo lucchetto
            if (availableQuantity > 0) {
                const newLockedUntil = now + LOCK_DURATION_MS;
                activeLocks[userId] = newLockedUntil; // Aggiunge il lucchetto per questo utente
                
                // Rimuove l'utente da qualsiasi waitingList se era lì
                if (waitingList[userId]) {
                    delete waitingList[userId];
                }

                transaction.update(productRef, {
                    activeLocks: activeLocks,
                    waitingList: waitingList // Aggiorna la waitingList
                });

                return { 
                    status: 'LOCKED_BY_YOU', 
                    lockedUntil: newLockedUntil,
                    activeLockCount: currentlyLockedCount + 1, // +1 perché l'abbiamo appena aggiunto
                    remainingQuantity: availableQuantity - 1  // -1 perché l'abbiamo appena bloccato
                };
            } 
            
            // 5. Se tutti i pezzi sono bloccati, l'utente va in coda (waitingList)
            else {
                // Aggiungi l'utente alla waitingList se non è già presente
                if (!waitingList[userId]) {
                    waitingList[userId] = now; // Metti il timestamp di quando è entrato in coda
                    transaction.update(productRef, {
                        waitingList: waitingList
                    });
                }
                return { 
                    status: 'ALL_LOCKED', 
                    activeLockCount: currentlyLockedCount,
                    remainingQuantity: availableQuantity,
                    lockedUntil: Object.values(activeLocks).reduce((min, current) => Math.min(min, current), Infinity) // Il lucchetto che scade prima
                };
            }
        });

        // =========================================================================
        // Rispondiamo al telefono dell'utente in base al risultato della transazione
        // =========================================================================
        if (result.status === 'SOLD') {
            return res.status(200).json({ success: false, message: 'Prodotto già venduto o esaurito.', status: 'SOLD' });
        } else if (result.status === 'ALL_LOCKED') {
            return res.status(200).json({ 
                success: false, 
                message: 'Tutti i pezzi sono momentaneamente bloccati.', 
                status: 'ALL_LOCKED', 
                lockedUntil: result.lockedUntil 
            });
        } else if (result.status === 'LOCKED_BY_YOU') {
            return res.status(200).json({ 
                success: true, 
                message: 'Un pezzo bloccato per te!', 
                status: 'LOCKED_BY_YOU', 
                lockedUntil: result.lockedUntil 
            });
        } else {
            return res.status(500).json({ success: false, error: 'Errore interno inaspettato.' });
        }

    } catch (error) {
        console.error("Errore nella transazione bazar-sniper-lock:", error.message);
        return res.status(500).json({ success: false, error: error.message || 'Errore durante il blocco del prodotto.' });
    }
};
