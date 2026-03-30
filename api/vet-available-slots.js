const admin = require('firebase-admin');
const crypto = require('crypto');
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('[Vercel Init] Firebase Admin SDK inizializzato con successo.');
  } catch (error) {
    console.error('CRITICAL ERROR: Firebase Admin SDK initialization failed.', error);
  }
}
const db = admin.firestore();

const ALLOWED_ORIGINS = [
    'https://localmente-v3-core.web.app',
    'https://localmente-site.web.app',
    'https://www.civora.it',
];

const ORDER_EMAIL_NOTIFICATION_URL = 'https://nodejs-serverless-function-express-phi-silk.vercel.app/api/trigger-order-email-notification';
const CANCEL_BOOKING_API_URL = 'https://nodejs-serverless-function-express-phi-silk.vercel.app/api/cancel-booking'; 

function setCorsHeaders(req, res) {
    const origin = req.headers.origin;

    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        console.log(`[CORS] Allowed origin: ${origin}`);
    }
    else if (req.headers.host && (req.headers.host.includes('localhost') || req.headers.host.includes('127.0.0.1'))) {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
        console.warn(`[CORS] Local development origin allowed: ${origin || req.headers.host}`);
    }
    else {
        console.warn(`[CORS] Origin not allowed: ${origin || 'unknown'}. No Access-Control-Allow-Origin header set.`);
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
}

const NUMBER_REPUTATION_COLLECTION = 'number_prenotation';

function getOpeningHoursForDate(targetDayStartUTC, vendorData, vendorTimezoneOffsetMinutes) {
    const currentVendorLocalDayStartForChecks = new Date(targetDayStartUTC.getTime() - vendorTimezoneOffsetMinutes * 60 * 1000);

    if (vendorData.special_opening_hours && vendorData.special_opening_hours.length > 0) {
        const specialHourEntry = vendorData.special_opening_hours.find(entry => {
            const specialStartDayLocal = new Date(entry.startDate + 'T00:00:00');
            const specialEndDayLocal = new Date(entry.endDate + 'T23:59:59.999');

            return currentVendorLocalDayStartForChecks.getTime() >= specialStartDayLocal.getTime() &&
                   currentVendorLocalDayStartForChecks.getTime() <= specialEndDayLocal.getTime();
        });

        if (specialHourEntry) {
            if (specialHourEntry.isClosedAllDay) {
                return { isOpen: false, slots: [], message: 'Chiuso per orario speciale.' };
            } else if (specialHourEntry.slots && specialHourEntry.slots.length > 0) {
                return { isOpen: true, slots: specialHourEntry.slots };
            } else {
                return { isOpen: false, slots: [], message: 'Orario speciale configurato ma senza fasce orarie definite.' };
            }
        }
    }

    if (!vendorData.opening_hours_structured) {
        return { isOpen: false, slots: [], message: 'Orari settimanali non configurati.' };
    }

    const dayOfWeekVendorLocalIndex = currentVendorLocalDayStartForChecks.getDay();
    const daysOfWeekNames = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
    const regularHours = vendorData.opening_hours_structured.find(d => d.day === daysOfWeekNames[dayOfWeekVendorLocalIndex]);

    if (!regularHours || !regularHours.isOpen) {
        return { isOpen: false, slots: [], message: 'Clinica chiusa secondo gli orari settimanali.' };
    }

    return { isOpen: true, slots: regularHours.slots };
}

async function isResourceAvailable(vendorId, resourceId, slotStartUTC, slotEndUTC, existingBookingsForResource, ignoreBookingId = null) {
    for (const booking of existingBookingsForResource) {
        if (ignoreBookingId && booking.id === ignoreBookingId) continue;

        const overlaps = (slotStartUTC.getTime() < booking.end.getTime() && booking.start.getTime() < slotEndUTC.getTime());
        
        if (overlaps) {
            return false;
        }
    }
    return true;
}

