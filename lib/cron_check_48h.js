const { db } = require('../lib/firebase');
const { differenceInHours } = require('date-fns');

export default async function handler(request, response) {
  // Sicurezza: Solo Vercel Cron può chiamare questa funzione (o noi per test)
  // In produzione controlleremo l'header di autorizzazione, per ora lasciamo aperto per testare.

  console.log("⏰ Esecuzione Protocollo Artisan: Controllo scadenze 48h...");

  try {
    // 1. Cerca ordini che sono "In attesa di specifiche"
    // NOTA: Dobbiamo essere sicuri che lo stato nel DB sia esatto. Uso 'PENDING_CUSTOMIZATION' come standard.
    const ordersRef = db.collection('orders');
    const snapshot = await ordersRef
      .where('status', '==', 'PENDING_CUSTOMIZATION')
      .get();

    if (snapshot.empty) {
      console.log('✅ Nessun ordine in sospeso trovato.');
      return response.status(200).json({ message: 'Nessun ordine da processare.' });
    }

    const batch = db.batch();
    let processedCount = 0;
    const now = new Date();

    snapshot.forEach(doc => {
      const order = doc.data();
      const orderDate = order.createdAt.toDate(); // Converte Timestamp Firestore in Date JS
      
      // Calcola ore passate
      const hoursPassed = differenceInHours(now, orderDate);

      // 2. Se sono passate più di 48 ore (e l'utente non ha scritto nulla)
      if (hoursPassed >= 48) {
        console.log(`⚠️ Ordine ${doc.id} scaduto (${hoursPassed}h). Forzatura a Standard.`);

        // Aggiorna lo stato dell'ordine principale
        const orderRef = db.collection('orders').doc(doc.id);
        batch.update(orderRef, {
          status: 'In Attesa di Preparazione', // Torna al flusso normale
          customizationStatus: 'SKIPPED_TIMEOUT', // Segniamo che è scaduto
          orderNotes: (order.orderNotes || '') + '\n[AUTO] Personalizzazione saltata per timeout 48h.'
        });

        // Aggiorna anche i sotto-ordini dei venditori (vendor_orders)
        if (order.vendorIdsInvolved && order.vendorIdsInvolved.length > 0) {
            order.vendorIdsInvolved.forEach(vendorId => {
                const subOrderRef = db.collection('vendor_orders').doc(vendorId).collection('orders').doc(doc.id);
                batch.update(subOrderRef, {
                    status: 'In Attesa di Preparazione',
                    customizationStatus: 'SKIPPED_TIMEOUT'
                });
            });
        }
        
        processedCount++;
      }
    });

    // 3. Esegui le modifiche
    if (processedCount > 0) {
      await batch.commit();
      console.log(`🚀 Aggiornati ${processedCount} ordini scaduti.`);
    }

    return response.status(200).json({ 
      success: true, 
      processed: processedCount 
    });

  } catch (error) {
    console.error('❌ Errore nel Cron Job:', error);
    return response.status(500).json({ error: error.message });
  }
}
