#!/usr/bin/env python3
"""
Build a dataset of Hindu temples in India from Wikidata: names (English +
Indic scripts), state, coordinates, a photo URL, and structured attributes
(deity, architectural style, patron/dynasty, construction date, heritage
status, inscription text) where Wikidata has them.

Selector: anything that is an instance of a subclass of "Hindu temple"
(Q842402) located in India (P17 Q668). This catches subclasses like
Shiva temple, Vishnu temple, Jyotirlinga, etc.

Endpoint: QLever's Wikidata mirror by default (no timeout; index lags live
Wikidata by a few days).

Usage:
  python3 wikidata_hindu_temples.py --langs en hi ta te kn ml bn or mr gu \
      --out hindu_temples.csv
"""

import argparse
import csv
import io
import sys
import time
from collections import defaultdict

import requests

QLEVER = "https://qlever.cs.uni-freiburg.de/api/wikidata"
UA = "hindu-temples-gazetteer/1.0 (personal research script)"

PREFIXES = """
PREFIX wd:     <http://www.wikidata.org/entity/>
PREFIX wdt:    <http://www.wikidata.org/prop/direct/>
PREFIX rdfs:   <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/>
"""

SELECTOR = """
  ?t wdt:P31/wdt:P279* wd:Q842402 .   # Hindu temple (incl. subclasses)
  ?t wdt:P17 wd:Q668 .                # in India
"""

BASE_QUERY = PREFIXES + "SELECT DISTINCT ?t WHERE {" + SELECTOR + "}"

LABEL_QUERY = PREFIXES + """
SELECT ?t ?label WHERE {
""" + SELECTOR + """
  ?t rdfs:label ?label .
  FILTER(LANG(?label) = "%s")
}
"""

STATE_QUERY = PREFIXES + """
SELECT ?t (SAMPLE(?state) AS ?st) WHERE {
""" + SELECTOR + """
  ?t wdt:P131* ?state .
  { ?state wdt:P31 wd:Q12443800 } UNION { ?state wdt:P31 wd:Q467745 }
}
GROUP BY ?t
"""

STATE_NAME_QUERY = PREFIXES + """
SELECT ?state ?label WHERE {
  { ?state wdt:P31 wd:Q12443800 } UNION { ?state wdt:P31 wd:Q467745 }
  ?state rdfs:label ?label .
  FILTER(LANG(?label) = "en")
}
"""

WIKI_QUERY = PREFIXES + """
SELECT ?t ?article WHERE {
""" + SELECTOR + """
  ?article schema:about ?t ;
           schema:isPartOf <https://%s.wikipedia.org/> .
}
"""

# Attribute properties. is_entity=True means the value is another Wikidata
# item, so its English label is fetched; otherwise the literal is taken as-is.
# Multi-valued results are concatenated server-side with "; ".
ATTRIBUTES = [
    # column,            PID,      is_entity
    ("image_url",        "P18",    False),  # Commons file -> direct URL
    ("deity",            "P825",   True),   # dedicated to
    ("religion",         "P140",   True),
    ("architecture_style", "P149", True),
    ("commissioned_by",  "P88",    True),   # patron king/dynasty, if recorded
    ("founded_by",       "P112",   True),
    ("inception",        "P571",   False),  # construction/consecration date
    ("heritage_status",  "P1435",  True),   # e.g. ASI Monument of Natl. Importance
    ("inscription",      "P1684",  False),  # inscription text, rarely filled
    ("commons_category", "P373",   False),
]

ENTITY_ATTR_QUERY = PREFIXES + """
SELECT ?t (GROUP_CONCAT(DISTINCT ?vl; SEPARATOR="; ") AS ?v) WHERE {
""" + SELECTOR + """
  ?t wdt:%s ?val .
  ?val rdfs:label ?vl .
  FILTER(LANG(?vl) = "en")
}
GROUP BY ?t
"""

