const admin = require("firebase-admin");
const fs = require("fs");

const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function exportAfMap() {
  try {
    const snapshot = await db.collection("af_map").get();

    const rows = snapshot.docs.map((doc) => ({
      firebase_id: doc.id,
      ...doc.data(),
    }));

    fs.writeFileSync(
      "./af-map-export.json",
      JSON.stringify(rows, null, 2),
      "utf8"
    );

    console.log(`Export AF_MAP terminé : ${rows.length} lignes`);
  } catch (error) {
    console.error("Erreur export AF_MAP :", error);
  } finally {
    process.exit();
  }
}

exportAfMap();