const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) {
  try {
    let rawKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (rawKey) {
      rawKey = rawKey.trim();
      // Se è codificata in Base64 (inizia per "ewog..."), la decodifica al volo
      if (!rawKey.startsWith('{')) {
        rawKey = Buffer.from(rawKey, 'base64').toString('utf8');
      }
      const serviceAccount = JSON.parse(rawKey);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('[Vercel Init - Vet] Firebase Admin SDK inizializzato con successo.');
    } else {
      console.error('CRITICAL ERROR: FIREBASE_SERVICE_ACCOUNT_KEY non trovata nelle variabili d\'ambiente.');
    }
  } catch (error) {
    console.error('CRITICAL ERROR: Firebase Admin SDK initialization failed.', error);
  }
}
const db = admin.firestore();

// --- CALCOLO DINAMICO DELL'ORA LEGALE/SOLARE ---
function getDynamicOffsetMinutes(date, timeZone = 'Europe/Rome') {
    try {
        const loc = date.toLocaleString("en-US", { timeZone });
        const utc = date.toLocaleString("en-US", { timeZone: "UTC" });
        const diff = new Date(utc) - new Date(loc);
        return diff / 60000;
    } catch (e) {
        console.error("[Timezone] Errore calcolo offset dinamico:", e);
        return 0;
    }
}

const ALLOWED_ORIGINS = [
    'https://localmente-v3-core.web.app',
    'https://localmente-site.web.app',
    'https://www.civora.it',
    'https://civora.it',
];

const ORDER_EMAIL_NOTIFICATION_URL = 'https://nodejs-serverless-function-express-phi-silk.vercel.app/api/trigger-order-email-notification';
const CANCEL_BOOKING_API_URL = 'https://nodejs-serverless-function-express-phi-silk.vercel.app/api/cancel-booking';

// --- GUARDIANO DI SICUREZZA CON TIMEOUT PER CHIAMATE ESTERNE ---
async function safeFetch(url, options = {}, timeoutMs = 3500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
    } catch (err) {
        console.warn(`[SafeFetch] Chiamata a ${url.substring(0, 45)}... interrotta per timeout (${timeoutMs}ms):`, err.message);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function setCorsHeaders(req, res) {
    const origin = req.headers.origin;

    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (req.headers.host && (req.headers.host.includes('localhost') || req.headers.host.includes('127.0.0.1'))) {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
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
                return { isOpen: false, slots: [], message: 'Chiuso per orario speciale / festività.' };
            } else if (specialHourEntry.slots && specialHourEntry.slots.length > 0) {
                return { isOpen: true, slots: specialHourEntry.slots };
            } else {
                return { isOpen: false, slots: [], message: 'Orario speciale configurato ma senza fasce definite.' };
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
        return { isOpen: false, slots: [], message: 'Attività chiusa secondo gli orari settimanali.' };
    }

    return { isOpen: true, slots: regularHours.slots };
}

// === GESTIONE ASSENZE E FERIE MEDICI / TOELETTATORI ===
async function getAbsentResourceIds(vendorId, dateStr) {
    try {
        const absencesSnapshot = await db.collection('vendors').doc(vendorId).collection('absences')
            .where('startDate', '<=', dateStr)
            .get();

        const absentIds = new Set();
        absencesSnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.endDate >= dateStr) {
                absentIds.add(data.resourceId);
            }
        });
        return absentIds;
    } catch (error) {
        console.error("[Absences Vet] Errore recupero assenze:", error);
        return new Set();
    }
}

