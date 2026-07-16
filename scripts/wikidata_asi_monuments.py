#!/usr/bin/env python3
"""Fetch ASI-protected temples from Wikidata with the same columns as
hindu_temples.csv (plus an asi_id column at the end), so the two datasets
can be joined or concatenated directly.

Selector: temples (P31 any subclass of Q44539) that carry an ASI Monument ID
(P1371) and have an image (P18). Note P1371 covers both N- (national) and
S- (state-protected) IDs.

Reuses the query templates and enrichment passes (states, coordinates,
attributes, labels, sitelinks, lead images, image license/author) from
wikidata_hindu_temples.py, swapping in this script's selector.

Usage:
  python3 wikidata_asi_monuments.py --out ../public/asi_monuments.csv
"""

import argparse
import sys
from collections import defaultdict
from pathlib import Path

import csv

import wikidata_hindu_temples as wht

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "public" / "asi_monuments.csv"

SELECTOR = """
  ?t wdt:P1371 ?asiId .               # has an ASI monument ID
  ?t wdt:P31/wdt:P279* wd:Q44539 .    # temple (incl. subclasses)
  ?t wdt:P18 ?img .                   # must have an image
"""


def adapt(query: str) -> str:
    """Rebuild one of wht's query templates around this script's selector."""
    return query.replace(wht.SELECTOR, SELECTOR)


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
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--endpoint", default=wht.QLEVER)
    args = ap.parse_args()

    attr_cols = [c for c, _, _ in wht.ATTRIBUTES]

    print("Fetching ASI temple entity set...", file=sys.stderr)
    rows = wht.run_csv(adapt(wht.BASE_QUERY), args.endpoint)
    next(rows, None)
    temples: dict[str, dict] = {}
    for r in rows:
        if r and r[0]:
            temples[wht.qid(r[0])] = {
                c: "" for c in ["state_name", "lat", "lon", "asi_id"] + attr_cols
            }
    print(f"  {len(temples):,} temples", file=sys.stderr)

    print("Fetching ASI monument IDs (P1371)...", file=sys.stderr)
    rows = wht.run_csv(adapt(wht.LITERAL_ATTR_QUERY % "P1371"), args.endpoint)
    next(rows, None)
    for r in rows:
        if len(r) >= 2 and r[0] and r[1]:
            q = wht.qid(r[0])
            if q in temples:
                temples[q]["asi_id"] = r[1]

    print("Resolving states...", file=sys.stderr)
    rows = wht.run_csv(wht.STATE_NAME_QUERY, args.endpoint)
    next(rows, None)
    state_names = {wht.qid(r[0]): r[1] for r in rows if len(r) >= 2 and r[0]}
    rows = wht.run_csv(adapt(wht.STATE_QUERY), args.endpoint)
    next(rows, None)
    for r in rows:
        if len(r) >= 2 and r[0] and r[1]:
            q = wht.qid(r[0])
            if q in temples:
                temples[q]["state_name"] = state_names.get(wht.qid(r[1]), "")

    print("Fetching coordinates...", file=sys.stderr)
    rows = wht.run_csv(adapt(wht.COORD_QUERY), args.endpoint)
    next(rows, None)
    for r in rows:
        if len(r) >= 2 and r[0] and r[1]:
            q = wht.qid(r[0])
            if q in temples:
                temples[q]["lat"], temples[q]["lon"] = wht.parse_point(r[1])

    for col, pid, is_entity in wht.ATTRIBUTES:
        print(f"Fetching {col} ({pid})...", file=sys.stderr)
        tmpl = wht.ENTITY_ATTR_QUERY if is_entity else wht.LITERAL_ATTR_QUERY
        rows = wht.run_csv(adapt(tmpl % pid), args.endpoint)
        next(rows, None)
        n = 0
        for r in rows:
            if len(r) >= 2 and r[0] and r[1]:
                q = wht.qid(r[0])
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
        rows = wht.run_csv(adapt(wht.LABEL_QUERY % lang), args.endpoint)
        next(rows, None)
        for r in rows:
            if len(r) >= 2 and r[0]:
                q = wht.qid(r[0])
                if q in temples and lang not in labels[q]:
                    labels[q][lang] = r[1]

    wikis: dict[str, dict[str, str]] = defaultdict(dict)
    for wl in args.wiki_langs:
        print(f"Fetching {wl}.wikipedia sitelinks...", file=sys.stderr)
        rows = wht.run_csv(adapt(wht.WIKI_QUERY % wl), args.endpoint)
        next(rows, None)
        for r in rows:
            if len(r) >= 2 and r[0] and r[1]:
                q = wht.qid(r[0])
                if q in temples and wl not in wikis[q]:
                    wikis[q][wl] = r[1]

    # ---- Wikipedia lead images (often better curated than P18) --------------
    wiki_images: dict[str, str] = {}   # qid -> image URL
    if not args.no_lead_images:
        wl = args.wiki_langs[0]
        q_by_title = {wht.title_from_url(w[wl]): q
                      for q, w in wikis.items() if wl in w}
        print(f"Fetching {len(q_by_title):,} lead images from "
              f"{wl}.wikipedia (pageimages API)...", file=sys.stderr)
        found = wht.fetch_lead_images(list(q_by_title), wl)
        skipped = 0
        for title, img in found.items():
            if title in q_by_title:
                if wht.commons_file_title(img):      # Commons-hosted only;
                    wiki_images[q_by_title[title]] = img
                else:                                # drop local/fair-use files
                    skipped += 1
        print(f"  {len(wiki_images):,} lead images "
              f"({skipped} non-Commons skipped)", file=sys.stderr)

    # ---- license + author for each temple's best image ----------------------
    best_file: dict[str, str] = {}   # qid -> File: title
    for q, base in temples.items():
        img = wiki_images.get(q) or base["image_url"]
        if img:
            ft = wht.commons_file_title(img)
            if ft:
                best_file[q] = ft
    meta: dict[str, tuple[str, str]] = {}
    if best_file and not args.no_lead_images:
        uniq = sorted(set(best_file.values()))
        print(f"Fetching license info for {len(uniq):,} images "
              f"(Commons imageinfo API)...", file=sys.stderr)
        meta = wht.fetch_image_metadata(uniq)

    fields = (["qid", "state_name", "lat", "lon"]
              + [f"name_{l}" for l in args.langs]
              + attr_cols
              + ["wiki_image_url", "best_image_url",
                 "image_license", "image_author"]
              + [f"wikipedia_{wl}" for wl in args.wiki_langs]
              + ["asi_id"])
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