LITERAL_ATTR_QUERY = PREFIXES + """
SELECT ?t (GROUP_CONCAT(DISTINCT STR(?val); SEPARATOR="; ") AS ?v) WHERE {
""" + SELECTOR + """
  ?t wdt:%s ?val .
}
GROUP BY ?t
"""

COORD_QUERY = PREFIXES + """
SELECT ?t (SAMPLE(?coord) AS ?c) WHERE {
""" + SELECTOR + """
  ?t wdt:P625 ?coord .
}
GROUP BY ?t
"""


def run_csv(query: str, endpoint: str = QLEVER, retries: int = 3) -> csv.reader:
    for attempt in range(1, retries + 1):
        try:
            resp = requests.post(
                endpoint,
                data={"query": query},
                headers={"Accept": "text/csv", "User-Agent": UA},
                timeout=1800,
            )
            resp.raise_for_status()
            resp.encoding = "utf-8"
            return csv.reader(io.StringIO(resp.text))
        except Exception as e:
            print(f"  attempt {attempt} failed: {e}", file=sys.stderr)
            if attempt == retries:
                raise
            time.sleep(10 * attempt)


def qid(uri: str) -> str:
    return uri.rsplit("/", 1)[-1]


def parse_point(wkt: str) -> tuple[str, str]:
    try:
        inner = wkt[wkt.index("(") + 1:wkt.index(")")]
        lon, lat = inner.split()
        return lat, lon
    except Exception:
        return "", ""


def fetch_lead_images(titles: list[str], wiki_lang: str = "en",
                      batch: int = 50) -> dict[str, str]:
    """Article title -> lead image URL, via the MediaWiki pageimages API.

    This returns the image chosen by the PageImages algorithm (usually the
    infobox/lead photo), which is often better curated than Wikidata's P18.
    """
    from urllib.parse import unquote
    api = f"https://{wiki_lang}.wikipedia.org/w/api.php"
    out: dict[str, str] = {}
    for i in range(0, len(titles), batch):
        chunk = titles[i:i + batch]
        try:
            resp = requests.get(api, params={
                "action": "query", "format": "json", "prop": "pageimages",
                "piprop": "original", "redirects": 1,
                "titles": "|".join(chunk),
            }, headers={"User-Agent": UA}, timeout=60)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            print(f"  pageimages batch failed: {e}", file=sys.stderr)
            continue
        # map redirected titles back to what we asked for
        back = {}
        for rd in data.get("query", {}).get("redirects", []):
            back[rd["to"]] = rd["from"]
        for rd in data.get("query", {}).get("normalized", []):
            back[rd["to"]] = rd["from"]
        for page in data.get("query", {}).get("pages", {}).values():
            img = page.get("original", {}).get("source")
            if img:
                title = page.get("title", "")
                out[back.get(title, title)] = img
        time.sleep(0.3)  # be polite
        if i and i % 2500 == 0:
            print(f"  {i}/{len(titles)} titles...", file=sys.stderr)
    return out


def title_from_url(url: str) -> str:
    from urllib.parse import unquote
    return unquote(url.rsplit("/wiki/", 1)[-1]).replace("_", " ")


def commons_file_title(url: str) -> str:
    """Image URL -> 'File:...' title, or '' if not hosted on Commons.

    Handles both Special:FilePath URLs (from P18) and direct
    upload.wikimedia.org/wikipedia/commons/ URLs (from pageimages),
    including /thumb/ variants.
    """
    from urllib.parse import unquote, urlparse
    u = urlparse(url)
    path = unquote(u.path)
    if "Special:FilePath/" in path and "commons.wikimedia.org" in u.netloc:
        return "File:" + path.split("Special:FilePath/", 1)[1]
    if "/wikipedia/commons/" in path:
        parts = path.split("/")
        name = parts[-2] if "/thumb/" in path else parts[-1]
        return "File:" + name.replace("_", " ")
    return ""  # local (possibly fair-use) upload or other host


def strip_html(s: str) -> str:
    import re
    return re.sub(r"<[^>]+>", "", s).strip()


