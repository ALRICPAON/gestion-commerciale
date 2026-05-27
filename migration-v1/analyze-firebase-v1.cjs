const fs = require("fs");

const file = "./migration-v1/backup-v1.json";
const raw = fs.readFileSync(file, "utf8");
const data = JSON.parse(raw);

function countDocs(collection) {
  if (!collection || typeof collection !== "object") return 0;
  return Object.keys(collection).length;
}

function countSubDocs(collection, subcollectionName) {
  let total = 0;

  for (const doc of Object.values(collection || {})) {
    const sub = doc.subcollections?.[subcollectionName];
    if (sub && typeof sub === "object") {
      total += Object.keys(sub).length;
    }
  }

  return total;
}

console.log("=== Collections principales ===");
for (const [name, collection] of Object.entries(data)) {
  console.log(`${name}: ${countDocs(collection)}`);
}

console.log("");
console.log("=== Sous-collections utiles ===");
console.log(`achats/lignes: ${countSubDocs(data.achats, "lignes")}`);

console.log("");
console.log("=== Exemples de documents ===");

for (const name of ["fournisseurs", "articles", "af_map", "achats", "lots", "stock_movements"]) {
  const collection = data[name];
  const firstKey = collection ? Object.keys(collection)[0] : null;

  if (!firstKey) {
    console.log(`\n${name}: aucun document`);
    continue;
  }

  console.log(`\n--- ${name} / ${firstKey} ---`);
  console.log(JSON.stringify(collection[firstKey], null, 2).slice(0, 3000));
}