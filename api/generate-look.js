const { GoogleAuth } = require('google-auth-library');
// --- INIZIO: AGGIUNTE PER FIRESTORE ADMIN SDK ---
const admin = require('firebase-admin');
let firebaseAdminApp; // Dichiarazione per l'istanza dell'app Firebase Admin
// --- FINE: AGGIUNTE PER FIRESTORE ADMIN SDK ---

module.exports = async (req, res) => {
// 1. CORS DINAMICO
const origin = req.headers.origin || '*';
res.setHeader('Access-Control-Allow-Origin', origin);
res.setHeader('Access-Control-Allow-Credentials', 'true');
res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

if (req.method === 'OPTIONS') {
return res.status(200).end();
}

if (req.method === 'GET') {
return res.status(200).json({ message: "BINGO! Motore acceso (Versione GEMINI 2.5 FLASH IMAGE)!" });
}

if (req.method !== 'POST') {
return res.status(405).json({ error: 'Metodo non consentito, usa POST.' });
}

try {
const { imageBase64, prompt, vendorId, kioskToken } = req.body;

if (!imageBase64 || !prompt) {
return res.status(400).json({ error: 'Immagine o comando mancanti.' });
}

if (!process.env.GOOGLE_CREDENTIALS) {
return res.status(500).json({ error: 'Chiave Google Cloud mancante.' });
}

// Funzione di supporto per connettersi a Firebase Admin in modo sicuro
function getAdminDb() {
if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) return null;
if (!firebaseAdminApp) {
const decodedCredentialsString = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8');
const adminCredentials = JSON.parse(decodedCredentialsString);
firebaseAdminApp = admin.initializeApp({
credential: admin.credential.cert(adminCredentials)
}, 'globalCounterApp');
}
return admin.firestore(firebaseAdminApp);
}

// 🛡️ CASSAFORTE SERVER: CONTROLLO CREDITI & PROTEZIONE SALONE
if (vendorId) {
const adminDb = getAdminDb();
if (adminDb) {
try {
const vendorDoc = await adminDb.collection('vendors').doc(vendorId).get();
if (vendorDoc.exists) {
const vData = vendorDoc.data() || {};
const remainingCredits = vData.ai_generations_remaining || 0;

// 1. BLOCCO FINANZIARIO: Se il salone ha finito i crediti, rifiuta PRIMA di spendere soldi!
if (remainingCredits <= 0) {
return res.status(403).json({
error: 'Crediti AI esauriti per questo salone. Ricarica i crediti per continuare.'
});
}

// 2. PROTEZIONE TABLET KIOSK: Se la richiesta arriva dal totem, verifica la chiave segreta!
if (kioskToken) {
const expectedKioskToken = Buffer.from(`${vendorId}_civora_totem_kiosk_pass`).toString('base64').substring(0, 16);
if (kioskToken !== expectedKioskToken && kioskToken !== 'direct_auth') {
return res.status(401).json({
error: 'Accesso negato: Chiave tablet non valida o non autorizzata.'
});
}
}
}
} catch (checkErr) {
console.warn("Avviso verifica crediti preventiva:", checkErr);
// Non blocca se c'è un piccolo ritardo di connessione al database
}
}
}

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

const auth = new GoogleAuth({
credentials,
scopes:['https://www.googleapis.com/auth/cloud-platform']
});

const client = await auth.getClient();
const accessToken = (await client.getAccessToken()).token;

const projectId = credentials.project_id;
const location = 'global';
const modelId = 'gemini-3.1-flash-image';

// ATTENZIONE: per il server "global" l'URL ha un formato diverso!
const url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`;

const cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");
const detectedMimeType = imageBase64.match(/^data:(image\/[a-z]+);base64,/);
const finalMimeType = detectedMimeType ? detectedMimeType[1] : "image/webp";

// Verifichiamo se è stata inviata anche una referenceImageBase64
const { referenceImageBase64 } = req.body;

let partsForGemini = [
{
text: prompt
},
{
inlineData: {
mimeType: finalMimeType,
data: cleanBase64
}
}
];

// Se c'è una foto di riferimento, la aggiungiamo al payload per Gemini
if (referenceImageBase64) {
const cleanReferenceBase64 = referenceImageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");
const detectedReferenceMimeType = referenceImageBase64.match(/^data:(image\/[a-z]+);base64,/);
const finalReferenceMimeType = detectedReferenceMimeType ? detectedReferenceMimeType[1] : "image/jpeg"; // Di solito è JPEG

partsForGemini.push({
inlineData: {
mimeType: finalReferenceMimeType,
data: cleanReferenceBase64
}
});
}

const payload = {
contents: [{
role: "user",
parts: partsForGemini
}],
generationConfig: {
responseModalities: ["TEXT", "IMAGE"]
}
};
const response = await fetch(url, {
method: 'POST',
headers: {
'Authorization': `Bearer ${accessToken}`,
'Content-Type': 'application/json'
},
body: JSON.stringify(payload)
});

const data = await response.json();

if (!response.ok) {
console.error("Errore da Vertex:", JSON.stringify(data, null, 2));
return res.status(response.status).json({ error: 'Errore Vertex', details: data });
}

// Gemini restituisce un array di "parts", noi cerchiamo quello che contiene l'immagine
let returnedImageBase64 = null;

if (data.candidates && data.candidates.length > 0) {
const parts = data.candidates[0].content.parts;
for (let part of parts) {
if (part.inlineData && part.inlineData.data) {
returnedImageBase64 = part.inlineData.data;
break;
}
}
}

if (returnedImageBase64) {
// --- INIZIO: SCALATA CREDITI SALONE E CONTATORE GLOBALE ADMIN ---
if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
try {
if (!firebaseAdminApp) {
const decodedCredentialsString = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8');
const adminCredentials = JSON.parse(decodedCredentialsString);
firebaseAdminApp = admin.initializeApp({
credential: admin.credential.cert(adminCredentials)
}, 'globalCounterApp');
}
const db = admin.firestore(firebaseAdminApp);

// 🛡️ 1. SCALATA ATOMICA CREDITI DEL SALONE (-1 credito reale dal server)
if (vendorId) {
try {
await db.collection('vendors').doc(vendorId).update({
ai_generations_remaining: admin.firestore.FieldValue.increment(-1),
total_ai_generations_produced: admin.firestore.FieldValue.increment(1)
});
console.log(`[CREDITI SERVER] Scalato 1 credito con successo al salone: ${vendorId}`);
} catch (deductErr) {
console.error("Errore scalata credito salone:", deductErr);
}
}

// 📊 2. Aggiorna il contatore globale Civora
const globalStatsRef = db.collection('civora_analytics').doc('ai_gen');
await globalStatsRef.update({
total_generated_images_ai: admin.firestore.FieldValue.increment(1)
});

// 📈 3. Aggiorna la statistica mensile specifica del negozio
if (vendorId) {
try {
const now = new Date();
const options = { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit' };
const formatter = new Intl.DateTimeFormat('it-IT', options);
const parts = formatter.formatToParts(now);

const anno = parts.find(p => p.type === 'year').value;
const mese = parts.find(p => p.type === 'month').value;
const docId = `${vendorId}_${anno}_${mese}`;

const activityRef = db.collection('civora_analytics')
.doc('ai_gen')
.collection('activities')
.doc(docId);

await activityRef.set({
idattivita: vendorId,
anno: anno,
mese: mese,
total_generated_images_ai: admin.firestore.FieldValue.increment(1),
last_generation: admin.firestore.FieldValue.serverTimestamp()
}, { merge: true });

console.log(`Statistiche salvate per negozio ${vendorId} - Periodo ${anno}/${mese}`);

} catch (statsError) {
console.error("Errore salvataggio statistiche negozio:", statsError);
}
}

} catch (error) {
if (error.code === 5 || (error.details && error.details.includes('not found'))) {
try {
const decodedCredentialsString = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8');
const adminCredentials = JSON.parse(decodedCredentialsString);
if (!firebaseAdminApp) {
firebaseAdminApp = admin.initializeApp({
credential: admin.credential.cert(adminCredentials)
}, 'globalCounterApp');
}
const db = admin.firestore(firebaseAdminApp);
await db.collection('civora_analytics').doc('ai_gen').set({
total_generated_images_ai: 1
});
} catch (setError) {
console.error("Errore creazione contatore globale:", setError);
}
} else {
console.error("Errore contatore globale AI:", error);
}
}
}
// --- FINE: SCALATA CREDITI SALONE E CONTATORE GLOBALE ADMIN ---

return res.status(200).json({ imageBase64: `data:image/webp;base64,${returnedImageBase64}` });
} else {
console.error("Risposta anomala da Gemini:", JSON.stringify(data, null, 2));
return res.status(500).json({ error: 'Nessuna immagine restituita da Google.' });
}

} catch (error) {
console.error('Errore Try-Catch:', error);
return res.status(500).json({ error: 'Errore interno', details: error.message });
}
};
