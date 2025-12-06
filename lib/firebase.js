const admin = require('firebase-admin');

// Inizializzazione Singleton per evitare errori su Vercel
if (!admin.apps.length) {
  // Le chiavi saranno nelle variabili d'ambiente di Vercel (dopo ti dico come metterle)
  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}'
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    // Usiamo lo stesso DB del progetto core
    databaseURL: "https://localmente-v3-core-default-rtdb.europe-west1.firebasedatabase.app"
  });
}

const db = admin.firestore();
module.exports = { db };