def fetch_image_metadata(file_titles: list[str],
                         batch: int = 50) -> dict[str, tuple[str, str]]:
    """'File:...' -> (license short name, author), from Commons extmetadata."""
    api = "https://commons.wikimedia.org/w/api.php"
    out: dict[str, tuple[str, str]] = {}
    for i in range(0, len(file_titles), batch):
        chunk = file_titles[i:i + batch]
        try:
            resp = requests.get(api, params={
                "action": "query", "format": "json", "prop": "imageinfo",
                "iiprop": "extmetadata",
                "iiextmetadatafilter": "LicenseShortName|Artist",
                "titles": "|".join(chunk),
            }, headers={"User-Agent": UA}, timeout=60)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            print(f"  imageinfo batch failed: {e}", file=sys.stderr)
            continue
        back = {}
        for rd in data.get("query", {}).get("normalized", []):
            back[rd["to"]] = rd["from"]
        for page in data.get("query", {}).get("pages", {}).values():
            info = (page.get("imageinfo") or [{}])[0].get("extmetadata", {})
            lic = info.get("LicenseShortName", {}).get("value", "")
            artist = strip_html(info.get("Artist", {}).get("value", ""))
            title = page.get("title", "")
            out[back.get(title, title)] = (lic, artist)
        time.sleep(0.3)
        if i and i % 2500 == 0:
            print(f"  {i}/{len(file_titles)} files...", file=sys.stderr)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--langs", nargs="+",
                    default=["en", "hi", "ta", "te", "kn",
                             "ml", "bn", "or", "mr", "gu"])
    ap.add_argument("--wiki-langs", nargs="+", default=["en"])
    ap.add_argument("--thumb-width", type=int, default=640,
                    help="rewrite image URLs as thumbnails of this width "
                         "(0 = original full-size file)")
    ap.add_argument("--no-lead-images", action="store_true",
                    help="skip fetching Wikipedia lead images "
                         "(wiki_image_url column)")
    ap.add_argument("--out", default="hindu_temples.csv")
    ap.add_argument("--endpoint", default=QLEVER)
    args = ap.parse_args()

    attr_cols = [c for c, _, _ in ATTRIBUTES]

    print("Fetching temple entity set...", file=sys.stderr)
    rows = run_csv(BASE_QUERY, args.endpoint)
    next(rows, None)
    temples: dict[str, dict] = {}
    for r in rows:
        if r and r[0]:
            temples[qid(r[0])] = {c: "" for c in
                                  ["state_name", "lat", "lon"] + attr_cols}
    print(f"  {len(temples):,} temples", file=sys.stderr)

    print("Resolving states...", file=sys.stderr)
    rows = run_csv(STATE_NAME_QUERY, args.endpoint)
    next(rows, None)
    state_names = {qid(r[0]): r[1] for r in rows if len(r) >= 2 and r[0]}
    rows = run_csv(STATE_QUERY, args.endpoint)
    next(rows, None)
    for r in rows:
        if len(r) >= 2 and r[0] and r[1]:
            q = qid(r[0])
            if q in temples:
                temples[q]["state_name"] = state_names.get(qid(r[1]), "")

    print("Fetching coordinates...", file=sys.stderr)
    rows = run_csv(COORD_QUERY, args.endpoint)
    next(rows, None)
    for r in rows:
        if len(r) >= 2 and r[0] and r[1]:
            q = qid(r[0])
            if q in temples:
                temples[q]["lat"], temples[q]["lon"] = parse_point(r[1])

    for col, pid, is_entity in ATTRIBUTES:
        print(f"Fetching {col} ({pid})...", file=sys.stderr)
        tmpl = ENTITY_ATTR_QUERY if is_entity else LITERAL_ATTR_QUERY
        rows = run_csv(tmpl % pid, args.endpoint)
        next(rows, None)
        n = 0
        for r in rows:
            if len(r) >= 2 and r[0] and r[1]:
                q = qid(r[0])
                if q in temples:
                    temples[q][col] = r[1]
                    n += 1
        print(f"  {n:,} temples have {col}", file=sys.stderr)

    # Rewrite P18 file URLs as fixed-width thumbnails (Commons supports
    # Special:FilePath/<file>?width=N which redirects to a scaled image).
    if args.thumb_width:
        for t in temples.values():
            if t["image_url"]:
                first = t["image_url"].split("; ")[0]
                t["image_url"] = f"{first}?width={args.thumb_width}"

    labels: dict[str, dict[str, str]] = defaultdict(dict)
    for lang in args.langs:
        print(f"Fetching labels: {lang} ...", file=sys.stderr)
        rows = run_csv(LABEL_QUERY % lang, args.endpoint)
        next(rows, None)
        for r in rows:
            if len(r) >= 2 and r[0]:
                q = qid(r[0])
                if q in temples and lang not in labels[q]:
                    labels[q][lang] = r[1]

    wikis: dict[str, dict[str, str]] = defaultdict(dict)
    for wl in args.wiki_langs:
        print(f"Fetching {wl}.wikipedia sitelinks...", file=sys.stderr)
        rows = run_csv(WIKI_QUERY % wl, args.endpoint)
        next(rows, None)
        for r in rows:
            if len(r) >= 2 and r[0] and r[1]:
                q = qid(r[0])
                if q in temples and wl not in wikis[q]:
                    wikis[q][wl] = r[1]

    # ---- Wikipedia lead images (often better curated than P18) --------------
    wiki_images: dict[str, str] = {}   # qid -> image URL
    if not args.no_lead_images:
        wl = args.wiki_langs[0]
        q_by_title = {title_from_url(w[wl]): q
                      for q, w in wikis.items() if wl in w}
        print(f"Fetching {len(q_by_title):,} lead images from "
              f"{wl}.wikipedia (pageimages API)...", file=sys.stderr)
        found = fetch_lead_images(list(q_by_title), wl)
        skipped = 0
        for title, img in found.items():
            if title in q_by_title:
                if commons_file_title(img):          # Commons-hosted only;
                    wiki_images[q_by_title[title]] = img
                else:                                # drop local/fair-use files
                    skipped += 1
        print(f"  {len(wiki_images):,} lead images "
              f"({skipped} non-Commons skipped)", file=sys.stderr)

    # ---- license + author for each temple's best image -----------------------
    best_file: dict[str, str] = {}   # qid -> File: title
    for q, base in temples.items():
        img = wiki_images.get(q) or base["image_url"]
        if img:
            ft = commons_file_title(img)
            if ft:
                best_file[q] = ft
    meta: dict[str, tuple[str, str]] = {}
    if best_file and not args.no_lead_images:
        uniq = sorted(set(best_file.values()))
        print(f"Fetching license info for {len(uniq):,} images "
              f"(Commons imageinfo API)...", file=sys.stderr)
        meta = fetch_image_metadata(uniq)

    fields = (["qid", "state_name", "lat", "lon"]
              + [f"name_{l}" for l in args.langs]
              + attr_cols
              + ["wiki_image_url", "best_image_url",
                 "image_license", "image_author"]
              + [f"wikipedia_{wl}" for wl in args.wiki_langs])
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for q, base in temples.items():
            row = dict(base)
            row["qid"] = q
            row["wiki_image_url"] = wiki_images.get(q, "")
            row["best_image_url"] = wiki_images.get(q) or base["image_url"]
            lic, author = meta.get(best_file.get(q, ""), ("", ""))
            row["image_license"] = lic
            row["image_author"] = author
            for l in args.langs:
                row[f"name_{l}"] = labels[q].get(l, "")
            for wl in args.wiki_langs:
                row[f"wikipedia_{wl}"] = wikis[q].get(wl, "")
            w.writerow(row)

    with_photo = sum(1 for t in temples.values() if t["image_url"])
    print(f"Wrote {len(temples):,} temples to {args.out} "
          f"({with_photo:,} with a photo)", file=sys.stderr)


if __name__ == "__main__":
    main()