async function getAbsencesForRange(vendorId, startDateStr, endDateStr) {
    try {
        const absencesSnapshot = await db.collection('vendors').doc(vendorId).collection('absences')
            .where('startDate', '<=', endDateStr)
            .get();

        const absencesList = [];
        absencesSnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.endDate >= startDateStr) {
                absencesList.push({
                    resourceId: data.resourceId,
                    startDate: data.startDate,
                    endDate: data.endDate
                });
            }
        });
        return absencesList;
    } catch (error) {
        console.error("[Absences Vet] Errore recupero assenze range:", error);
        return [];
    }
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
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo non consentito. Utilizzare POST.' });
  }

  try {
      const { action, vendorId } = req.body;

      if (!action) {
          return res.status(400).json({ error: 'Azione non specificata nel corpo della richiesta.' });
      }
      if (!vendorId && action !== 'register_preferred_client' && action !== 'update_phone_reputation_block_status' && action !== 'invia_promemoria_automatici') {
          return res.status(400).json({ error: 'ID attività/clinica mancante nella richiesta.' });
      }

    // ============================================================
    // 1. SALVATAGGIO APPUNTAMENTO VETERINARIO & TOELETTATURA
    // ============================================================
    if (action === 'save_service_booking') {
        const payload = req.body;

        const requiredFields = ['vendorId', 'serviceId', 'customerName', 'startDateTime', 'endDateTime', 'bookedTotalOccupiedTime'];
        for (const field of requiredFields) {
            if (payload[field] === undefined || payload[field] === null) {
                return res.status(400).json({ error: `Dati di prenotazione incompleti. Campo mancante: ${field}.` });
            }
        }

        const startDateTimeUTC = new Date(payload.startDateTime);
        const endDateTimeUTC = new Date(payload.endDateTime);

        if (isNaN(startDateTimeUTC.getTime()) || isNaN(endDateTimeUTC.getTime())) {
            return res.status(400).json({ error: 'Date/Ore non valide nel payload. Devono essere stringhe ISO 8601.' });
        }

        // Controllo Ferie e Chiusura
        const bookingDateStr = startDateTimeUTC.toISOString().split('T')[0];
        const absentIdsForBooking = await getAbsentResourceIds(vendorId, bookingDateStr);
        if (absentIdsForBooking.has('all')) {
            return res.status(409).json({ error: 'Siamo spiacenti, la struttura è chiusa per ferie o chiusura programmata in questa data.' });
        }
        if (payload.bookedForResourceId && absentIdsForBooking.has(payload.bookedForResourceId)) {
            return res.status(409).json({ error: 'Il dottore o la postazione selezionata è assente in questa data.' });
        }

        let actualCustomerId = payload.customerId || null;
        let isGuestBooking = payload.isGuestBooking || false;

        if (!actualCustomerId && payload.customerPhone) {
            actualCustomerId = payload.customerPhone;
        }

        let bookedForResourceId = payload.bookedForResourceId;
        let collaboratorId = payload.collaboratorId || null;
        let collaboratorName = payload.collaboratorName || null;

        // Assegnazione automatica della risorsa se non specificata
        if (!bookedForResourceId) {
            const [serviceDoc, vendorDoc] = await Promise.all([
                db.collection('artisan_services').doc(payload.serviceId).get(),
                db.collection('vendors').doc(vendorId).get(),
            ]);
            if (!serviceDoc.exists || !vendorDoc.exists) {
                return res.status(404).json({ error: 'Prestazione o clinica non trovata per l\'assegnazione automatica.' });
            }
            const serviceData = serviceDoc.data();
            const vendorData = vendorDoc.data();

            let totalOccupiedTimeMinutes = payload.bookedTotalOccupiedTime || serviceData.totalOccupiedTimeMinutes || serviceData.serviceDuration;
            if (!totalOccupiedTimeMinutes || totalOccupiedTimeMinutes <= 0) {
                return res.status(400).json({ error: 'Durata della prestazione non specificata o non valida.' });
            }

            let potentialResources = [];
            const ownerOffersService = !vendorData.servicesOffered || !Array.isArray(vendorData.servicesOffered) || vendorData.servicesOffered.length === 0 || vendorData.servicesOffered.includes(payload.serviceId);

            if (ownerOffersService && !absentIdsForBooking.has(vendorId)) {
                potentialResources.push({
                    id: vendorId,
                    isOwner: true,
                    name: vendorData.store_name || 'Dottore Principale',
                    role: 'owner',
                    servicesOffered: vendorData.servicesOffered || null
                });
            }

            const collaboratorsSnapshot = await db.collection('vendors').doc(vendorId).collection('collaborators')
                .where('isActive', '==', true)
                .get();
            collaboratorsSnapshot.docs.forEach(collabDoc => {
                const collabData = collabDoc.data();
                if (!absentIdsForBooking.has(collabDoc.id) && collabData.servicesOffered && Array.isArray(collabData.servicesOffered) && collabData.servicesOffered.includes(payload.serviceId)) {
                    potentialResources.push({
                        id: collabDoc.id,
                        isOwner: collabData.role === 'owner',
                        name: collabData.name,
                        role: collabData.role || 'collaborator',
                        servicesOffered: collabData.servicesOffered
                    });
                }
            });

            if (potentialResources.length === 0) {
                return res.status(409).json({ error: 'Nessun medico o postazione disponibile per questa prestazione in data odierna.' });
            }

            const queryStartRange = new Date(startDateTimeUTC.getTime() - (24 * 60 * 60 * 1000));
            const queryEndRange = new Date(endDateTimeUTC.getTime() + (24 * 60 * 60 * 1000));

            const allRelevantBookingsSnapshot = await db.collection('bookings')
                .where('vendorId', '==', vendorId)
                .where('bookedForResourceId', 'in', potentialResources.map(r => r.id))
                .where('status', 'in', ['confirmed', 'paid', 'pending', 'rescheduled', 'pending-cash'])
                .where('startDateTime', '>=', admin.firestore.Timestamp.fromDate(queryStartRange))
                .where('startDateTime', '<=', admin.firestore.Timestamp.fromDate(queryEndRange))
                .get();

            const allExistingBookingsForResources = {};
            potentialResources.forEach(res => allExistingBookingsForResources[res.id] = []);
            allRelevantBookingsSnapshot.docs.forEach(doc => {
                const bData = doc.data();
                if (allExistingBookingsForResources[bData.bookedForResourceId]) {
                    allExistingBookingsForResources[bData.bookedForResourceId].push({
                        id: doc.id,
                        start: bData.startDateTime.toDate(),
                        end: bData.endDateTime.toDate(),
                    });
                }
            });

            const availableCandidates = [];
            for (const resource of potentialResources) {
                const isAvailable = await isResourceAvailable(
                    vendorId, resource.id, startDateTimeUTC, endDateTimeUTC,
                    allExistingBookingsForResources[resource.id], payload.bookingId
                );
                if (isAvailable) {
                    availableCandidates.push(resource);
                }
            }

            if (availableCandidates.length === 0) {
                return res.status(409).json({ error: 'Lo slot selezionato non è più disponibile. Scegli un altro orario.' });
            }

            const assignedResource = availableCandidates[0];
            bookedForResourceId = assignedResource.id;
            collaboratorId = assignedResource.id === vendorId ? null : assignedResource.id;
            collaboratorName = assignedResource.name;
        }

        const cancellationToken = crypto.randomBytes(32).toString('hex');

        const isExplicitManual = (payload.appointmentCode && (payload.appointmentCode.startsWith('MANUAL_') || payload.appointmentCode.startsWith('COLLAB_') || payload.appointmentCode.startsWith('WALKIN_'))) ||
                                 (payload.source && (payload.source.includes('dashboard') || payload.source.includes('totem_operator'))) ||
                                 payload.bookingOrigin === 'manual';

        const finalBookingOrigin = isExplicitManual ? 'manual' : 'online';
        const finalPlatformFee = isExplicitManual ? 0.00 : 0.10;
        const finalSource = isExplicitManual ? (payload.source || 'dashboard_manual') : 'website';
        const finalAppointmentCode = payload.appointmentCode || (isExplicitManual ? ('MANUAL_' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000).toString().padStart(3, '0')) : ('WEB_' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000).toString().padStart(3, '0')));

        // Calcolo Promemoria Intelligenti con protezione notturna
        const nowTimeMs = Date.now();
        const startTimeMs = startDateTimeUTC.getTime();
        const diffMinutes = Math.floor((startTimeMs - nowTimeMs) / (60 * 1000));
        const todayDateStr = new Date().toISOString().split('T')[0];
        const isSameDay = (todayDateStr === bookingDateStr);

        let rem1Time = null;
        let rem1Sent = true;
        let rem2Time = null;
        let rem2Sent = true;

        if (isSameDay) {
            if (diffMinutes < 45) {
                rem1Time = null;
                rem1Sent = true;
            } else if (diffMinutes <= 180) {
                rem1Time = admin.firestore.Timestamp.fromDate(new Date(startTimeMs - (20 * 60 * 1000)));
                rem1Sent = false;
            } else {
                rem1Time = admin.firestore.Timestamp.fromDate(new Date(startTimeMs - (60 * 60 * 1000)));
                rem1Sent = false;
            }
        } else {
            let rem1DateObj = new Date(startTimeMs - (4 * 60 * 60 * 1000));
            const hourInRome = parseInt(rem1DateObj.toLocaleTimeString('it-IT', { hour: '2-digit', hour12: false, timeZone: 'Europe/Rome' }), 10);

            if (hourInRome < 8 || hourInRome >= 22) {
                const eveningBefore = new Date(startTimeMs - (24 * 60 * 60 * 1000));
                const offsetDiff = getDynamicOffsetMinutes(eveningBefore, 'Europe/Rome') * 60 * 1000;
                const startOfDayUTC = new Date(Date.UTC(eveningBefore.getFullYear(), eveningBefore.getMonth(), eveningBefore.getDate(), 0, 0, 0));
                rem1DateObj = new Date(startOfDayUTC.getTime() + (20 * 60 * 60 * 1000) + offsetDiff);
            }

            if (rem1DateObj.getTime() <= nowTimeMs) {
                rem1Time = null;
                rem1Sent = true;
            } else {
                rem1Time = admin.firestore.Timestamp.fromDate(rem1DateObj);
                rem1Sent = false;
            }

            rem2Time = admin.firestore.Timestamp.fromDate(new Date(startTimeMs - (30 * 60 * 1000)));
            rem2Sent = false;
        }

        // COSTRUZIONE DOCUMENTO PRENOTAZIONE PER IL MONDO ANIMALI
        const bookingData = {
            vendorId: payload.vendorId,
            serviceId: payload.serviceId,
            customerId: actualCustomerId,
            customerName: payload.customerName,
            customerPhone: payload.customerPhone || null,
            customerEmail: payload.customerEmail || null,

            // 🐾 CAMPI NATIVI MONDO ANIMALI 🐾
            petName: payload.petName || null,
            petType: payload.petType || 'Cane', // Cane, Gatto, Coniglio, ecc.
            petBreed: payload.petBreed || null, // Razza
            petSize: payload.petSize || null,   // Taglia: Piccola, Media, Grande (cruciale per toelettatura)
            petWeight: payload.petWeight || null,
            petMicrochip: payload.petMicrochip || null,
            petNotes: payload.petNotes || null, // Carattere, allergie, fobie

            bookedServiceName: payload.bookedServiceName || 'Visita / Prestazione',
            bookedServicePrice: (payload.bookedServicePrice !== undefined && payload.bookedServicePrice !== null) ? payload.bookedServicePrice : 0,
            bookedServiceDuration: payload.bookedServiceDuration || payload.bookedTotalOccupiedTime || 30,
            bookedPreparationTime: payload.bookedPreparationTime || 0,
            bookedCleanupTime: payload.bookedCleanupTime || 0,
            bookedTotalOccupiedTime: payload.bookedTotalOccupiedTime || 30,

            // SETTORE DICHIARATO: cura_animali
            type: payload.type || 'cura_animali',
            status: payload.status || 'pending',

            paymentStatus: payload.paymentStatus || 'pending',
            paymentMethod: payload.paymentMethod || (isExplicitManual ? 'cash_in_studio' : 'website'),

            bookingOrigin: finalBookingOrigin,
            platformFee: finalPlatformFee,
            source: finalSource,
            appointmentCode: finalAppointmentCode,

            startDateTime: admin.firestore.Timestamp.fromDate(startDateTimeUTC),
            endDateTime: admin.firestore.Timestamp.fromDate(endDateTimeUTC),

            reminder1_time: rem1Time,
            reminder1_sent: rem1Sent,
            reminder2_time: rem2Time,
            reminder2_sent: rem2Sent,

            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            isNew: isExplicitManual ? false : true,
            isGuestBooking: isGuestBooking,

            notes: payload.notes || null,
                        bookedServiceItems: payload.bookedServiceItems || null,
                        selectedServiceVariant: payload.selectedServiceVariant || null,
                        selectedOptionalExtras: payload.selectedOptionalExtras || [],
                        noShowCountAtBooking: payload.noShowCountAtBooking || 0,
                        isNewGuest: payload.isNewGuest || false,
                        selectedImageDetails: payload.selectedImageDetails || null,

                        collaboratorId: collaboratorId,
                        collaboratorName: collaboratorName,
                        bookedForResourceId: bookedForResourceId,
                        cancellationToken: cancellationToken
                    };

        // TRANSAZIONE ANTI-OVERBOOKING FIRESTORE
        let createdBookingId;
        try {
            const resourceRef = bookedForResourceId === payload.vendorId
                ? db.collection('vendors').doc(payload.vendorId)
                : db.collection('vendors').doc(payload.vendorId).collection('collaborators').doc(bookedForResourceId);

            createdBookingId = await db.runTransaction(async (transaction) => {
                const resourceDoc = await transaction.get(resourceRef);
                if (!resourceDoc.exists) {
                    throw new Error("RESOURCE_NOT_FOUND");
                }

                const TX_OVERLAP_BUFFER_MINUTES = 180;
                const txQueryStart = new Date(startDateTimeUTC.getTime() - (TX_OVERLAP_BUFFER_MINUTES * 60 * 1000));
                const txQueryEnd = endDateTimeUTC;

                let bookingQuery = db.collection('bookings')
                    .where('vendorId', '==', payload.vendorId)
                    .where('bookedForResourceId', '==', bookedForResourceId)
                    .where('status', 'in', ['confirmed', 'paid', 'pending', 'rescheduled', 'pending-cash'])
                    .where('startDateTime', '>=', admin.firestore.Timestamp.fromDate(txQueryStart))
                    .where('startDateTime', '<=', admin.firestore.Timestamp.fromDate(txQueryEnd));

                const possibleOverlaps = await transaction.get(bookingQuery);
                let hasActualOverlap = false;

                possibleOverlaps.docs.forEach(doc => {
                    if (payload.bookingId && doc.id === payload.bookingId) return;
                    const b = doc.data();
                    const bStart = b.startDateTime.toDate().getTime();
                    const bEnd = b.endDateTime.toDate().getTime();
                    if (startDateTimeUTC.getTime() < bEnd && bStart < endDateTimeUTC.getTime()) {
                        hasActualOverlap = true;
                    }
                });

                if (hasActualOverlap) {
                    throw new Error("OVERLAP_DETECTED");
                }

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
                return res.status(404).json({ error: 'Dottore o postazione non trovata.' });
            }
            throw error;
        }

        // Reputazione numero di telefono
        if (payload.customerPhone) {
            try {
                const phoneDocRef = db.collection(NUMBER_REPUTATION_COLLECTION).doc(payload.customerPhone);
                const phoneDoc = await phoneDocRef.get();

                const reputationData = {
                    phone_number: payload.customerPhone,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    customerEmail: payload.customerEmail || null,
                };

                let dobPartToSave = null;
                if (payload.customerDobPart && payload.customerDobPart !== '00') {
                    dobPartToSave = payload.customerDobPart;
                }

                if (phoneDoc.exists) {
                    const currentReputationData = phoneDoc.data();
                    if (payload.customerName && (!currentReputationData.customerName || payload.isDataRecovery)) {
                         reputationData.customerName = payload.customerName.split(' ')[0];
                         reputationData.customerSurname = payload.customerName.split(' ').slice(1).join(' ') || null;
                    }
                    if (dobPartToSave && (payload.updateDobPart || currentReputationData.dobPart === '00')) {
                        reputationData.dobPart = dobPartToSave;
                    }
                    if (!payload.isGuestBooking) {
                        reputationData.isNewGuest = false;
                        reputationData.is_blocked = currentReputationData.is_blocked || false;
                        reputationData.no_show_count = currentReputationData.no_show_count || 0;
                    }
                    await phoneDocRef.update(reputationData);
                } else {
                    reputationData.no_show_count = 0;
                    reputationData.is_blocked = false;
                    reputationData.first_booking_at = admin.firestore.FieldValue.serverTimestamp();
                    reputationData.isNewGuest = false;
                    reputationData.customerName = payload.customerName ? payload.customerName.split(' ')[0] : null;
                    reputationData.customerSurname = payload.customerName ? payload.customerName.split(' ').slice(1).join(' ') : null;
                    reputationData.dobPart = dobPartToSave || '00';
                    await phoneDocRef.set(reputationData);
                }
            } catch(error) {
                console.error("[Reputation Vet] Errore aggiornamento reputazione:", error);
            }
        }

        // Notifica Email
        if (bookingData.source === 'website' || (bookingData.appointmentCode && bookingData.appointmentCode.startsWith('WEB_'))) {
            try {
                const vendorDoc = await db.collection('vendors').doc(vendorId).get();
                const merchantEmail = vendorDoc.exists ? vendorDoc.data().email : null;
                const vendorName = vendorDoc.exists ? vendorDoc.data().store_name : 'Clinica / Toelettatura';
                const vendorAddress = vendorDoc.exists ? (vendorDoc.data().address || '') : '';

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
                            cancellationToken: cancellationToken,
                            eventLocation: vendorAddress,
                            petName: bookingData.petName || '',
                            petType: bookingData.petType || ''
                        },
                        recipients: {
                            customer: bookingData.customerEmail,
                            merchant: merchantEmail
                        }
                    };

                    await safeFetch(ORDER_EMAIL_NOTIFICATION_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(emailPayload),
                    }, 3500);
                }
            } catch (emailError) {
                console.error(`[Booking Vet] Errore invio notifica email:`, emailError);
            }
        }

        // Notifica PUSH FCM
        try {
            const vendorDocForPush = await db.collection('vendors').doc(payload.vendorId).get();
            const vendorDataForPush = vendorDocForPush.exists ? vendorDocForPush.data() : null;

            if (vendorDataForPush && vendorDataForPush.fcmToken && vendorDataForPush.notificationsEnabled !== false) {
                const petLabel = payload.petName ? ` (${payload.petName})` : '';
                const pushMessage = {
                    token: vendorDataForPush.fcmToken,
                    notification: {
                        title: '🐾 Nuovo Appuntamento Pet!',
                        body: `${payload.customerName}${petLabel} ha prenotato: ${payload.bookedServiceName}`
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
                            channelId: 'civora_pet_bookings_channel',
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
            console.error('[Push Vet] Errore invio notifica push:', pushError);
        }

        // SMS MacroDroid su misura per animali
        if (payload.customerPhone) {
            try {
                let numeroPulito = payload.customerPhone.replace(/\s+/g, '');
                if (!numeroPulito.startsWith('+')) numeroPulito = '+39' + numeroPulito;

                const dataApp = new Date(payload.startDateTime);
                const dataFormattata = dataApp.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
                const oraFormattata = dataApp.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });

                const vendorDocSms = await db.collection('vendors').doc(payload.vendorId).get();
                const nomeNegozioSms = vendorDocSms.exists ? (vendorDocSms.data().store_name || 'La clinica') : 'La clinica';
                const indirizzoSms = vendorDocSms.exists ? (vendorDocSms.data().address || '') : '';
                const nomeBreve = payload.customerName.split(' ')[0];

                let testoMessaggio = '';
                if (payload.petName) {
                    testoMessaggio = `Ciao ${nomeBreve}, l'app.to per il tuo ${payload.petType || 'cucciolo'} ${payload.petName} da ${nomeNegozioSms} per "${payload.bookedServiceName}" e' confermato per il ${dataFormattata} alle ore ${oraFormattata} in ${indirizzoSms}. A presto!`;
                } else {
                    testoMessaggio = `Ciao ${nomeBreve}, l'appuntamento da ${nomeNegozioSms} per "${payload.bookedServiceName}" e' confermato per il ${dataFormattata} alle ore ${oraFormattata} in ${indirizzoSms}. A presto!`;
                }

                if (testoMessaggio.length > 155) {
                    testoMessaggio = `Conf. App.to ${nomeNegozioSms}: ${dataFormattata} ore ${oraFormattata} in ${indirizzoSms.substring(0, 30)}... Servizio: ${payload.bookedServiceName.substring(0, 15)}...`;
                }

                const macrodroidUrl = `https://trigger.macrodroid.com/51db87e2-5593-48a5-9df5-a59f5dc9cf07/bazar_sms?phone=${encodeURIComponent(numeroPulito)}&message=${encodeURIComponent(testoMessaggio)}`;
                await safeFetch(macrodroidUrl, {}, 2500);

            } catch (smsError) {
                console.error('[SMS Vet] Errore invio SMS:', smsError);
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Prenotazione registrata con successo.',
            bookingId: createdBookingId
        });
    }

    // ============================================================
    // 2. RECUPERO SLOT DISPONIBILI SINGOLO GIORNO
    // ============================================================
    else if (action === 'getAvailableSlots') {
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
            db.collection('vendors').doc(vendorId).get()
        ]);

        if (!serviceDoc.exists) return res.status(404).json({ error: 'Prestazione non trovata.' });
        if (!vendorDoc.exists) return res.status(200).json({ slots: [], message: 'Dati attività non trovati.' });

        const serviceData = serviceDoc.data();
        const vendorData = vendorDoc.data();
        const vendorTimezone = vendorData.timezone || 'Europe/Rome';

        let totalOccupiedTimeMinutes = durationFromFrontend || serviceData.totalOccupiedTimeMinutes || serviceData.serviceDuration;
        if (!totalOccupiedTimeMinutes || totalOccupiedTimeMinutes <= 0) {
            return res.status(400).json({ error: 'Durata totale della prestazione non valida.' });
        }

        const absentIds = await getAbsentResourceIds(vendorId, date);
        if (absentIds.has('all')) {
            return res.status(200).json({ slots: [], message: 'Attività chiusa per ferie o chiusura programmata.' });
        }

        let potentialResources = [];
        const ownerOffersService = !vendorData.servicesOffered || !Array.isArray(vendorData.servicesOffered) || vendorData.servicesOffered.length === 0 || vendorData.servicesOffered.includes(serviceId);

        if (!absentIds.has(vendorId) && ownerOffersService) {
            potentialResources.push({
                id: vendorId,
                isOwner: true,
                name: vendorData.store_name || 'Dottore Principale',
                role: 'owner',
                servicesOffered: vendorData.servicesOffered || null
            });
        }

        if (isAutoAssignRequest) {
            const collaboratorsSnapshot = await db.collection('vendors').doc(vendorId).collection('collaborators')
                .where('isActive', '==', true)
                .get();
            collaboratorsSnapshot.docs.forEach(collabDoc => {
                const collabData = collabDoc.data();
                if (!absentIds.has(collabDoc.id) && collabData.servicesOffered && Array.isArray(collabData.servicesOffered) && collabData.servicesOffered.includes(serviceId)) {
                    potentialResources.push({
                        id: collabDoc.id,
                        isOwner: collabData.role === 'owner',
                        name: collabData.name,
                        role: collabData.role || 'collaborator',
                        servicesOffered: collabData.servicesOffered
                    });
                }
            });
        } else {
            if (requestedBookedForResourceId === vendorId) {
                if (absentIds.has(vendorId) || !ownerOffersService) {
                    return res.status(200).json({ slots: [], message: 'Il dottore principale non è disponibile.' });
                }
                potentialResources = [{ id: vendorId, isOwner: true, name: vendorData.store_name || 'Dottore Principale', servicesOffered: vendorData.servicesOffered || null }];
            } else {
                if (absentIds.has(requestedBookedForResourceId)) {
                    return res.status(200).json({ slots: [], message: 'Questa risorsa è assente.' });
                }
                const collaboratorDoc = await db.collection('vendors').doc(vendorId).collection('collaborators').doc(requestedBookedForResourceId).get();
                if (!collaboratorDoc.exists || !collaboratorDoc.data().servicesOffered || !collaboratorDoc.data().servicesOffered.includes(serviceId)) {
                    return res.status(200).json({ slots: [], message: 'Questa risorsa non offre la prestazione selezionata.' });
                }
                potentialResources = [{ id: requestedBookedForResourceId, isOwner: collaboratorDoc.data().role === 'owner', name: collaboratorDoc.data().name, servicesOffered: collaboratorDoc.data().servicesOffered }];
            }
        }

        const year = parseInt(date.substring(0,4));
        const month = parseInt(date.substring(5,7)) - 1;
        const day = parseInt(date.substring(8,10));
        const startOfTargetDayUTC = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
        const vendorTimezoneOffsetMinutes = getDynamicOffsetMinutes(startOfTargetDayUTC, vendorTimezone);

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
            const bData = doc.data();
            if (allExistingBookingsForResources[bData.bookedForResourceId]) {
                allExistingBookingsForResources[bData.bookedForResourceId].push({
                    id: doc.id,
                    start: bData.startDateTime.toDate(),
                    end: bData.endDateTime.toDate()
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
                adjustedNowUTC.setUTCSeconds(0, 0);
                adjustedNowUTC.setUTCMilliseconds(0);
                currentSlotTimeUTC = new Date(Math.max(currentSlotTimeUTC.getTime(), adjustedNowUTC.getTime()));
            }

            if (currentSlotTimeUTC.getTime() >= currentWorkSlotEndUTC.getTime()) continue;

            while (currentSlotTimeUTC.getTime() < currentWorkSlotEndUTC.getTime()) {
                const potentialEndTimeUTC = new Date(currentSlotTimeUTC.getTime() + totalOccupiedTimeMinutes * 60000);
                if (potentialEndTimeUTC.getTime() > currentWorkSlotEndUTC.getTime()) break;

                if (serviceData.hasCustomBookingHours && serviceData.customBookingHours && serviceData.customBookingHours.from && serviceData.customBookingHours.to) {
                    const displaySlotTime = new Date(currentSlotTimeUTC.getTime() - vendorTimezoneOffsetMinutes * 60 * 1000);
                    const slotStartHM = String(displaySlotTime.getHours()).padStart(2, '0') + ':' + String(displaySlotTime.getMinutes()).padStart(2, '0');
                    const displayEndTime = new Date(potentialEndTimeUTC.getTime() - vendorTimezoneOffsetMinutes * 60 * 1000);
                    const slotEndHM = String(displayEndTime.getHours()).padStart(2, '0') + ':' + String(displayEndTime.getMinutes()).padStart(2, '0');

                    if (slotStartHM < serviceData.customBookingHours.from || slotEndHM > serviceData.customBookingHours.to) {
                        currentSlotTimeUTC.setUTCMinutes(currentSlotTimeUTC.getUTCMinutes() + slotIncrement);
                        continue;
                    }
                }

                let isSlotAvailableForThisTime = false;

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
                    }
                }

                if (isSlotAvailableForThisTime) {
                    const displaySlotTime = new Date(currentSlotTimeUTC.getTime() - vendorTimezoneOffsetMinutes * 60 * 1000);
                    const hours = String(displaySlotTime.getHours()).padStart(2, '0');
                    const minutes = String(displaySlotTime.getMinutes()).padStart(2, '0');
                    availableSlots.push(`${hours}:${minutes}`);
                }

                currentSlotTimeUTC.setUTCMinutes(currentSlotTimeUTC.getUTCMinutes() + slotIncrement);
            }
        }

        return res.status(200).json({ slots: availableSlots });
    }

    // ============================================================
    // 3. RIEPILOGO DISPONIBILITÀ MENSILE
    // ============================================================
    else if (action === 'getMonthlyAvailabilitySummary') {
        const { serviceId, year, month, bookedForResourceId: requestedBookedForResourceId } = req.body;

        const requiredFields = ['vendorId', 'serviceId', 'year', 'month'];
        for (const field of requiredFields) {
            if (req.body[field] === undefined || req.body[field] === null) {
                return res.status(400).json({ error: `Dati mancanti. Campo mancante: ${field}.` });
            }
        }

        const isAutoAssignRequest = !requestedBookedForResourceId;

        const [serviceDoc, vendorDoc] = await Promise.all([
            db.collection('artisan_services').doc(serviceId).get(),
            db.collection('vendors').doc(vendorId).get()
        ]);

        if (!serviceDoc.exists) return res.status(404).json({ error: 'Prestazione non trovata.' });
        if (!vendorDoc.exists) return res.status(404).json({ summary: {}, message: 'Dati attività non trovati.' });

        const serviceData = serviceDoc.data();
        const vendorData = vendorDoc.data();
        const vendorTimezone = vendorData.timezone || 'Europe/Rome';

        let totalOccupiedTimeMinutes = serviceData.totalOccupiedTimeMinutes || serviceData.serviceDuration;
        if (!totalOccupiedTimeMinutes || totalOccupiedTimeMinutes <= 0) {
            return res.status(400).json({ error: 'Durata della prestazione non valida.' });
        }

        let potentialResources = [];
        const ownerOffersService = !vendorData.servicesOffered || !Array.isArray(vendorData.servicesOffered) || vendorData.servicesOffered.length === 0 || vendorData.servicesOffered.includes(serviceId);

        if (ownerOffersService) {
            potentialResources.push({
                id: vendorId,
                isOwner: true,
                name: vendorData.store_name || 'Dottore Principale',
                role: 'owner',
                servicesOffered: vendorData.servicesOffered || null
            });
        }

        if (isAutoAssignRequest) {
            const collaboratorsSnapshot = await db.collection('vendors').doc(vendorId).collection('collaborators')
                .where('isActive', '==', true)
                .get();
            collaboratorsSnapshot.docs.forEach(collabDoc => {
                const collabData = collabDoc.data();
                if (collabData.servicesOffered && Array.isArray(collabData.servicesOffered) && collabData.servicesOffered.includes(serviceId)) {
                    potentialResources.push({
                        id: collabDoc.id,
                        isOwner: collabData.role === 'owner',
                        name: collabData.name,
                        role: collabData.role || 'collaborator',
                        servicesOffered: collabData.servicesOffered
                    });
                }
            });
        } else {
            if (requestedBookedForResourceId === vendorId) {
                if (!ownerOffersService) {
                    const monthlySummary = {};
                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                    for (let d = 1; d <= daysInMonth; d++) {
                        const curDate = new Date(year, month, d).toISOString().split('T')[0];
                        monthlySummary[curDate] = false;
                    }
                    return res.status(200).json({ summary: monthlySummary, message: 'Non offre questo servizio.' });
                }
                potentialResources = [{ id: vendorId, isOwner: true, name: vendorData.store_name || 'Dottore Principale', servicesOffered: vendorData.servicesOffered || null }];
            } else {
                const collaboratorDoc = await db.collection('vendors').doc(vendorId).collection('collaborators').doc(requestedBookedForResourceId).get();
                if (!collaboratorDoc.exists || !collaboratorDoc.data().servicesOffered || !collaboratorDoc.data().servicesOffered.includes(serviceId)) {
                    const monthlySummary = {};
                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                    for (let d = 1; d <= daysInMonth; d++) {
                        const curDate = new Date(year, month, d).toISOString().split('T')[0];
                        monthlySummary[curDate] = false;
                    }
                    return res.status(200).json({ summary: monthlySummary, message: 'Risorsa non abilitata.' });
                }
                potentialResources = [{ id: requestedBookedForResourceId, isOwner: collaboratorDoc.data().role === 'owner', name: collaboratorDoc.data().name, servicesOffered: collaboratorDoc.data().servicesOffered }];
            }
        }

        const nowUTC = new Date();
        const firstDayOfMonthLocalBase = new Date(year, month, 1);
        const firstDayOfMonthUTC = new Date(firstDayOfMonthLocalBase.getTime() + getDynamicOffsetMinutes(firstDayOfMonthLocalBase, vendorTimezone) * 60 * 1000);
        const lastDayOfMonthLocalBase = new Date(year, month + 1, 0, 23, 59, 59, 999);
        const lastDayOfMonthUTC = new Date(lastDayOfMonthLocalBase.getTime() + getDynamicOffsetMinutes(lastDayOfMonthLocalBase, vendorTimezone) * 60 * 1000);

        const queryStartRangeUTC = new Date(firstDayOfMonthUTC.getTime() - (24 * 60 * 60 * 1000));
        const queryEndRangeUTC = new Date(lastDayOfMonthUTC.getTime() + (24 * 60 * 60 * 1000));

        const startMonthStr = firstDayOfMonthUTC.toISOString().split('T')[0];
        const endMonthStr = lastDayOfMonthUTC.toISOString().split('T')[0];
        const monthlyAbsencesList = await getAbsencesForRange(vendorId, startMonthStr, endMonthStr);

        let bookingsQuery = db.collection('bookings')
            .where('vendorId', '==', vendorId)
            .where('bookedForResourceId', 'in', potentialResources.map(r => r.id))
            .where('status', 'in', ['confirmed', 'paid', 'pending', 'rescheduled', 'pending-cash'])
            .where('startDateTime', '>=', admin.firestore.Timestamp.fromDate(queryStartRangeUTC))
            .where('startDateTime', '<=', admin.firestore.Timestamp.fromDate(queryEndRangeUTC));

        const bookingsSnapshot = await bookingsQuery.get();
        const allExistingBookingsForResources = {};
        potentialResources.forEach(res => allExistingBookingsForResources[res.id] = []);
        bookingsSnapshot.docs.forEach(doc => {
            const bData = doc.data();
            if (allExistingBookingsForResources[bData.bookedForResourceId]) {
                allExistingBookingsForResources[bData.bookedForResourceId].push({
                    id: doc.id,
                    start: bData.startDateTime.toDate(),
                    end: bData.endDateTime.toDate(),
                });
            }
        });

        const monthlySummary = {};
        const slotIncrement = 5;
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let day = 1; day <= daysInMonth; day++) {
            const currentVendorLocalDayDate = new Date(year, month, day);
            const formattedDate = currentVendorLocalDayDate.toISOString().split('T')[0];
            const startOfTargetDayUTC = new Date(Date.UTC(currentVendorLocalDayDate.getFullYear(), currentVendorLocalDayDate.getMonth(), currentVendorLocalDayDate.getDate(), 0, 0, 0, 0));
            const vendorTimezoneOffsetMinutes = getDynamicOffsetMinutes(startOfTargetDayUTC, vendorTimezone);

            const selectedDayStartUTC = new Date(startOfTargetDayUTC.getTime() + vendorTimezoneOffsetMinutes * 60 * 1000);
            const selectedDayEndUTC = new Date(selectedDayStartUTC.getTime() + (24 * 60 * 60 * 1000) - 1);

            const nowVendorLocalFormattedDate = new Date(nowUTC.getTime() - vendorTimezoneOffsetMinutes * 60 * 1000).toISOString().split('T')[0];
            const isTodayForVendor = (formattedDate === nowVendorLocalFormattedDate);
            const nowAdjustedForSlotCheck = new Date(nowUTC);
            const currentMins = nowAdjustedForSlotCheck.getUTCMinutes();
            const remainder = currentMins % slotIncrement;
            if (remainder !== 0) {
                nowAdjustedForSlotCheck.setUTCMinutes(currentMins + (slotIncrement - remainder));
            }
            nowAdjustedForSlotCheck.setUTCSeconds(0,0);
            nowAdjustedForSlotCheck.setUTCMilliseconds(0);

            const openingHoursResult = getOpeningHoursForDate(selectedDayStartUTC, vendorData, vendorTimezoneOffsetMinutes);
            if (!openingHoursResult.isOpen) {
                monthlySummary[formattedDate] = false;
                continue;
            }

            const activeAbsencesForDay = monthlyAbsencesList.filter(abs => abs.startDate <= formattedDate && abs.endDate >= formattedDate);
            const absentIdsForDay = new Set(activeAbsencesForDay.map(abs => abs.resourceId));

            if (absentIdsForDay.has('all')) {
                monthlySummary[formattedDate] = false;
                continue;
            }

            const filteredResourcesForDay = potentialResources.filter(res => !absentIdsForDay.has(res.id));
            if (filteredResourcesForDay.length === 0) {
                monthlySummary[formattedDate] = false;
                continue;
            }

            const todayHoursSlots = openingHoursResult.slots;
            let hasAvailableSlotForDay = false;

            for (const slot of todayHoursSlots) {
                if (!slot.from || !slot.to) continue;

                const [startHour, startMinute] = slot.from.split(':').map(Number);
                const [endHour, endMinute] = slot.to.split(':').map(Number);

                let currentWorkSlotStartUTC = new Date(selectedDayStartUTC.getTime() + (startHour * 60 + startMinute) * 60 * 1000);
                let currentWorkSlotEndUTC = new Date(selectedDayStartUTC.getTime() + (endHour * 60 + endMinute) * 60 * 1000);

                if (currentWorkSlotEndUTC.getTime() <= currentWorkSlotStartUTC.getTime()) {
                    currentWorkSlotEndUTC.setUTCDate(currentWorkSlotEndUTC.getUTCDate() + 1);
                }

                let searchStartTimeUTC = new Date(currentWorkSlotStartUTC);
                if (isTodayForVendor) {
                    searchStartTimeUTC = new Date(Math.max(searchStartTimeUTC.getTime(), nowAdjustedForSlotCheck.getTime()));
                }

                if (searchStartTimeUTC.getTime() >= currentWorkSlotEndUTC.getTime()) continue;

                let currentSlotTimeUTC = new Date(searchStartTimeUTC);

                while (currentSlotTimeUTC.getTime() < currentWorkSlotEndUTC.getTime()) {
                    const potentialEndTimeUTC = new Date(currentSlotTimeUTC.getTime() + totalOccupiedTimeMinutes * 60000);
                    if (potentialEndTimeUTC.getTime() > currentWorkSlotEndUTC.getTime()) break;

                    if (serviceData.hasCustomBookingHours && serviceData.customBookingHours && serviceData.customBookingHours.from && serviceData.customBookingHours.to) {
                        const displaySlotTime = new Date(currentSlotTimeUTC.getTime() - vendorTimezoneOffsetMinutes * 60 * 1000);
                        const slotStartHM = String(displaySlotTime.getHours()).padStart(2, '0') + ':' + String(displaySlotTime.getMinutes()).padStart(2, '0');
                        const displayEndTime = new Date(potentialEndTimeUTC.getTime() - vendorTimezoneOffsetMinutes * 60 * 1000);
                        const slotEndHM = String(displayEndTime.getHours()).padStart(2, '0') + ':' + String(displayEndTime.getMinutes()).padStart(2, '0');

                        if (slotStartHM < serviceData.customBookingHours.from || slotEndHM > serviceData.customBookingHours.to) {
                            currentSlotTimeUTC.setUTCMinutes(currentSlotTimeUTC.getUTCMinutes() + slotIncrement);
                            continue;
                        }
                    }

                    let isSlotAvailableForThisTime = false;
                    let maxBlockingEndTimeAcrossAllResources = new Date(currentSlotTimeUTC.getTime() + slotIncrement * 60000);

                    for (const resource of filteredResourcesForDay) {
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
                        hasAvailableSlotForDay = true;
                        break;
                    } else {
                        currentSlotTimeUTC = maxBlockingEndTimeAcrossAllResources;
                    }
                }
                if (hasAvailableSlotForDay) break;
            }
            monthlySummary[formattedDate] = hasAvailableSlotForDay;
        }

        return res.status(200).json({ summary: monthlySummary, message: 'Riepilogo disponibilità mensile generato.' });
    }

    // ============================================================
    // 4. RECUPERO SLOT PER RANGE (UTILISSIMO PER TOTEM & RANGE)
    // ============================================================
    else if (action === 'getAvailableSlotsRange') {
        const { serviceIds, start_date, end_date, bookedForResourceId: requestedBookedForResourceId } = req.body;

        const requiredFields = ['vendorId', 'serviceIds', 'start_date', 'end_date'];
        for (const field of requiredFields) {
            if (req.body[field] === undefined || req.body[field] === null) {
                return res.status(400).json({ error: `Dati mancanti. Campo mancante: ${field}.` });
            }
        }

        const isAutoAssignRequest = !requestedBookedForResourceId;

        const [servicesSnapshot, vendorDoc] = await Promise.all([
            db.collection('artisan_services').where(admin.firestore.FieldPath.documentId(), 'in', serviceIds).get(),
            db.collection('vendors').doc(vendorId).get()
        ]);

        const servicesData = new Map();
        servicesSnapshot.docs.forEach(doc => {
            servicesData.set(doc.id, doc.data());
        });

        if (!vendorDoc.exists) return res.status(404).json({ availableSlots: {}, message: 'Attività non trovata.' });

        const vendorData = vendorDoc.data();
        const vendorTimezone = vendorData.timezone || 'Europe/Rome';

        let potentialResources = [];
        potentialResources.push({ id: vendorId, isOwner: true, name: vendorData.store_name || 'Dottore Principale' });

        if (isAutoAssignRequest) {
            const collaboratorsSnapshot = await db.collection('vendors').doc(vendorId).collection('collaborators')
                .where('isActive', '==', true)
                .get();
            collaboratorsSnapshot.docs.forEach(collabDoc => {
                const collabData = collabDoc.data();
                const hasAnyMatchingService = serviceIds.some(sId => collabData.servicesOffered && collabData.servicesOffered.includes(sId));
                if (hasAnyMatchingService) {
                    potentialResources.push({ id: collabDoc.id, isOwner: false, name: collabData.name, servicesOffered: collabData.servicesOffered });
                }
            });
        } else {
            if (requestedBookedForResourceId !== vendorId) {
                const collaboratorDoc = await db.collection('vendors').doc(vendorId).collection('collaborators').doc(requestedBookedForResourceId).get();
                if (!collaboratorDoc.exists || !(collaboratorDoc.data().servicesOffered && serviceIds.every(sId => collaboratorDoc.data().servicesOffered.includes(sId)))) {
                    return res.status(200).json({ availableSlots: {}, message: 'Risorsa non abilitata.' });
                }
                potentialResources = [{ id: requestedBookedForResourceId, isOwner: false, name: collaboratorDoc.data().name, servicesOffered: collaboratorDoc.data().servicesOffered }];
            }
        }

        const nowUTC = new Date();
        const startLocalBase = new Date(start_date + 'T00:00:00');
        const endLocalBase = new Date(end_date + 'T23:59:59.999');

        const rangeStartUTC = new Date(startLocalBase.getTime() + getDynamicOffsetMinutes(startLocalBase, vendorTimezone) * 60 * 1000);
        const rangeEndUTC = new Date(endLocalBase.getTime() + getDynamicOffsetMinutes(endLocalBase, vendorTimezone) * 60 * 1000);

        const queryStartRangeUTC = new Date(rangeStartUTC.getTime() - (24 * 60 * 60 * 1000));
        const queryEndRangeUTC = new Date(rangeEndUTC.getTime() + (24 * 60 * 60 * 1000));

        const rangeAbsencesList = await getAbsencesForRange(vendorId, start_date, end_date);

        let bookingsQuery = db.collection('bookings')
            .where('vendorId', '==', vendorId)
            .where('bookedForResourceId', 'in', potentialResources.map(r => r.id))
            .where('status', 'in', ['confirmed', 'paid', 'pending', 'rescheduled', 'pending-cash'])
            .where('startDateTime', '>=', admin.firestore.Timestamp.fromDate(queryStartRangeUTC))
            .where('startDateTime', '<=', admin.firestore.Timestamp.fromDate(queryEndRangeUTC));

        const bookingsSnapshot = await bookingsQuery.get();
        const allExistingBookingsForResources = {};
        potentialResources.forEach(res => allExistingBookingsForResources[res.id] = []);
        bookingsSnapshot.docs.forEach(doc => {
            const bData = doc.data();
            if (allExistingBookingsForResources[bData.bookedForResourceId]) {
                allExistingBookingsForResources[bData.bookedForResourceId].push({
                    id: doc.id,
                    start: bData.startDateTime.toDate(),
                    end: bData.endDateTime.toDate(),
                });
            }
        });

        const availableSlotsPerService = {};
        const slotIncrement = 5;

        let currentDateIterator = new Date(start_date);
        while (currentDateIterator.toISOString().split('T')[0] <= end_date) {
            const currentVendorLocalDayDate = new Date(currentDateIterator);
            const formattedDate = currentVendorLocalDayDate.toISOString().split('T')[0];
            const startOfTargetDayUTC = new Date(Date.UTC(currentVendorLocalDayDate.getFullYear(), currentVendorLocalDayDate.getMonth(), currentVendorLocalDayDate.getDate(), 0, 0, 0, 0));
            const vendorTimezoneOffsetMinutes = getDynamicOffsetMinutes(startOfTargetDayUTC, vendorTimezone);

            const selectedDayStartUTC = new Date(startOfTargetDayUTC.getTime() + vendorTimezoneOffsetMinutes * 60 * 1000);
            const selectedDayEndUTC = new Date(selectedDayStartUTC.getTime() + (24 * 60 * 60 * 1000) - 1);

            const openingHoursResult = getOpeningHoursForDate(selectedDayStartUTC, vendorData, vendorTimezoneOffsetMinutes);
            if (!openingHoursResult.isOpen) {
                currentDateIterator.setDate(currentDateIterator.getDate() + 1);
                continue;
            }

            const activeAbsencesForDay = rangeAbsencesList.filter(abs => abs.startDate <= formattedDate && abs.endDate >= formattedDate);
            const absentIdsForDay = new Set(activeAbsencesForDay.map(abs => abs.resourceId));

            if (absentIdsForDay.has('all')) {
                currentDateIterator.setDate(currentDateIterator.getDate() + 1);
                continue;
            }

            const filteredResourcesForDay = potentialResources.filter(res => !absentIdsForDay.has(res.id));
            if (filteredResourcesForDay.length === 0) {
                currentDateIterator.setDate(currentDateIterator.getDate() + 1);
                continue;
            }

            const todayHoursSlots = openingHoursResult.slots;
            const nowVendorLocalFormattedDate = new Date(nowUTC.getTime() - vendorTimezoneOffsetMinutes * 60 * 1000).toISOString().split('T')[0];
            const isTodayForVendor = (formattedDate === nowVendorLocalFormattedDate);
            const nowAdjustedForSlotCheck = new Date(nowUTC);
            const currentMins = nowAdjustedForSlotCheck.getUTCMinutes();
            const remainder = currentMins % slotIncrement;
            if (remainder !== 0) {
                nowAdjustedForSlotCheck.setUTCMinutes(currentMins + (slotIncrement - remainder));
            }
            nowAdjustedForSlotCheck.setUTCSeconds(0,0);
            nowAdjustedForSlotCheck.setUTCMilliseconds(0);

            for (const serviceId of serviceIds) {
                const service = servicesData.get(serviceId);
                if (!service) continue;

                const totalOccupiedTimeMinutes = service.totalOccupiedTimeMinutes || service.serviceDuration;
                if (!totalOccupiedTimeMinutes || totalOccupiedTimeMinutes <= 0) continue;

                if (!availableSlotsPerService[serviceId]) {
                    availableSlotsPerService[serviceId] = [];
                }

                for (const slot of todayHoursSlots) {
                    if (!slot.from || !slot.to) continue;

                    const [startHour, startMinute] = slot.from.split(':').map(Number);
                    const [endHour, endMinute] = slot.to.split(':').map(Number);

                    let currentWorkSlotStartUTC = new Date(selectedDayStartUTC.getTime() + (startHour * 60 + startMinute) * 60 * 1000);
                    let currentWorkSlotEndUTC = new Date(selectedDayStartUTC.getTime() + (endHour * 60 + endMinute) * 60 * 1000);

                    if (currentWorkSlotEndUTC.getTime() <= currentWorkSlotStartUTC.getTime()) {
                        currentWorkSlotEndUTC.setUTCDate(currentWorkSlotEndUTC.getUTCDate() + 1);
                    }

                    let searchStartTimeUTC = new Date(currentWorkSlotStartUTC);
                    if (isTodayForVendor) {
                        searchStartTimeUTC = new Date(Math.max(searchStartTimeUTC.getTime(), nowAdjustedForSlotCheck.getTime()));
                    }

                    if (searchStartTimeUTC.getTime() >= currentWorkSlotEndUTC.getTime()) continue;

                    let currentSlotTimeUTC = new Date(searchStartTimeUTC);

                    while (currentSlotTimeUTC.getTime() < currentWorkSlotEndUTC.getTime()) {
                        const potentialEndTimeUTC = new Date(currentSlotTimeUTC.getTime() + totalOccupiedTimeMinutes * 60000);
                        if (potentialEndTimeUTC.getTime() > currentWorkSlotEndUTC.getTime()) break;

                        if (service.hasCustomBookingHours && service.customBookingHours && service.customBookingHours.from && service.customBookingHours.to) {
                            const displaySlotTime = new Date(currentSlotTimeUTC.getTime() - vendorTimezoneOffsetMinutes * 60 * 1000);
                            const slotStartHM = String(displaySlotTime.getHours()).padStart(2, '0') + ':' + String(displaySlotTime.getMinutes()).padStart(2, '0');
                            const displayEndTime = new Date(potentialEndTimeUTC.getTime() - vendorTimezoneOffsetMinutes * 60 * 1000);
                            const slotEndHM = String(displayEndTime.getHours()).padStart(2, '0') + ':' + String(displayEndTime.getMinutes()).padStart(2, '0');

                            if (slotStartHM < service.customBookingHours.from || slotEndHM > service.customBookingHours.to) {
                                currentSlotTimeUTC.setUTCMinutes(currentSlotTimeUTC.getUTCMinutes() + slotIncrement);
                                continue;
                            }
                        }

                        let assignedResourceId = null;
                        let assignedCollaboratorName = null;
                        let isSlotAvailableForThisTime = false;
                        let maxBlockingEndTimeAcrossAllResources = new Date(currentSlotTimeUTC.getTime() + slotIncrement * 60000);

                        for (const resource of filteredResourcesForDay) {
                            const isCurrentResourceAvailable = await isResourceAvailable(
                                vendorId, resource.id, currentSlotTimeUTC, potentialEndTimeUTC,
                                allExistingBookingsForResources[resource.id]
                            );

                            if (isCurrentResourceAvailable) {
                                isSlotAvailableForThisTime = true;
                                assignedResourceId = resource.id;
                                assignedCollaboratorName = resource.name;
                                break;
                            } else {
                                for (const booking of allExistingBookingsForResources[resource.id]) {
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
                            availableSlotsPerService[serviceId].push({
                                serviceId: serviceId,
                                time: currentSlotTimeUTC.toISOString(),
                                duration: totalOccupiedTimeMinutes,
                                bookedForResourceId: assignedResourceId,
                                collaboratorId: assignedResourceId === vendorId ? null : assignedResourceId,
                                collaboratorName: assignedResourceId === vendorId ? null : assignedCollaboratorName
                            });
                            currentSlotTimeUTC.setUTCMinutes(currentSlotTimeUTC.getUTCMinutes() + slotIncrement);
                        } else {
                            currentSlotTimeUTC = maxBlockingEndTimeAcrossAllResources;
                        }
                    }
                }
            }
            currentDateIterator.setDate(currentDateIterator.getDate() + 1);
        }

        return res.status(200).json({ availableSlots: availableSlotsPerService, message: 'Slot disponibili calcolati.' });
    }

    // ============================================================
    // 5. REGISTRAZIONE CLIENTE PREFERITO
    // ============================================================
    else if (action === 'register_preferred_client') {
        const { vendorId: registerVendorId, name, surname, phone, email, notes } = req.body;

        const requiredFields = ['vendorId', 'name', 'phone'];
        for (const field of requiredFields) {
            if (req.body[field] === undefined || req.body[field] === null) {
                return res.status(400).json({ error: `Dati cliente incompleti. Campo mancante: ${field}.` });
            }
        }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
             return res.status(400).json({ error: 'Formato email non valido.' });
        }

        const vendorRef = db.collection('vendors').doc(registerVendorId);
        const vendorDoc = await vendorRef.get();
        if (!vendorDoc.exists) {
            return res.status(404).json({ error: 'Struttura non trovata.' });
        }

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
                source: 'civora_vet_storefront_update',
            };
            await existingClientDoc.ref.update(updatedData);
            return res.status(200).json({
                success: true,
                message: 'Cliente preferito aggiornato con successo.',
                clientId: existingClientDoc.id
            });
        }

        const clientData = {
            name: name,
            surname: surname || null,
            phone: phone,
            email: email || null,
            notes: notes || null,
            registeredAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            source: 'civora_vet_storefront',
        };

        const docRef = await vendorRef.collection('clients').add(clientData);
        return res.status(200).json({
            success: true,
            message: 'Cliente preferito registrato con successo.',
            clientId: docRef.id
        });
    }

    // ============================================================
    // 6. BLOCCO / REPUTAZIONE NUMERO
    // ============================================================
    else if (action === 'update_phone_reputation_block_status') {
        const { phoneNumber, isBlocked } = req.body;
        if (!phoneNumber || typeof isBlocked !== 'boolean') {
            return res.status(400).json({ error: 'Numero di telefono o stato mancante.' });
        }

        try {
            const phoneDocRef = db.collection(NUMBER_REPUTATION_COLLECTION).doc(phoneNumber);
            await phoneDocRef.set({
                phone_number: phoneNumber,
                is_blocked: isBlocked,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            return res.status(200).json({ success: true, message: 'Stato aggiornato.' });
        } catch (error) {
            return res.status(500).json({ error: 'Errore interno aggiornamento stato.' });
        }
    }

    // ============================================================
    // 7. SEGNALAZIONE NO-SHOW
    // ============================================================
    else if (action === 'report_no_show') {
        const { bookingId, customerPhone } = req.body;
        if (!bookingId) {
            return res.status(400).json({ error: 'ID prenotazione mancante.' });
        }

        try {
            const [vendorDoc, bookingDoc] = await Promise.all([
                db.collection('vendors').doc(vendorId).get(),
                db.collection('bookings').doc(bookingId).get()
            ]);

            const storeName = vendorDoc.exists ? (vendorDoc.data().store_name || 'Clinica / Toelettatura') : 'Clinica / Toelettatura';
            const bookingData = bookingDoc.exists ? bookingDoc.data() : {};

            const bookingRef = db.collection('bookings').doc(bookingId);
            await bookingRef.update({
                status: 'no_show',
                platformFee: 0.00,
                noShowReportedByVendorId: vendorId,
                noShowReportedByStoreName: storeName,
                noShowReportedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            let newCount = 0;
            let isNowBlocked = false;

            if (customerPhone) {
                let cleanPhone = customerPhone.replace(/\s+/g, '');
                if (!cleanPhone.startsWith('+')) cleanPhone = '+39' + cleanPhone;

                const phoneDocRef = db.collection(NUMBER_REPUTATION_COLLECTION).doc(cleanPhone);
                const phoneDoc = await phoneDocRef.get();

                const reportAuditEntry = {
                    reportedByVendorId: vendorId,
                    reportedByStoreName: storeName,
                    bookingId: bookingId,
                    bookedServiceName: bookingData.bookedServiceName || 'Prestazione',
                    reportedAt: new Date().toISOString()
                };

                if (phoneDoc.exists) {
                    const currentData = phoneDoc.data();
                    newCount = (currentData.no_show_count || 0) + 1;
                    isNowBlocked = newCount >= 2;

                    const existingReports = currentData.reports_history || [];
                    existingReports.push(reportAuditEntry);

                    await phoneDocRef.update({
                        no_show_count: newCount,
                        is_blocked: isNowBlocked,
                        reports_history: existingReports,
                        lastReportedBy: storeName,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                } else {
                    newCount = 1;
                    isNowBlocked = false;
                    await phoneDocRef.set({
                        phone_number: cleanPhone,
                        no_show_count: 1,
                        is_blocked: false,
                        first_booking_at: admin.firestore.FieldValue.serverTimestamp(),
                        reports_history: [reportAuditEntry],
                        lastReportedBy: storeName,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
            }

            return res.status(200).json({
                success: true,
                newNoShowCount: newCount,
                isBlocked: isNowBlocked,
                reportedBy: storeName,
                message: 'No-Show registrato correttamente.'
            });

        } catch (error) {
            return res.status(500).json({ error: 'Errore registrazione No-Show: ' + error.message });
        }
    }

    // ============================================================
    // 8. CONTROLLO SOVRAPPOSIZIONE IMMEDIATO
    // ============================================================
    else if (action === 'check_overlap_only') {
        const { vendorId, startDateTime, endDateTime, bookedForResourceId, bookingId } = req.body;
        const startUTC = new Date(startDateTime);
        const endUTC = new Date(endDateTime);

        const txQueryStart = new Date(startUTC.getTime() - (3 * 60 * 60 * 1000));
        let bookingQuery = db.collection('bookings')
            .where('vendorId', '==', vendorId)
            .where('bookedForResourceId', '==', bookedForResourceId)
            .where('status', 'in', ['confirmed', 'paid', 'pending', 'rescheduled', 'pending-cash'])
            .where('startDateTime', '>=', admin.firestore.Timestamp.fromDate(txQueryStart))
            .where('startDateTime', '<=', admin.firestore.Timestamp.fromDate(endUTC));

        if (bookingId) {
            bookingQuery = bookingQuery.where(admin.firestore.FieldPath.documentId(), '!=', bookingId);
        }

        const possibleOverlaps = await bookingQuery.get();
        let hasActualOverlap = false;

        possibleOverlaps.docs.forEach(doc => {
            const b = doc.data();
            const bStart = b.startDateTime.toDate().getTime();
            const bEnd = b.endDateTime.toDate().getTime();
            if (startUTC.getTime() < bEnd && bStart < endUTC.getTime()) {
                hasActualOverlap = true;
            }
        });

        if (hasActualOverlap) {
            return res.status(409).json({ error: 'Sovrapposizione rilevata.' });
        } else {
            return res.status(200).json({ success: true, message: 'Slot libero!' });
        }
    }

    // ============================================================
    // 9. PROMEMORIA AUTOMATICI MACRODROID
    // ============================================================
    else if (action === 'invia_promemoria_automatici') {
        const now = new Date();
        const nowRomeHour = parseInt(new Date().toLocaleTimeString('it-IT', { hour: '2-digit', hour12: false, timeZone: 'Europe/Rome' }), 10);
        if (nowRomeHour >= 22 || nowRomeHour < 7) {
            return res.status(200).json({ message: "Orario notturno: invio SMS sospeso per rispetto del cliente." });
        }

        const snap1 = await db.collection('bookings')
            .where('reminder1_sent', '==', false)
            .limit(30)
            .get();

        const snap2 = await db.collection('bookings')
            .where('reminder2_sent', '==', false)
            .limit(30)
            .get();

        let totalSent = 0;

        for (const docSnap of snap1.docs) {
            const booking = docSnap.data();
            if (!booking.reminder1_time) continue;
            const remTime = booking.reminder1_time.toDate();
            if (remTime > now) continue;

            const validStatuses = ['confirmed', 'paid', 'rescheduled', 'pending', 'pending-cash'];
            if (!validStatuses.includes(booking.status)) continue;

            if (booking.customerPhone) {
                let numeroPulito = booking.customerPhone.replace(/\s+/g, '');
                if (!numeroPulito.startsWith('+')) numeroPulito = '+39' + numeroPulito;

                const vendorDoc = await db.collection('vendors').doc(booking.vendorId).get();
                const storeName = vendorDoc.exists ? (vendorDoc.data().store_name || 'La clinica') : 'La clinica';
                const nomeBreve = (booking.customerName || 'Cliente').split(' ')[0];

                const dataApp = booking.startDateTime.toDate();
                const oraFormattata = dataApp.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
                const dataFormattata = dataApp.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Rome' });

                const petText = booking.petName ? ` per ${booking.petName}` : '';
                const testo = `Promemoria: Ciao ${nomeBreve}, ti ricordiamo l'app.to${petText} da ${storeName} per "${booking.bookedServiceName}" del ${dataFormattata} alle ore ${oraFormattata}. A presto!`;
                const macrodroidUrl = `https://trigger.macrodroid.com/51db87e2-5593-48a5-9df5-a59f5dc9cf07/bazar_sms?phone=${encodeURIComponent(numeroPulito)}&message=${encodeURIComponent(testo)}`;

                await safeFetch(macrodroidUrl, {}, 2500);
            }

            await docSnap.ref.update({
                reminder1_sent: true,
                reminder1_sent_at: admin.firestore.FieldValue.serverTimestamp()
            });
            totalSent++;
        }

        for (const docSnap of snap2.docs) {
            const booking = docSnap.data();
            if (!booking.reminder2_time) continue;
            const remTime = booking.reminder2_time.toDate();
            if (remTime > now) continue;

            const validStatuses = ['confirmed', 'paid', 'rescheduled', 'pending', 'pending-cash'];
            if (!validStatuses.includes(booking.status)) continue;

            if (booking.customerPhone) {
                let numeroPulito = booking.customerPhone.replace(/\s+/g, '');
                if (!numeroPulito.startsWith('+')) numeroPulito = '+39' + numeroPulito;

                const vendorDoc = await db.collection('vendors').doc(booking.vendorId).get();
                const storeName = vendorDoc.exists ? (vendorDoc.data().store_name || 'La clinica') : 'La clinica';
                const nomeBreve = (booking.customerName || 'Cliente').split(' ')[0];

                const dataApp = booking.startDateTime.toDate();
                const oraFormattata = dataApp.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });

                const petText = booking.petName ? ` per ${booking.petName}` : '';
                const testo = `Promemoria finale: Ciao ${nomeBreve}, l'appuntamento${petText} da ${storeName} inizia tra poco (ore ${oraFormattata}). Vi aspettiamo!`;
                const macrodroidUrl = `https://trigger.macrodroid.com/51db87e2-5593-48a5-9df5-a59f5dc9cf07/bazar_sms?phone=${encodeURIComponent(numeroPulito)}&message=${encodeURIComponent(testo)}`;

                await safeFetch(macrodroidUrl, {}, 2500);
            }

            await docSnap.ref.update({
                reminder2_sent: true,
                reminder2_sent_at: admin.firestore.FieldValue.serverTimestamp()
            });
            totalSent++;
        }

        return res.status(200).json({ success: true, processed: totalSent });
    }

    // ============================================================
    // 10. CANCELLAZIONE SICURA VIA TOKEN
    // ============================================================
    else if (action === 'cancel_booking_by_token') {
        const { bookingId, token } = req.body;
        if (!bookingId || !token) {
            return res.status(400).json({ error: 'Dati incompleti.' });
        }

        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();
        if (!bookingDoc.exists) return res.status(404).json({ error: 'Prenotazione non trovata.' });

        const bookingData = bookingDoc.data();
        if (bookingData.cancellationToken !== token) {
            return res.status(403).json({ error: 'Token non valido.' });
        }

        if (bookingData.status === 'cancelled_by_customer' || bookingData.status === 'cancelled_by_vendor') {
            return res.status(400).json({ error: 'Appuntamento già disdetto in precedenza.' });
        }

        await bookingRef.update({
            status: 'cancelled_by_customer',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        if (bookingData.customerPhone) {
                    try {
                        let numeroPulito = bookingData.customerPhone.replace(/\s+/g, '');
                        if (!numeroPulito.startsWith('+')) numeroPulito = '+39' + numeroPulito;

                        const vendorDoc = await db.collection('vendors').doc(bookingData.vendorId).get();
                        const nomeNegozioSms = vendorDoc.exists ? (vendorDoc.data().store_name || 'La clinica') : 'La clinica';
                        const vendorPhoneNumber = vendorDoc.exists ? (vendorDoc.data().phone || '') : '';
                        const nomeBreve = bookingData.customerName.split(' ')[0];
                        const petText = bookingData.petName ? ` per ${bookingData.petName}` : '';

                        let testoMessaggio = `Ciao ${nomeBreve}, ti confermiamo che l'appuntamento${petText} per "${bookingData.bookedServiceName}" da ${nomeNegozioSms} e' stato ANNULLATO. Per info: ${vendorPhoneNumber}.`;
                        const macrodroidUrl = `https://trigger.macrodroid.com/51db87e2-5593-48a5-9df5-a59f5dc9cf07/bazar_sms?phone=${encodeURIComponent(numeroPulito)}&message=${encodeURIComponent(testoMessaggio)}`;
                        await safeFetch(macrodroidUrl, {}, 2500);
                    } catch (e) {}
                }

                if (bookingData.customerEmail && bookingData.appointmentCode && bookingData.appointmentCode.startsWith('WEB_')) {
                    try {
                        const vendorDoc = await db.collection('vendors').doc(bookingData.vendorId).get();
                        const merchantEmail = vendorDoc.exists ? vendorDoc.data().email : null;

                        await safeFetch(ORDER_EMAIL_NOTIFICATION_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                notificationType: 'appointment_booking',
                                vendorId: bookingData.vendorId,
                                bookingDetails: {
                                    ...bookingData,
                                    id: bookingId
                                },
                                recipients: {
                                    customer: bookingData.customerEmail,
                                    merchant: merchantEmail
                                }
                            })
                        }, 3500);
                    } catch (emailErr) {
                        console.error("[Vet] Errore invio email disdetta:", emailErr);
                    }
                }

                return res.status(200).json({ success: true, message: 'Prenotazione disdetta.' });
            }

    // ============================================================
    // 11. RIPROGRAMMAZIONE SICURA VIA TOKEN
    // ============================================================
    else if (action === 'reschedule_booking_by_token') {
        const { bookingId, token, newDate, newTime } = req.body;
        if (!bookingId || !token || !newDate || !newTime) {
            return res.status(400).json({ error: 'Dati incompleti per la riprogrammazione.' });
        }

        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();
        if (!bookingDoc.exists) return res.status(404).json({ error: 'Prenotazione non trovata.' });

        const bookingData = bookingDoc.data();
        if (bookingData.cancellationToken !== token) {
            return res.status(403).json({ error: 'Token non valido.' });
        }

        const vendorDoc = await db.collection('vendors').doc(bookingData.vendorId).get();
        if (!vendorDoc.exists) return res.status(404).json({ error: 'Attività non trovata.' });

        const vendorData = vendorDoc.data();
        const vendorTimezone = vendorData.timezone || 'Europe/Rome';

        const year = parseInt(newDate.substring(0,4));
        const month = parseInt(newDate.substring(5,7)) - 1;
        const day = parseInt(newDate.substring(8,10));
        const startOfTargetDayUTC = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
        const vendorTimezoneOffsetMinutes = getDynamicOffsetMinutes(startOfTargetDayUTC, vendorTimezone);
        const selectedDayStartUTC = new Date(startOfTargetDayUTC.getTime() + vendorTimezoneOffsetMinutes * 60 * 1000);

        const [hours, minutes] = newTime.split(':').map(Number);
        const newStartUTC = new Date(selectedDayStartUTC.getTime() + (hours * 60 + minutes) * 60 * 1000);
        const durationMins = bookingData.bookedTotalOccupiedTime || 30;
        const newEndUTC = new Date(newStartUTC.getTime() + durationMins * 60 * 1000);

        const bookedForResourceId = bookingData.bookedForResourceId || bookingData.vendorId;
        const txQueryStart = new Date(newStartUTC.getTime() - (180 * 60 * 1000));

        const overlaps = await db.collection('bookings')
            .where('vendorId', '==', bookingData.vendorId)
            .where('bookedForResourceId', '==', bookedForResourceId)
            .where('status', 'in', ['confirmed', 'paid', 'pending', 'rescheduled', 'pending-cash'])
            .where('startDateTime', '>=', admin.firestore.Timestamp.fromDate(txQueryStart))
            .where('startDateTime', '<=', admin.firestore.Timestamp.fromDate(newEndUTC))
            .get();

        let hasActualOverlap = false;
        overlaps.docs.forEach(doc => {
            if (doc.id !== bookingId) {
                const b = doc.data();
                const bStart = b.startDateTime.toDate().getTime();
                const bEnd = b.endDateTime.toDate().getTime();
                if (newStartUTC.getTime() < bEnd && bStart < newEndUTC.getTime()) {
                    hasActualOverlap = true;
                }
            }
        });

        if (hasActualOverlap) {
            return res.status(409).json({ error: 'Lo slot selezionato non è più disponibile.' });
        }

        await bookingRef.update({
            startDateTime: admin.firestore.Timestamp.fromDate(newStartUTC),
            endDateTime: admin.firestore.Timestamp.fromDate(newEndUTC),
            status: 'rescheduled',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        if (bookingData.customerPhone) {
                    try {
                        let numeroPulito = bookingData.customerPhone.replace(/\s+/g, '');
                        if (!numeroPulito.startsWith('+')) numeroPulito = '+39' + numeroPulito;

                        const nomeNegozioSms = vendorData.store_name || 'La clinica';
                        const nomeBreve = bookingData.customerName.split(' ')[0];
                        const dataFormatted = newStartUTC.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
                        const oraFormatted = newStartUTC.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
                        const petText = bookingData.petName ? ` per ${bookingData.petName}` : '';

                        let messageText = `Ciao ${nomeBreve}, l'app.to${petText} da ${nomeNegozioSms} e' stato SPOSTATO al ${dataFormatted} alle ore ${oraFormatted}. A presto!`;
                        const macrodroidUrl = `https://trigger.macrodroid.com/51db87e2-5593-48a5-9df5-a59f5dc9cf07/bazar_sms?phone=${encodeURIComponent(numeroPulito)}&message=${encodeURIComponent(messageText)}`;
                        await safeFetch(macrodroidUrl, {}, 2500);
                    } catch (e) {}
                }

                if (bookingData.customerEmail && bookingData.appointmentCode && bookingData.appointmentCode.startsWith('WEB_')) {
                    try {
                        const merchantEmail = vendorData.email || null;

                        await safeFetch(ORDER_EMAIL_NOTIFICATION_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                notificationType: 'appointment_booking',
                                vendorId: bookingData.vendorId,
                                bookingDetails: {
                                    ...bookingData,
                                    id: bookingId,
                                    startDateTime: admin.firestore.Timestamp.fromDate(newStartUTC),
                                    endDateTime: admin.firestore.Timestamp.fromDate(newEndUTC)
                                },
                                recipients: {
                                    customer: bookingData.customerEmail,
                                    merchant: merchantEmail
                                }
                            })
                        }, 3500);
                    } catch (emailErr) {
                        console.error("[Vet] Errore invio email spostamento:", emailErr);
                    }
                }

                return res.status(200).json({ success: true, message: 'Prenotazione riprogrammata.' });
            }

    // ============================================================
    // 12. COMPLETAMENTO PRENOTAZIONE DA TABLET OPERATORE
    // ============================================================
    else if (action === 'complete_operator_booking') {
        const { bookingId, token } = req.body;
        const expectedToken = Buffer.from(vendorId + '_civora_totem_kiosk_pass').toString('base64').substring(0, 16);

        if (!bookingId || !token || token !== expectedToken) {
            return res.status(403).json({ error: 'Accesso negato: token non valido.' });
        }

        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();

        if (!bookingDoc.exists) {
            return res.status(404).json({ error: 'Prenotazione non trovata.' });
        }

        await bookingRef.update({
            status: 'completed',
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(200).json({ success: true, message: 'Prestazione completata con successo.' });
    }

    // ============================================================
    // 13. DATI LIVE PER TABLET RECEPTION OPERATORE
    // ============================================================
    else if (action === 'get_operator_live_data') {
        const { token } = req.body;
        const expectedToken = Buffer.from(vendorId + '_civora_totem_kiosk_pass').toString('base64').substring(0, 16);

        if (!token || token !== expectedToken) {
            return res.status(403).json({ error: 'Accesso negato.' });
        }

        const vendorDoc = await db.collection('vendors').doc(vendorId).get();
        if (!vendorDoc.exists) {
            return res.status(404).json({ error: 'Attività non trovata.' });
        }
        const vData = vendorDoc.data();

        const collabsSnap = await db.collection('vendors').doc(vendorId).collection('collaborators')
            .where('isActive', '==', true)
            .get();

        const collaborators = collabsSnap.docs.map(doc => ({
            id: doc.id,
            name: doc.data().name,
            color: doc.data().color || '#10B981',
            role: doc.data().role || 'collaborator',
            servicesOffered: Array.isArray(doc.data().servicesOffered) ? doc.data().servicesOffered : []
        }));

        const now = new Date();
        const offsetMins = getDynamicOffsetMinutes(now, vData.timezone || 'Europe/Rome');
        const localNow = new Date(now.getTime() - offsetMins * 60 * 1000);
        const y = localNow.getFullYear();
        const m = localNow.getMonth();
        const d = localNow.getDate();

        const startOfDayUTC = new Date(Date.UTC(y, m, d, 0, 0, 0) + offsetMins * 60 * 1000);
        const endOfDayUTC = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) + offsetMins * 60 * 1000);

        const bookingsSnap = await db.collection('bookings')
            .where('vendorId', '==', vendorId)
            .where('startDateTime', '>=', admin.firestore.Timestamp.fromDate(startOfDayUTC))
            .where('startDateTime', '<=', admin.firestore.Timestamp.fromDate(endOfDayUTC))
            .where('status', 'in', ['confirmed', 'paid', 'pending', 'rescheduled', 'pending-cash'])
            .get();

        const todayBookings = bookingsSnap.docs.map(doc => {
                    const b = doc.data();
                    return {
                        id: doc.id,
                        resourceId: b.bookedForResourceId || vendorId,
                        customerName: b.customerName || 'Cliente',
                        customerPhone: b.customerPhone || '',
                        petName: b.petName || '',
                        petType: b.petType || 'Cane',
                        petBreed: b.petBreed || '',
                        petSize: b.petSize || '',
                        bookedServiceName: b.bookedServiceName || 'Prestazione',
                        status: b.status || 'confirmed',
                        paymentStatus: b.paymentStatus || 'pending',
                        start: b.startDateTime.toDate().toISOString(),
                        end: b.endDateTime.toDate().toISOString()
                    };
                });

        const serviceSnap = await db.collection('artisan_services')
            .where('vendorId', '==', vendorId)
            .limit(1)
            .get();
        const defaultServiceId = !serviceSnap.empty ? serviceSnap.docs[0].id : null;

        const productsSnap = await db.collection('offers')
            .where('vendorId', '==', vendorId)
            .get();
        const products = productsSnap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        const clientsSnap = await db.collection('vendors').doc(vendorId).collection('clients').get();
        const clients = clientsSnap.docs.map(doc => ({
            id: doc.id,
            name: doc.data().name || '',
            surname: doc.data().surname || '',
            phone: doc.data().phone || '',
            notes: doc.data().notes || ''
        }));

        let pendingOrders = [];
        try {
            const ordersSnap = await db.collection('vendors').doc(vendorId).collection('kiosk_orders')
                .where('status', '==', 'pending')
                .get();
            pendingOrders = ordersSnap.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAtIso: doc.data().createdAt ? doc.data().createdAt.toDate().toISOString() : new Date().toISOString()
            }));
        } catch(oErr) {}

        return res.status(200).json({
            success: true,
            vendorData: {
                store_name: vData.store_name || 'Clinica / Toelettatura',
                owner_name: vData.owner_name || vData.store_name || 'Dottore Principale',
                ownerBookingColor: vData.ownerBookingColor || '#7C3AED',
                logoUrl: vData.logoUrl || null,
                servicesOffered: Array.isArray(vData.servicesOffered) ? vData.servicesOffered : [],
                public_opening_hours_structured: vData.public_opening_hours_structured || [],
                opening_hours_structured: vData.opening_hours_structured || []
            },
            collaborators: collaborators,
            todayBookings: todayBookings,
            defaultServiceId: defaultServiceId,
            products: products,
            clients: clients,
            kioskOrders: pendingOrders
        });
    }

    // ============================================================
    // 14. SCALAMENTO SCORTE FARMACI / PRODOTTI PET
    // ============================================================
    else if (action === 'update_product_stock') {
        const { token, productId, changeDelta, variantColor, sizeName } = req.body;
        const expectedToken = Buffer.from(vendorId + '_civora_totem_kiosk_pass').toString('base64').substring(0, 16);

        if (!token || token !== expectedToken) {
            return res.status(403).json({ error: 'Accesso negato.' });
        }

        if (!productId || typeof changeDelta !== 'number') {
            return res.status(400).json({ error: 'Dati mancanti.' });
        }

        const offerRef = db.collection('offers').doc(productId);
        const globalRef = db.collection('global_product_catalog').doc(productId);

        const offerDoc = await offerRef.get();
        if (!offerDoc.exists) return res.status(404).json({ error: 'Prodotto non trovato.' });

        const productData = offerDoc.data();
        let variants = productData.productVariants || [];
        let newTotalQty = parseInt(productData.quantity, 10) || 0;

        if (variants.length > 0) {
            let targetVariant = variantColor ? variants.find(v => v.color === variantColor) : variants[0];
            if (!targetVariant && variants.length > 0) targetVariant = variants[0];

            if (targetVariant) {
                if (targetVariant.sizeVariants && targetVariant.sizeVariants.length > 0) {
                    let targetSize = sizeName ? targetVariant.sizeVariants.find(s => s.name === sizeName) : targetVariant.sizeVariants[0];
                    if (!targetSize && targetVariant.sizeVariants.length > 0) targetSize = targetVariant.sizeVariants[0];

                    if (targetSize) {
                        const curSizeQty = parseInt(targetSize.quantity, 10) || 0;
                        targetSize.quantity = Math.max(0, curSizeQty + changeDelta);
                    }
                    targetVariant.quantity = targetVariant.sizeVariants.reduce((sum, s) => sum + (parseInt(s.quantity, 10) || 0), 0);
                } else {
                    const curVarQty = parseInt(targetVariant.quantity, 10) || 0;
                    targetVariant.quantity = Math.max(0, curVarQty + changeDelta);
                }
            }
            newTotalQty = variants.reduce((sum, v) => sum + (parseInt(v.quantity, 10) || 0), 0);
        } else {
            newTotalQty = Math.max(0, newTotalQty + changeDelta);
        }

        const isSoldOut = newTotalQty <= 0;
        const updatePayload = {
            quantity: newTotalQty,
            isSoldOut: isSoldOut,
            productVariants: variants,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const batch = db.batch();
        batch.update(offerRef, updatePayload);
        batch.update(globalRef, updatePayload);
        await batch.commit();

        return res.status(200).json({
            success: true,
            newQuantity: newTotalQty,
            isSoldOut: isSoldOut,
            productVariants: variants
        });
    }

    // ============================================================
    // 15. ORDINI AL BANCONE DAL TOTEM (PRODOTTI/FARMACI PET)
    // ============================================================
    else if (action === 'save_kiosk_product_order') {
        const { orderData } = req.body;
        if (!orderData || !vendorId) {
            return res.status(400).json({ error: 'Dati mancanti.' });
        }

        const newOrder = {
            vendorId: String(vendorId),
            productId: String(orderData.productId || ''),
            productName: String(orderData.productName || 'Prodotto'),
            brand: String(orderData.brand || ''),
            imageUrl: String(orderData.imageUrl || ''),
            variantColor: orderData.variantColor || null,
            sizeName: orderData.sizeName || null,
            variantLabel: String(orderData.variantLabel || ''),
            price: Number(orderData.price) || 0,
            quantity: Number(orderData.quantity) || 1,
            customerName: String(orderData.customerName || 'Cliente'),
            status: 'pending',
            source: 'kiosk_totem_pet_product_order',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('vendors').doc(vendorId).collection('kiosk_orders').add(newOrder);

        try {
            await db.collection('vendors').doc(vendorId).update({
                lastKioskOrderPulse: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch(pErr) {}

        return res.status(200).json({
            success: true,
            orderId: docRef.id,
            message: 'Ordine registrato.'
        });
    }

    // ============================================================
    // 16. PREPARAZIONE ORDINE AL BANCONE
    // ============================================================
    else if (action === 'complete_kiosk_product_order') {
        const { orderId, productId, changeDelta, variantColor, sizeName } = req.body;
        if (!orderId || !vendorId) {
            return res.status(400).json({ error: 'Dati mancanti.' });
        }

        await db.collection('vendors').doc(vendorId).collection('kiosk_orders').doc(orderId).update({
            status: 'completed',
            preparedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        if (productId) {
            const offerRef = db.collection('offers').doc(productId);
            const globalRef = db.collection('global_product_catalog').doc(productId);
            const offerDoc = await offerRef.get();

            if (offerDoc.exists) {
                const productData = offerDoc.data();
                let variants = productData.productVariants || [];
                let newTotalQty = parseInt(productData.quantity, 10) || 0;
                const delta = typeof changeDelta === 'number' ? changeDelta : -1;

                if (variants.length > 0) {
                    let targetVariant = variantColor ? variants.find(v => v.color === variantColor) : variants[0];
                    if (!targetVariant && variants.length > 0) targetVariant = variants[0];

                    if (targetVariant) {
                        if (targetVariant.sizeVariants && targetVariant.sizeVariants.length > 0) {
                            let targetSize = sizeName ? targetVariant.sizeVariants.find(s => s.name === sizeName) : targetVariant.sizeVariants[0];
                            if (!targetSize && targetVariant.sizeVariants.length > 0) targetSize = targetVariant.sizeVariants[0];

                            if (targetSize) {
                                const curSizeQty = parseInt(targetSize.quantity, 10) || 0;
                                targetSize.quantity = Math.max(0, curSizeQty + delta);
                            }
                            targetVariant.quantity = targetVariant.sizeVariants.reduce((sum, s) => sum + (parseInt(s.quantity, 10) || 0), 0);
                        } else {
                            const curVarQty = parseInt(targetVariant.quantity, 10) || 0;
                            targetVariant.quantity = Math.max(0, curVarQty + delta);
                        }
                    }
                    newTotalQty = variants.reduce((sum, v) => sum + (parseInt(v.quantity, 10) || 0), 0);
                } else {
                    newTotalQty = Math.max(0, newTotalQty + delta);
                }

                const isSoldOut = newTotalQty <= 0;
                const updatePayload = {
                    quantity: newTotalQty,
                    isSoldOut: isSoldOut,
                    productVariants: variants,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                };

                const batch = db.batch();
                batch.update(offerRef, updatePayload);
                batch.update(globalRef, updatePayload);
                await batch.commit();
            }
        }

        try {
            await db.collection('vendors').doc(vendorId).update({
                lastKioskOrderPulse: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch(pErr) {}

        return res.status(200).json({
            success: true,
            message: 'Ordine preparato.'
        });
    }

    return res.status(400).json({ error: `Azione non riconosciuta: ${action}.` });

  } catch (error) {
    console.error('SERVER ERROR (Vet API):', error);
    res.status(500).json({ error: 'Errore interno del server.', details: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};
