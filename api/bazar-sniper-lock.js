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
            
            // Inizializza activeLocks e waitingQueue se non esistono
            let activeLocks = productData.activeLocks || {};
            let waitingQueue = productData.waitingQueue || []; // NUOVO: La coda di attesa

            // Pulisce i lucchetti vecchi e tiene solo quelli attivi
            let validLocks = {};
            for (let uid in activeLocks) {
                if (activeLocks[uid] > now) {
                    validLocks[uid] = activeLocks[uid];
                }
            }
            
            // --- Logica per la Coda di Ripescaggio ---
            
            // Rimuovi l'utente dalla coda se ha già un lucchetto attivo (non deve più aspettare)
            if (validLocks[userId] && waitingQueue.includes(userId)) {
                waitingQueue = waitingQueue.filter(uid => uid !== userId);
            }
            // Rimuovi l'utente dalla coda se è "scaduto" e non ha un blocco attivo.
            // Questo aiuta a pulire la coda da utenti che hanno abbandonato.
            // Non lo facciamo qui, perché se l'utente non ha un blocco ma è in coda, deve RIMANERE.
            // La pulizia avverrà se ottiene un blocco o se esce manualmente.

            // --- Fine Logica Coda di Ripescaggio ---


            // 1. Controlla se TU hai già un lucchetto valido
            if (validLocks[userId]) {
                // Se l'utente ha già un blocco, assicurati che non sia in coda e aggiorna il DB se necessario
                if (waitingQueue.includes(userId)) {
                    waitingQueue = waitingQueue.filter(uid => uid !== userId);
                    transaction.update(productRef, { waitingQueue: waitingQueue });
                }
                return { status: 'LOCKED_BY_YOU', lockedUntil: validLocks[userId] };
            }

            // 2. Calcola le quantità ancora disponibili per essere bloccate
            const lockedCount = Object.keys(validLocks).length;
            const availableQuantity = productData.quantity - lockedCount;

            // 3. Se c'è spazio, ti diamo il lucchetto!
            if (availableQuantity > 0) {
                // Prima di dare un lucchetto diretto, controlliamo se l'utente è il primo in coda.
                // Questo è cruciale per la priorità di ripescaggio.
                const isFirstInQueue = waitingQueue.length > 0 && waitingQueue[0] === userId;

                if (isFirstInQueue || !waitingQueue.includes(userId)) { // Se è il primo in coda O non è in coda
                    const newLockedUntil = now + LOCK_DURATION_MS;
                    validLocks[userId] = newLockedUntil; // Aggiunge il tuo lucchetto
                    
                    // Rimuovi l'utente dalla coda, perché ha appena ottenuto un blocco
                    waitingQueue = waitingQueue.filter(uid => uid !== userId);

                    transaction.update(productRef, {
                        activeLocks: validLocks,
                        waitingQueue: waitingQueue, // AGGIORNATO: Salva la coda pulita
                        lockedBy: admin.firestore.FieldValue.delete(), // Puliamo i vecchi campi per sicurezza
                        lockedUntil: admin.firestore.FieldValue.delete()
                    });

                    // Indica se il blocco è stato ottenuto direttamente o tramite ripescaggio
                    return { status: isFirstInQueue ? 'LOCKED_BY_YOU_FROM_QUEUE' : 'LOCKED_BY_YOU', lockedUntil: newLockedUntil };
                } else {
                    // C'è un pezzo disponibile, ma NON È IL TUO TURNO in coda.
                    // Non possiamo darti il pezzo.
                    // Puoi solo entrare in coda o aspettare il tuo turno.
                    // Se l'utente non è il primo in coda ma c'è disponibilità,
                    // significa che qualcuno davanti a lui può prenderlo, o l'utente non ha la priorità.
                    // Lo trattiamo come "bloccato da altri" per forzarlo ad aspettare il suo turno.
                    const minExpiry = Math.min(...Object.values(validLocks)); // Questo può essere 0 se non ci sono lucchetti attivi
                    return { status: 'LOCKED_BY_OTHER', lockedUntil: minExpiry, queuePosition: waitingQueue.indexOf(userId) + 1 };
                }
            } 
            // 4. Se non c'è spazio (availableQuantity <= 0), ti aggiungiamo alla coda (se non ci sei già)
            else {
                if (!waitingQueue.includes(userId)) {
                    waitingQueue.push(userId);
                    transaction.update(productRef, { waitingQueue: waitingQueue }); // AGGIORNATO: Salva la coda
                }
                const minExpiry = Math.min(...Object.values(validLocks));
                return { status: 'LOCKED_BY_OTHER', lockedUntil: minExpiry, queuePosition: waitingQueue.indexOf(userId) + 1 }; // Ritorna la posizione in coda
            }
        });

        // Risposte API modificate per gestire i nuovi stati e dati
        if (result.status === 'SOLD') {
            return res.status(200).json({ success: false, message: 'Prodotto già venduto o esaurito.', status: 'SOLD' });
        } else if (result.status === 'LOCKED_BY_OTHER') {
            return res.status(200).json({ success: false, message: 'Tutti i pezzi sono momentaneamente bloccati o non è il tuo turno in coda, entra in attesa!', status: 'LOCKED_BY_OTHER', lockedUntil: result.lockedUntil, queuePosition: result.queuePosition });
        } else if (result.status === 'LOCKED_BY_YOU' || result.status === 'LOCKED_BY_YOU_FROM_QUEUE') {
            return res.status(200).json({ success: true, message: 'Prodotto bloccato per te!', status: result.status, lockedUntil: result.lockedUntil });
        }

    } catch (error) {
        console.error("Errore nella transazione bazar-sniper-lock:", error.message);
        return res.status(500).json({ success: false, error: error.message || 'Errore durante il blocco del prodotto.' });
    }
};
