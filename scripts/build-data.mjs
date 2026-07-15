// Distills public/hindu_temples.csv (source of truth, ~16k rows) into
// public/temples.json: only temples with a photo, only the fields the app shows.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const csvPath = path.join(root, "public", "hindu_temples.csv");
const outPath = path.join(root, "public", "temples.json");

// Minimal RFC 4180 parser — the dataset has quoted fields containing commas.
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

// Wikimedia Special:FilePath URLs in the dataset request 640px thumbnails;
// the photo is the centerpiece of the app, so ask for a larger rendition.
const upscale = (url) => url.replace(/([?&]width=)\d+/, "$11400");

const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
const header = rows[0];
const col = Object.fromEntries(header.map((name, i) => [name, i]));

const temples = rows
  .slice(1)
  .map((r) => {
    let name = clean(r[col.name_en]);
    // A few source names start lowercase (e.g. "athi Sokkanathar Temple").
    if (name) name = name[0].toUpperCase() + name.slice(1);
    const image = clean(r[col.best_image_url]) ?? clean(r[col.wiki_image_url]);
    if (!name || !image) return null;
    const lat = Number(r[col.lat]);
    const lon = Number(r[col.lon]);
    return {
      qid: r[col.qid],
      name,
      state: clean(r[col.state_name]),
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      deity: clean(r[col.deity]),
      style: clean(r[col.architecture_style]),
      inception: clean(r[col.inception]),
      heritage: clean(r[col.heritage_status]),
      commissionedBy: clean(r[col.commissioned_by]),
      foundedBy: clean(r[col.founded_by]),
      image: upscale(image),
      imageAuthor: clean(r[col.image_author]),
      imageLicense: clean(r[col.image_license]),
      wikipedia: clean(r[col.wikipedia_en]),
    };
  })
  .filter(Boolean);

fs.writeFileSync(outPath, JSON.stringify(temples));
console.log(`Wrote ${temples.length} temples to ${path.relative(root, outPath)}`);
