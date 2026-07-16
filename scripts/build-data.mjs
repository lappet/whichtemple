// Distills the temple datasets into public/temples.json for the app:
// public/hindu_temples.csv (~16k rows) merged with public/asi_monuments.csv,
// keeping only temples with a photo and only the fields the app shows.
// On duplicate qids, asi_monuments.csv wins field-by-field (it's the
// fresher extract and carries asi_id).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(root, "public");
const outPath = path.join(publicDir, "temples.json");

// Minimal RFC 4180 parser — the datasets have quoted fields containing commas.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const clean = (v) => {
  const s = v?.trim();
  return s ? s : null;
};

// CSV file -> map of qid -> { column: value } records.
function readRecords(filename) {
  const rows = parseCsv(fs.readFileSync(path.join(publicDir, filename), "utf8"));
  const header = rows[0];
  const records = new Map();
  for (const r of rows.slice(1)) {
    const rec = Object.fromEntries(header.map((name, i) => [name, r[i] ?? ""]));
    if (rec.qid) records.set(rec.qid, rec);
  }
  return records;
}

// Field-by-field merge: the override's value wins wherever it is non-empty.
function mergeRecords(base, override) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (clean(value)) merged[key] = value;
  }
  return merged;
}

// Wikimedia Special:FilePath URLs in the dataset request 640px thumbnails;
// the photo is the centerpiece of the app, so ask for a larger rendition.
const upscale = (url) => url.replace(/([?&]width=)\d+/, "$11400");

// The temple-class query net occasionally catches misclassified churches
// (e.g. "Chapel of St. Jeronimus" via a Wikidata subclass chain).
const NOT_A_TEMPLE = /church|jesus|chapel/i;

// Entries confirmed by hand to not be temples; Wikidata classifies them as
// temples via subclass chains or PMC heritage-grade tagging.
const BLOCKLIST = new Set([
  "Q2942482", // Se Cathedral — Catholic cathedral, Goa
  "Q4867358", // Basilica of Our Lady of Graces — Catholic basilica, Sardhana
  "Q66809965", // Henry Martyn's Pagoda — ruined church tower, Chennai
  "Q98801543", // St. Crispin's Home — Anglican charity home, Pune
  "Q98801475", // Kesari Wada — Tilak's residence / Kesari newspaper office, Pune
  "Q98803819", // Kadbe Ali Talim — wrestling gymnasium, Pune
  "Q17063913", // "Other Idols in Tirumala" — Wikipedia list article, not a place
  "Q27074014", // Lakhpat Gurdwara Sahib — Sikh gurdwara, not a temple
  "Q6733002", // Mahamaham tank, Kumbakonam — temple tank, not a temple
  "Q20581098", // Pambummekkatu Mana — family house known for serpent worship
  "Q104845865", // Valmiki Ashram — ashram
  "Q126163316", // Guru Brahmanand Ashram, Kaimla — ashram
]);

function toTemple(rec) {
  let name = clean(rec.name_en);
  const image = clean(rec.best_image_url) ?? clean(rec.wiki_image_url);
  if (!name || !image) return null;
  if (NOT_A_TEMPLE.test(name) || BLOCKLIST.has(rec.qid)) return null;
  // A few source names start lowercase (e.g. "athi Sokkanathar Temple").
  name = name[0].toUpperCase() + name.slice(1);
  const lat = Number(rec.lat);
  const lon = Number(rec.lon);
  return {
    qid: rec.qid,
    name,
    state: clean(rec.state_name),
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    deity: clean(rec.deity),
    style: clean(rec.architecture_style),
    inception: clean(rec.inception),
    heritage: clean(rec.heritage_status),
    commissionedBy: clean(rec.commissioned_by),
    foundedBy: clean(rec.founded_by),
    asiId: clean(rec.asi_id),
    image: upscale(image),
    imageAuthor: clean(rec.image_author),
    imageLicense: clean(rec.image_license),
    wikipedia: clean(rec.wikipedia_en),
  };
}

const hindu = readRecords("hindu_temples.csv");
const asi = readRecords("asi_monuments.csv");

const merged = new Map(hindu);
let overlaps = 0;
for (const [qid, rec] of asi) {
  if (merged.has(qid)) {
    merged.set(qid, mergeRecords(merged.get(qid), rec));
    overlaps++;
  } else {
    merged.set(qid, rec);
  }
}

const temples = [...merged.values()].map(toTemple).filter(Boolean);

fs.writeFileSync(outPath, JSON.stringify(temples));
console.log(
  `Merged ${hindu.size} hindu_temples + ${asi.size} asi_monuments ` +
    `(${overlaps} overlapping qids) -> ${temples.length} temples with photos ` +
    `in ${path.relative(root, outPath)}`
);