module.exports = async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    console.log('[CORS] OPTIONS request handled with 200 OK.');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    console.warn(`[API] Method Not Allowed: ${req.method}`);
    return res.status(405).json({ error: 'Metodo non consentito. Utilizzare POST.' });
  }

  try {
    const { action, vendorId } = req.body;

    if (!action) {
        console.warn('[API] Missing action in request body.');
        return res.status(400).json({ error: 'Azione non specificata nel corpo della richiesta.' });
    }
    if (!vendorId && action !== 'register_preferred_client' && action !== 'update_phone_reputation_block_status') { 
        console.warn(`[API] Missing vendorId for action: ${action}`);
        return res.status(400).json({ error: 'ID clinica mancante nella richiesta.' });
    }

    if (action === 'save_service_booking') {
        console.log(`[API] Handling 'save_service_booking' for vendor: ${vendorId}`);
        const payload = req.body;

        const requiredFields = ['vendorId', 'serviceId', 'customerName', 'startDateTime', 'endDateTime', 'bookedTotalOccupiedTime'];
        for (const field of requiredFields) {
            if (payload[field] === undefined || payload[field] === null) {
                console.error(`[Booking] Missing required field: ${field}`);
                return res.status(400).json({ error: `Dati di prenotazione incompleti. Campo mancante: ${field}.` });
            }
        }

        const startDateTimeUTC = new Date(payload.startDateTime);
        const endDateTimeUTC = new Date(payload.endDateTime);

        if (isNaN(startDateTimeUTC.getTime()) || isNaN(endDateTimeUTC.getTime())) {
            console.error(`[Booking] Invalid date/time format in payload: start=${payload.startDateTime}, end=${payload.endDateTime}`);
            return res.status(400).json({ error: 'Date/Ore non valide nel payload. Assicurati siano stringhe ISO 8601 valide.' });
        }

        let actualCustomerId = payload.customerId || null; 
        let isGuestBooking = payload.isGuestBooking || false;
        
        if (!actualCustomerId && payload.customerPhone) {
            actualCustomerId = payload.customerPhone; 
            console.log(`[Booking][Vercel] Prenotazione guest. customerId impostato al numero di telefono: ${actualCustomerId}`);
        }

        let bookedForResourceId = payload.bookedForResourceId;
        let collaboratorId = payload.collaboratorId || null;
        let collaboratorName = payload.collaboratorName || null;

        if (!bookedForResourceId) {
            console.log(`[Booking] Auto-assigning resource for booking for vendor: ${vendorId}, service: ${payload.serviceId}`);

            const [serviceDoc, vendorDoc] = await Promise.all([
                db.collection('artisan_services').doc(payload.serviceId).get(),
                db.collection('vendors').doc(vendorId).get(),
            ]);
            if (!serviceDoc.exists || !vendorDoc.exists) {
                return res.status(404).json({ error: 'Servizio o clinica non trovato per l\'assegnazione automatica.' });
            }
            const serviceData = serviceDoc.data();
            const vendorData = vendorDoc.data();

            let totalOccupiedTimeMinutes = payload.bookedTotalOccupiedTime || serviceData.totalOccupiedTimeMinutes || serviceData.serviceDuration;
            if (!totalOccupiedTimeMinutes || totalOccupiedTimeMinutes <= 0) {
                return res.status(400).json({ error: 'Durata totale del servizio non specificata o non valida per l\'assegnazione automatica.' });
            }

            let potentialResources = [];
            potentialResources.push({ id: vendorId, isOwner: true, name: vendorData.store_name });

            const collaboratorsSnapshot = await db.collection('vendors').doc(vendorId).collection('collaborators')
                .where('isActive', '==', true)
                .get();
            collaboratorsSnapshot.docs.forEach(collabDoc => {
                const collabData = collabDoc.data();
                if (collabData.servicesOffered && collabData.servicesOffered.includes(payload.serviceId)) {
                    potentialResources.push({ id: collabDoc.id, isOwner: false, name: collabData.name, servicesOffered: collabData.servicesOffered });
                }
            });

            if (potentialResources.length === 0) {
                console.warn(`[Booking] No resources (owner or collaborators) found for service ${payload.serviceId} for auto-assignment.`);
                return res.status(409).json({ error: 'Nessun dottore disponibile per assegnare automaticamente questo servizio in questo momento.' });
            }

            let assignedResource = null;
            const allRelevantBookingsSnapshot = await db.collection('bookings')
                .where('vendorId', '==', vendorId)
                .where('bookedForResourceId', 'in', potentialResources.map(r => r.id))
                .where('status', 'in', ['confirmed', 'paid', 'pending', 'rescheduled', 'pending-cash'])
                .where('startDateTime', '<', admin.firestore.Timestamp.fromDate(endDateTimeUTC))
                .where('endDateTime', '>', admin.firestore.Timestamp.fromDate(startDateTimeUTC))
                .get();
            
            const allExistingBookingsForResources = {};
            potentialResources.forEach(res => allExistingBookingsForResources[res.id] = []);
            allRelevantBookingsSnapshot.docs.forEach(doc => {
                const bookingData = doc.data();
                if (allExistingBookingsForResources[bookingData.bookedForResourceId]) {
                    allExistingBookingsForResources[bookingData.bookedForResourceId].push({
                        id: doc.id,
                        start: bookingData.startDateTime.toDate(),
                        end: bookingData.endDateTime.toDate(),
                    });
                }
            });

            for (const resource of potentialResources) {
                const isAvailable = await isResourceAvailable(
                    vendorId, resource.id, startDateTimeUTC, endDateTimeUTC,
                    allExistingBookingsForResources[resource.id], payload.bookingId
                );
                if (isAvailable) {
                    assignedResource = resource;
                    break;
                }
            }

            if (!assignedResource) {
                console.warn(`[Booking] Auto-assignment failed: No available resource found for service ${payload.serviceId} at ${startDateTimeUTC.toISOString()}.`);
                return res.status(409).json({ error: 'Lo slot selezionato non è più disponibile in questo orario.' });
            }

            bookedForResourceId = assignedResource.id;
            collaboratorId = assignedResource.isOwner ? null : assignedResource.id;
            collaboratorName = assignedResource.isOwner ? null : assignedResource.name;
        }

        const cancellationToken = crypto.randomBytes(32).toString('hex');

        const bookingData = {
            vendorId: payload.vendorId,
            serviceId: payload.serviceId,
            customerId: actualCustomerId, 
            customerName: payload.customerName,
            customerPhone: payload.customerPhone || null,
            customerEmail: payload.customerEmail || null,
            bookedServiceName: payload.bookedServiceName,
            bookedServicePrice: payload.bookedServicePrice,
            bookedServiceDuration: payload.bookedServiceDuration,
            bookedPreparationTime: payload.bookedPreparationTime || 0,
            bookedCleanupTime: payload.bookedCleanupTime || 0,
            bookedTotalOccupiedTime: payload.bookedTotalOccupiedTime,
            // QUI IMPOSTIAMO IL TIPO DEFAULT A VETERINARIO
            type: payload.type || 'veterinario',
            status: payload.status || 'pending',

            startDateTime: admin.firestore.Timestamp.fromDate(startDateTimeUTC),
            endDateTime: admin.firestore.Timestamp.fromDate(endDateTimeUTC),

            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            source: payload.source || 'website',
            appointmentCode: payload.appointmentCode || ('WEB_' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000).toString().padStart(3, '0')),
            isNew: true,
            isGuestBooking: isGuestBooking,

            notes: payload.notes || null,
            selectedServiceVariant: payload.selectedServiceVariant || null,
            selectedOptionalExtras: payload.selectedOptionalExtras || [],
            noShowCountAtBooking: payload.noShowCountAtBooking || 0,
            isNewGuest: payload.isNewGuest || false,

            customerGender: payload.customerGender || null,
            customerAgeRange: payload.customerAgeRange || null,
            selectedImageDetails: payload.selectedImageDetails || null,

            collaboratorId: collaboratorId,
            collaboratorName: collaboratorName,
            bookedForResourceId: bookedForResourceId,
            cancellationToken: cancellationToken 
        };

        // --- SISTEMA ANTI-OVERBOOKING: FIRESTORE TRANSACTIONS ---
        let createdBookingId;
        try {
            const resourceRef = bookedForResourceId === payload.vendorId
                ? db.collection('vendors').doc(payload.vendorId)
                : db.collection('vendors').doc(payload.vendorId).collection('collaborators').doc(bookedForResourceId);

            createdBookingId = await db.runTransaction(async (transaction) => {
                const resourceDoc = await transaction.get(resourceRef);
                if (!resourceDoc.exists) { throw new Error("RESOURCE_NOT_FOUND"); }

                let bookingQuery = db.collection('bookings')
                    .where('vendorId', '==', payload.vendorId)
                    .where('bookedForResourceId', '==', bookedForResourceId)
                    .where('status', 'in', ['confirmed', 'paid', 'pending', 'rescheduled', 'pending-cash'])
                    .where('startDateTime', '<', admin.firestore.Timestamp.fromDate(endDateTimeUTC))
                    .where('endDateTime', '>', admin.firestore.Timestamp.fromDate(startDateTimeUTC));

                if (payload.bookingId) {
                    bookingQuery = bookingQuery.where(admin.firestore.FieldPath.documentId(), '!=', payload.bookingId);
                }

                const existingOverlaps = await transaction.get(bookingQuery);

                if (!existingOverlaps.empty) { throw new Error("OVERLAP_DETECTED"); }

                const newBookingRef = db.collection('bookings').doc();
                transaction.set(newBookingRef, bookingData);

                transaction.update(resourceRef, {
                    lastBookingUpdate: admin.firestore.FieldValue.serverTimestamp()
                });

                return newBookingRef.id;
            });

        } catch (error) {
            if (error.message === "OVERLAP_DETECTED") {
                return res.status(409).json({ error: 'Lo slot selezionato non è più disponibile o si sovrappone con un appuntamento esistente.' });
            } else if (error.message === "RESOURCE_NOT_FOUND") {
                return res.status(404).json({ error: 'Medico non trovato.' });
            }
            throw error; 
        }
        // --- FINE SISTEMA ANTI-OVERBOOKING ---

        // (La parte della reputazione numero rimane invariata)
        if (payload.isNewGuest === true && payload.customerPhone && payload.customerName) {
            try {
                const phoneDocRef = db.collection(NUMBER_REPUTATION_COLLECTION).doc(payload.customerPhone);
                const reputationData = {
                    phone_number: payload.customerPhone,
                    no_show_count: 0,
                    customerName: payload.customerName.split(' ')[0],
                    dobPart: '00',
                    customerEmail: payload.customerEmail || null,
                    first_booking_at: admin.firestore.FieldValue.serverTimestamp(),
                    is_blocked: false,
                    isNewGuest: false
                };
                await phoneDocRef.set(reputationData, { merge: true });
            } catch(error) {
                console.error("[Reputation] ERROR:", error);
            }
        }

        // Trigger email
        if (bookingData.source === 'website' || (bookingData.appointmentCode && bookingData.appointmentCode.startsWith('WEB_'))) {
            try {
                const vendorDoc = await db.collection('vendors').doc(vendorId).get();
                const merchantEmail = vendorDoc.exists ? vendorDoc.data().email : null;
                const vendorName = vendorDoc.exists ? vendorDoc.data().store_name : 'Clinica Veterinaria';

                if (merchantEmail || bookingData.customerEmail) {
                    const emailPayload = {
                        notificationType: 'appointment_booking',
                        vendorId: bookingData.vendorId,
                        bookingDetails: {
                            id: createdBookingId,
                            appointmentCode: bookingData.appointmentCode,
                            customerName: bookingData.customerName,
                            customerEmail: bookingData.customerEmail,
                            customerPhone: bookingData.customerPhone,
                            bookedServiceName: bookingData.bookedServiceName,
                            bookedServicePrice: bookingData.bookedServicePrice,
                            bookedTotalOccupiedTime: bookingData.bookedTotalOccupiedTime,
                            startDateTime: bookingData.startDateTime,
                            endDateTime: bookingData.endDateTime,
                            collaboratorName: bookingData.collaboratorName || '',
                            notes: bookingData.notes || '',
                            vendorName: vendorName,
                            vendorEmail: merchantEmail,
                            selectedOptionalExtras: bookingData.selectedOptionalExtras || [],
                            cancellationToken: cancellationToken
                        },
                        recipients: {
                            customer: bookingData.customerEmail,
                            merchant: merchantEmail
                        }
                    };

                    await fetch(ORDER_EMAIL_NOTIFICATION_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(emailPayload),
                    });
                }
            } catch (emailError) {
                console.error(`[Booking] Errore notifica email:`, emailError);
            }
        }

        // ============================================================
        // 🚀 INVIO NOTIFICA PUSH (FCM) AL TELEFONO DEL VETERINARIO
        // ============================================================
        try {
            const vendorDocForPush = await db.collection('vendors').doc(payload.vendorId).get();
            const vendorDataForPush = vendorDocForPush.exists ? vendorDocForPush.data() : null;

            if (vendorDataForPush && vendorDataForPush.fcmToken && vendorDataForPush.notificationsEnabled !== false) {
                const pushMessage = {
                    token: vendorDataForPush.fcmToken,
                    notification: {
                        // ADATTATO PER VET:
                        title: '🐾 Nuovo Appuntamento Vet!',
                        body: `${payload.customerName} ha prenotato: ${payload.bookedServiceName}`
                    },
                    data: {
                        type: 'appointment_booking',
                        bookingId: createdBookingId,
                        click_action: 'FLUTTER_NOTIFICATION_CLICK' 
                    },
                    android: {
                        priority: 'high',
                        notification: {
                            sound: 'default',
                            // ADATTATO PER VET:
                            channelId: 'civora_vet_bookings_channel',
                            priority: 'high',
                            visibility: 'public'
                        }
                    },
                    apns: {
                        payload: {
                            aps: {
                                sound: 'default',
                                contentAvailable: true
                            }
                        }
                    }
                };

                await admin.messaging().send(pushMessage);
            }
        } catch (pushError) {
            console.error('[Push] ⚠️ Errore invio notifica push:', pushError);
        }
        // ============================================================

        return res.status(200).json({
            success: true,
            message: 'Prenotazione creata con successo.',
            bookingId: createdBookingId
        });
    }

    else if (action === 'getAvailableSlots') {
      // Tutta la matematica di getAvailableSlots rimane IDENTICA, gestisce il tempo universalmente
      console.log(`[API][getAvailableSlots] Handling 'getAvailableSlots' for vendor: ${vendorId}`);
      const { serviceId, date, bookedForResourceId: requestedBookedForResourceId, totalOccupiedTimeMinutes: durationFromFrontend } = req.body;

      const requiredFields = ['vendorId', 'serviceId', 'date'];
      for (const field of requiredFields) {
          if (req.body[field] === undefined || req.body[field] === null) {
              return res.status(400).json({ error: `Dati mancanti. Campo mancante: ${field}.` });
          }
      }

      const isAutoAssignRequest = !requestedBookedForResourceId;

      const [serviceDoc, vendorDoc] = await Promise.all([
          db.collection('artisan_services').doc(serviceId).get(),
          db.collection('vendors').doc(vendorId).get(),
      ]);

      if (!serviceDoc.exists) return res.status(404).json({ error: 'Servizio non trovato.' });
      
      const serviceData = serviceDoc.data();
      const vendorData = vendorDoc.data();
      const vendorTimezoneOffsetMinutes = vendorData.timezoneOffsetMinutes !== undefined ? vendorData.timezoneOffsetMinutes : 0;

      let totalOccupiedTimeMinutes = durationFromFrontend || serviceData.totalOccupiedTimeMinutes || serviceData.serviceDuration;
      if (!totalOccupiedTimeMinutes || totalOccupiedTimeMinutes <= 0) return res.status(400).json({ error: 'Durata totale non valida.' });

      if (!vendorDoc.exists) return res.status(404).json({ slots: [], message: 'Dati della clinica non trovati.' });

      let potentialResources = [];
      potentialResources.push({ id: vendorId, isOwner: true, name: vendorData.store_name || 'Dottore Principale' });

      if (isAutoAssignRequest) {
          const collaboratorsSnapshot = await db.collection('vendors').doc(vendorId).collection('collaborators').where('isActive', '==', true).get();
          collaboratorsSnapshot.docs.forEach(collabDoc => {
              const collabData = collabDoc.data();
              if (collabData.servicesOffered && collabData.servicesOffered.includes(serviceId)) {
                  potentialResources.push({ id: collabDoc.id, isOwner: false, name: collabData.name, servicesOffered: collabData.servicesOffered });
              }
          });
      } else {
          if (requestedBookedForResourceId !== vendorId) {
              const collaboratorDoc = await db.collection('vendors').doc(vendorId).collection('collaborators').doc(requestedBookedForResourceId).get();
              if (!collaboratorDoc.exists || !collaboratorDoc.data().servicesOffered.includes(serviceId)) {
                  return res.status(200).json({ slots: [], message: 'Questo medico non effettua la prestazione richiesta.' });
              }
              potentialResources = [{ id: requestedBookedForResourceId, isOwner: false, name: collaboratorDoc.data().name, servicesOffered: collaboratorDoc.data().servicesOffered }];
          }
      }

      const year = parseInt(date.substring(0,4));
      const month = parseInt(date.substring(5,7)) - 1;
      const day = parseInt(date.substring(8,10));

      const startOfTargetDayUTC = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
      const selectedDayStartUTC = new Date(startOfTargetDayUTC.getTime() + vendorTimezoneOffsetMinutes * 60 * 1000);
      const selectedDayEndUTC = new Date(selectedDayStartUTC.getTime() + (24 * 60 * 60 * 1000) - 1);

      const openingHoursResult = getOpeningHoursForDate(selectedDayStartUTC, vendorData, vendorTimezoneOffsetMinutes);

      if (!openingHoursResult.isOpen) {
          return res.status(200).json({ slots: [], message: openingHoursResult.message });
      }
      const todayHoursSlots = openingHoursResult.slots;

      const nowUTC = new Date();
      const nowVendorLocal = new Date(nowUTC.getTime() - vendorTimezoneOffsetMinutes * 60 * 1000);
      const nowVendorLocalFormattedDate = nowVendorLocal.toISOString().split('T')[0];
      const isTodayForVendor = (date === nowVendorLocalFormattedDate);

      const queryStartRangeUTC = new Date(selectedDayStartUTC.getTime() - (24 * 60 * 60 * 1000));
      const queryEndRangeUTC = new Date(selectedDayEndUTC.getTime() + (24 * 60 * 60 * 1000));

      const allRelevantBookingsSnapshot = await db.collection('bookings')
          .where('vendorId', '==', vendorId)
          .where('bookedForResourceId', 'in', potentialResources.map(r => r.id))
          .where('status', 'in', ['confirmed', 'paid', 'pending', 'rescheduled', 'pending-cash'])
          .where('startDateTime', '>=', admin.firestore.Timestamp.fromDate(queryStartRangeUTC))
          .where('startDateTime', '<=', admin.firestore.Timestamp.fromDate(queryEndRangeUTC))
          .get();

      const allExistingBookingsForResources = {};
      potentialResources.forEach(res => allExistingBookingsForResources[res.id] = []);
      allRelevantBookingsSnapshot.docs.forEach(doc => {
          const bookingData = doc.data();
          if (allExistingBookingsForResources[bookingData.bookedForResourceId]) {
              allExistingBookingsForResources[bookingData.bookedForResourceId].push({
                  id: doc.id,
                  start: bookingData.startDateTime.toDate(),
                  end: bookingData.endDateTime.toDate(),
              });
          }
      });

      const availableSlots = [];
      const slotIncrement = 5;

      for (const slot of todayHoursSlots) {
          if (!slot.from || !slot.to) continue;

          const [startHour, startMinute] = slot.from.split(':').map(Number);
          const [endHour, endMinute] = slot.to.split(':').map(Number);

          let currentWorkSlotStartUTC = new Date(selectedDayStartUTC.getTime() + (startHour * 60 + startMinute) * 60 * 1000);
          let currentWorkSlotEndUTC = new Date(selectedDayStartUTC.getTime() + (endHour * 60 + endMinute) * 60 * 1000);

          if (currentWorkSlotEndUTC.getTime() <= currentWorkSlotStartUTC.getTime()) {
              currentWorkSlotEndUTC.setUTCDate(currentWorkSlotEndUTC.getUTCDate() + 1);
          }

          let currentSlotTimeUTC = new Date(currentWorkSlotStartUTC);

          if (isTodayForVendor) {
              let adjustedNowUTC = new Date(nowUTC);
              const currentMins = adjustedNowUTC.getUTCMinutes();
              const remainder = currentMins % slotIncrement;
              if (remainder !== 0) {
                  adjustedNowUTC.setUTCMinutes(currentMins + (slotIncrement - remainder));
              }
              adjustedNowUTC.setUTCSeconds(0,0);
              adjustedNowUTC.setUTCMilliseconds(0);

              currentSlotTimeUTC = new Date(Math.max(currentSlotTimeUTC.getTime(), adjustedNowUTC.getTime()));
          }

          if (currentSlotTimeUTC.getTime() >= currentWorkSlotEndUTC.getTime()) continue;

          while (currentSlotTimeUTC.getTime() < currentWorkSlotEndUTC.getTime()) {
              const potentialEndTimeUTC = new Date(currentSlotTimeUTC.getTime() + totalOccupiedTimeMinutes * 60000);
              if (potentialEndTimeUTC.getTime() > currentWorkSlotEndUTC.getTime()) break;

              let isSlotAvailableForThisTime = false;
              let maxBlockingEndTimeAcrossAllResources = new Date(currentSlotTimeUTC.getTime() + slotIncrement * 60000);

              for (const resource of potentialResources) {
                  const bookingsForThisResourceOnDay = allExistingBookingsForResources[resource.id].filter(booking => 
                      booking.start.getTime() < selectedDayEndUTC.getTime() && booking.end.getTime() > selectedDayStartUTC.getTime()
                  );
                  
                  const isCurrentResourceAvailable = await isResourceAvailable(
                      vendorId, resource.id, currentSlotTimeUTC, potentialEndTimeUTC,
                      bookingsForThisResourceOnDay
                  );

                  if (isCurrentResourceAvailable) {
                      isSlotAvailableForThisTime = true;
                      break;
                  } else {
                      for (const booking of bookingsForThisResourceOnDay) {
                          const overlaps = (currentSlotTimeUTC.getTime() < booking.end.getTime() && booking.start.getTime() < potentialEndTimeUTC.getTime());
                          if (overlaps) {
                              const blockingBookingEndTimeUTC = booking.end.getTime();
                              if (blockingBookingEndTimeUTC > maxBlockingEndTimeAcrossAllResources.getTime()) {
                                  let newTimeUTC = new Date(blockingBookingEndTimeUTC);
                                  const mins = newTimeUTC.getUTCMinutes();
                                  const remainder = mins % slotIncrement;
                                  if (remainder !== 0) {
                                      newTimeUTC.setUTCMinutes(mins + (slotIncrement - remainder));
                                  }
                                  newTimeUTC.setUTCSeconds(0,0);
                                  newTimeUTC.setUTCMilliseconds(0);
                                  maxBlockingEndTimeAcrossAllResources = newTimeUTC;
                              }
                          }
                      }
                  }
              }

              if (isSlotAvailableForThisTime) {
                  const displaySlotTime = new Date(currentSlotTimeUTC.getTime() - vendorTimezoneOffsetMinutes * 60 * 1000);
                  const hours = String(displaySlotTime.getHours()).padStart(2, '0');
                  const minutes = String(displaySlotTime.getMinutes()).padStart(2, '0');
                  availableSlots.push(`${hours}:${minutes}`);
                  currentSlotTimeUTC.setUTCMinutes(currentSlotTimeUTC.getUTCMinutes() + slotIncrement);
              } else {
                  currentSlotTimeUTC = maxBlockingEndTimeAcrossAllResources;
              }
          }
      }
      return res.status(200).json({ slots: availableSlots });
    }

    // Le altre funzioni (getMonthlyAvailabilitySummary e getAvailableSlotsRange) 
    // funzionano esattamente nello stesso modo e non hanno bisogno di stringhe fisse 
    // relative a 'cura_persona', quindi vanno lasciate identiche a prima.
    // Per brevità (per stare dentro i limiti della risposta) qui chiudo lo script come avevi fatto tu, 
    // MA ricorda che nel tuo file Vercel DEVI incollare anche gli "else if" di 
    // getMonthlyAvailabilitySummary e getAvailableSlotsRange esattamente come erano nel file originale.

    // === INCOLLA QUI GLI ALTRI ELSE IF COME DA TUO CODICE ORIGINALE ===
    
    // (Ometto gli ultimi due blocchi else if lunghi solo per non farti scrollare 20 pagine, 
    // tu copiali pari pari dal tuo file vecchio perche' non c'erano stringhe 'cura_persona' li dentro!)

    else if (action === 'register_preferred_client') {
        const { vendorId: registerVendorId, name, surname, phone, email, notes } = req.body;

        const requiredFields = ['vendorId', 'name', 'phone'];
        for (const field of requiredFields) {
            if (req.body[field] === undefined || req.body[field] === null) {
                return res.status(400).json({ error: `Dati cliente incompleti. Campo mancante: ${field}.` });
            }
        }

        const vendorRef = db.collection('vendors').doc(registerVendorId);
        const vendorDoc = await vendorRef.get();
        if (!vendorDoc.exists) return res.status(404).json({ error: 'Clinica non trovata.' });

        const existingClientSnap = await vendorRef.collection('clients')
            .where('name', '==', name)
            .where('phone', '==', phone)
            .limit(1)
            .get();

        if (!existingClientSnap.empty) {
            const existingClientDoc = existingClientSnap.docs[0];
            const updatedData = {
                surname: surname || existingClientDoc.data().surname || null,
                email: email || existingClientDoc.data().email || null,
                notes: notes || existingClientDoc.data().notes || null,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                source: 'civora_storefront_update',
            };
            await existingClientDoc.ref.update(updatedData);
            return res.status(200).json({ success: true, clientId: existingClientDoc.id });
        }

        const clientData = {
            name: name,
            surname: surname || null,
            phone: phone,
            email: email || null,
            notes: notes || null,
            registeredAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            source: 'civora_storefront',
        };

        const docRef = await vendorRef.collection('clients').add(clientData);
        return res.status(200).json({ success: true, clientId: docRef.id });
    }

    else if (action === 'update_phone_reputation_block_status') {
        const { phoneNumber, isBlocked } = req.body;
        if (!phoneNumber || typeof isBlocked !== 'boolean') return res.status(400).json({ error: 'Dati mancanti.' });
        
        try {
            const phoneDocRef = db.collection(NUMBER_REPUTATION_COLLECTION).doc(phoneNumber);
            await phoneDocRef.set({ phone_number: phoneNumber, is_blocked: isBlocked, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: 'Errore server.' });
        }
    }

    return res.status(400).json({ error: `Azione non riconosciuta: ${action}.` });

  } catch (error) {
    console.error('SERVER ERROR: Uncaught error in Vercel function:', error);
    res.status(500).json({ error: 'Errore interno del server.', details: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};
