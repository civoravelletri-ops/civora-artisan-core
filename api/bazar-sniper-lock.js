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

    const { vendorId, productId, userId, action } = req.body; // Aggiunto 'action'
    const LOCK_DURATION_MS = 120 * 1000; // 2 minuti

    if (!vendorId || !productId || !userId) {
            return res.status(400).json({ success: false, error: 'Dati mancanti: vendorId, productId o userId.' });
        }
    
        try {
            // NUOVO: Se l'azione è solo incrementare la vista, lo fa l'Admin in sicurezza e si ferma qui
            if (action === 'INCREMENT_VIEW') {
                const productRef = db.collection('vendors').doc(vendorId).collection('products').doc(productId);
                await productRef.update({ viewsCount: admin.firestore.FieldValue.increment(1) });
                return res.status(200).json({ success: true });
            }
    
            const result = await db.runTransaction(async (transaction) => {
            const productRef = db.collection('vendors').doc(vendorId).collection('products').doc(productId);
            const productDoc = await transaction.get(productRef);

            if (!productDoc.exists) {
                // Se il prodotto non esiste, non c'è nulla da bloccare o sbloccare
                throw new Error('Prodotto non trovato o rimosso.');
            }

            const productData = productDoc.data();
            const now = admin.firestore.Timestamp.now().toMillis();
            
            let activeLocks = productData.activeLocks || {};
            let waitingQueue = productData.waitingQueue || [];

            // Pulisce tutti i lucchetti scaduti all'inizio di ogni transazione
            let validLocks = {};
            for (let uid in activeLocks) {
                if (activeLocks[uid] > now) {
                    validLocks[uid] = activeLocks[uid];
                }
            }

            // Rimuovi dalla coda gli utenti che non hanno un lock valido ma sono stati bloccati o hanno lasciato il checkout
            // (questa logica è più complessa da implementare in modo robusto qui senza race conditions,
            // si preferisce pulire la coda quando un utente ottiene un lock o esplicitamente abbandona.
            // La pulizia più semplice è fatta rimuovendo l'utente dalla coda quando ottiene un lock valido).
            // Per ora, ci concentriamo sull'avanzamento della coda con 'RELEASE_LOCK'.

            // --- GESTIONE RILASCIO LOCK ---
            if (action === 'RELEASE_LOCK') {
                console.log(`[SniperLock] Richiesta RELEASE_LOCK per prodotto ${productId}, utente ${userId}`);

                let lockWasRemoved = false;
                if (validLocks[userId]) {
                    delete validLocks[userId];
                    lockWasRemoved = true;
                    console.log(`[SniperLock] Lock di ${userId} rimosso.`);
                } else {
                    console.log(`[SniperLock] Utente ${userId} non aveva un lock attivo.`);
                }

                // Rimuovi l'utente dalla coda, anche se non aveva un lock, ha esplicitamente abbandonato
                const initialQueueLength = waitingQueue.length;
                waitingQueue = waitingQueue.filter(uid => uid !== userId);
                if (waitingQueue.length < initialQueueLength) {
                    console.log(`[SniperLock] Utente ${userId} rimosso dalla waitingQueue.`);
                }

                // Prova a ripescare il prossimo utente in coda se c'è disponibilità
                if (waitingQueue.length > 0) {
                    // Controlla se c'è un posto libero (anche se il rilascio ne crea uno)
                    const currentLockedCount = Object.keys(validLocks).length;
                    const currentAvailableQuantity = productData.quantity - currentLockedCount;

                    if (currentAvailableQuantity > 0) { // Se ora c'è disponibilità
                        const nextUserIdInQueue = waitingQueue.shift(); // Prendi il primo e rimuovilo dalla coda
                        const newLockedUntil = now + LOCK_DURATION_MS;
                        validLocks[nextUserIdInQueue] = newLockedUntil; // Assegna il lock al ripescato
                        console.log(`[SniperLock] Utente ${nextUserIdInQueue} ripescato e bloccato fino a ${newLockedUntil}.`);
                        
                        transaction.update(productRef, {
                            activeLocks: validLocks,
                            waitingQueue: waitingQueue,
                            // Puoi anche aggiornare un campo 'lastRescuedUser' se vuoi tracciare chi è stato ripescato
                        });
                        return { status: 'LOCK_RELEASED_AND_RESCUED', rescuedUser: nextUserIdInQueue };
                    }
                }
                
                // Se nessun utente è stato ripescato o non c'è più coda
                transaction.update(productRef, {
                    activeLocks: validLocks,
                    waitingQueue: waitingQueue,
                });
                return { status: 'LOCK_RELEASED' };
            }

            // --- FINE GESTIONE RILASCIO LOCK ---


            // --- LOGICA STANDARD DI BLOCCO (dal codice originale) ---
            
            // Se l'utente ha già un lucchetto valido (ma l'azione NON è RELEASE_LOCK)
            if (validLocks[userId]) {
                // Se l'utente ha già un blocco, assicurati che non sia in coda
                if (waitingQueue.includes(userId)) {
                    waitingQueue = waitingQueue.filter(uid => uid !== userId);
                    transaction.update(productRef, { waitingQueue: waitingQueue });
                }
                return { status: 'LOCKED_BY_YOU', lockedUntil: validLocks[userId] };
            }

            // Calcola le quantità ancora disponibili per essere bloccate
            const lockedCount = Object.keys(validLocks).length;
            const availableQuantity = productData.quantity - lockedCount;

            // Se c'è spazio, ti diamo il lucchetto!
            if (availableQuantity > 0) {
                // Prima di dare un lucchetto diretto, controlliamo se l'utente è il primo in coda.
                const isFirstInQueue = waitingQueue.length > 0 && waitingQueue[0] === userId;

                if (isFirstInQueue || !waitingQueue.includes(userId)) { // Se è il primo in coda O non è in coda
                    const newLockedUntil = now + LOCK_DURATION_MS;
                    validLocks[userId] = newLockedUntil; // Aggiunge il tuo lucchetto
                    
                    // Rimuovi l'utente dalla coda, perché ha appena ottenuto un blocco
                    waitingQueue = waitingQueue.filter(uid => uid !== userId);

                    transaction.update(productRef, {
                        activeLocks: validLocks,
                        waitingQueue: waitingQueue,
                        lockedBy: admin.firestore.FieldValue.delete(), // Puliamo i vecchi campi per sicurezza
                        lockedUntil: admin.firestore.FieldValue.delete()
                    });

                    return { status: isFirstInQueue ? 'LOCKED_BY_YOU_FROM_QUEUE' : 'LOCKED_BY_YOU', lockedUntil: newLockedUntil };
                } else {
                    // C'è un pezzo disponibile, ma NON È IL TUO TURNO in coda.
                    // Lo trattiamo come "bloccato da altri" per forzarlo ad aspettare il suo turno.
                    const minExpiry = Object.keys(validLocks).length > 0 ? Math.min(...Object.values(validLocks)) : now + LOCK_DURATION_MS;
                    return { status: 'LOCKED_BY_OTHER', lockedUntil: minExpiry, queuePosition: waitingQueue.indexOf(userId) + 1 };
                }
            } 
            // Se non c'è spazio (availableQuantity <= 0), ti aggiungiamo alla coda (se non ci sei già)
            else {
                if (!waitingQueue.includes(userId)) {
                    waitingQueue.push(userId);
                    transaction.update(productRef, { waitingQueue: waitingQueue });
                }
                const minExpiry = Object.keys(validLocks).length > 0 ? Math.min(...Object.values(validLocks)) : now + LOCK_DURATION_MS;
                return { status: 'LOCKED_BY_OTHER', lockedUntil: minExpiry, queuePosition: waitingQueue.indexOf(userId) + 1 };
            }
        });

        // Risposte API (aggiunti nuovi stati)
        if (result.status === 'LOCK_RELEASED' || result.status === 'LOCK_RELEASED_AND_RESCUED') {
            return res.status(200).json({ success: true, message: 'Lock rilasciato con successo.', status: result.status, rescuedUser: result.rescuedUser });
        } else if (result.status === 'SOLD') {
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
