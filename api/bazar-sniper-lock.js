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

    // Usiamo una TRANSAZIONE per evitare che due persone "tocchino" l'oggetto insieme
    // È come se il database si mettesse in pausa per un istante, servendo un solo utente alla volta
    try {
        const result = await db.runTransaction(async (transaction) => {
            const productRef = db.collection('vendors').doc(vendorId).collection('products').doc(productId);
            const productDoc = await transaction.get(productRef);

            if (!productDoc.exists) {
                throw new Error('Prodotto non trovato o rimosso.');
            }

            const productData = productDoc.data();
            const now = admin.firestore.Timestamp.now().toMillis(); // Il tempo attuale del server
            
            // =============================================================
            // Controlli per capire lo stato dell'oggetto:
            // 1. È stato venduto? (status: 'sold')
            // 2. È stato bloccato da un altro utente e il lucchetto è ancora valido?
            //    (lockedUntil > now)
            // =============================================================
            if (productData.status === 'sold') {
                return { status: 'SOLD' }; // Già venduto
            }

            if (productData.lockedUntil && productData.lockedUntil.toMillis() > now) {
                // L'oggetto è bloccato e il lucchetto è ancora valido
                // Vediamo se è bloccato da LUI STESSO (l'utente attuale)
                if (productData.lockedBy === userId) {
                    // È bloccato da questo utente, quindi può continuare
                    return { status: 'LOCKED_BY_YOU' }; 
                } else {
                    // È bloccato da un ALTRO utente
                    return { status: 'LOCKED_BY_OTHER', lockedUntil: productData.lockedUntil.toMillis() };
                }
            }

            // Se arriviamo qui, significa che l'oggetto è DISPONIBILE e NON bloccato validamente
            // Quindi, mettiamo il lucchetto!
            const newLockedUntil = new Date(now + LOCK_DURATION_MS); // Calcola quando scade il nuovo lucchetto
            
            transaction.update(productRef, {
                lockedUntil: admin.firestore.Timestamp.fromMillis(newLockedUntil.getTime()),
                lockedBy: userId,
                // Aggiungiamo anche un campo per sapere chi sono gli utenti in coda (per il ripescaggio)
                // Inizialmente la coda è vuota, verrà riempita dai client
                waitingList: admin.firestore.FieldValue.delete() // Pulisce qualsiasi coda precedente
            });

            return { status: 'LOCKED_BY_YOU', lockedUntil: newLockedUntil.getTime() }; // Bloccato da te
        });

        // =========================================================================
        // Rispondiamo al telefono dell'utente in base al risultato della transazione
        // =========================================================================
        if (result.status === 'SOLD') {
            return res.status(200).json({ success: false, message: 'Prodotto già venduto.', status: 'SOLD' });
        } else if (result.status === 'LOCKED_BY_OTHER') {
            return res.status(200).json({ success: false, message: 'Prodotto bloccato da un altro utente.', status: 'LOCKED_BY_OTHER', lockedUntil: result.lockedUntil });
        } else if (result.status === 'LOCKED_BY_YOU') {
            return res.status(200).json({ success: true, message: 'Prodotto bloccato per te!', status: 'LOCKED_BY_YOU', lockedUntil: result.lockedUntil });
        } else {
            // Questo caso non dovrebbe succedere se la logica è corretta
            return res.status(500).json({ success: false, error: 'Errore interno inaspettato.' });
        }

    } catch (error) {
        console.error("Errore nella transazione bazar-sniper-lock:", error.message);
        // Se il prodotto non esiste più o altri errori inaspettati
        return res.status(500).json({ success: false, error: error.message || 'Errore durante il blocco del prodotto.' });
    }
};
