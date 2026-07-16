import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatFounded,
  loadTemples,
  randomIndex,
  type Temple,
} from "./temples";

type Status = "loading" | "ready" | "error";

// Each temple is addressable at /<qid>, e.g. /Q3523924.
const qidFromUrl = () => location.pathname.match(/^\/(Q\d+)$/)?.[1];

export default function App() {
  const [temples, setTemples] = useState<Temple[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [index, setIndex] = useState(0);
  const [changing, setChanging] = useState(false);
  const skipsRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    loadTemples()
      .then((data) => {
        if (cancelled) return;
        setTemples(data);
        const fromUrl = data.findIndex((t) => t.qid === qidFromUrl());
        const start = fromUrl >= 0 ? fromUrl : randomIndex(data.length);
        setIndex(start);
        history.replaceState(null, "", `/${data[start].qid}`);
        setStatus("ready");
      })
      .catch(() => !cancelled && setStatus("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  const showAnother = useCallback(() => {
    if (temples.length < 2 || changing) return;
    setChanging(true);
    const next = randomIndex(temples.length, index);
    // Preload the next photo so the swap lands fully formed.
    const img = new Image();
    const swap = () => {
      setIndex(next);
      setChanging(false);
      history.pushState(null, "", `/${temples[next].qid}`);
    };
    img.onload = swap;
    img.onerror = swap;
    img.src = temples[next].image;
  }, [temples, index, changing]);

  // Back/forward navigate through previously seen temples.
  useEffect(() => {
    const onPop = () => {
      const i = temples.findIndex((t) => t.qid === qidFromUrl());
      if (i >= 0) setIndex(i);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [temples]);

  useEffect(() => {
    const current = temples[index];
    if (status === "ready" && current) {
      document.title = `${current.name} — Which Temple?`;
    }
  }, [status, temples, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " && e.key !== "ArrowRight") return;
      if (e.target instanceof HTMLElement && e.target.closest("a, button"))
        return;
      e.preventDefault();
      showAnother();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showAnother]);

  // A few Commons URLs rot; quietly move on rather than show a broken frame.
  const handleBrokenImage = () => {
    if (skipsRef.current++ < 5) showAnother();
  };

  if (status === "loading") {
    return (
      <div className="veil">
        <p className="veil-text">Opening the doors…</p>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="veil">
        <p className="veil-text">
          The temple data didn’t load. Refresh the page to try again.
        </p>
      </div>
    );
  }

  const t = temples[index];
  const founded = formatFounded(t.inception);
  const subline = [t.state, founded && `founded ${founded}`]
    .filter(Boolean)
    .join("  ·  ");
  const facts: [string, string][] = [];
  if (t.deity) facts.push(["Deity", t.deity]);
  if (t.style) facts.push(["Architecture", t.style]);
  if (t.heritage) facts.push(["Heritage", t.heritage]);
  if (t.commissionedBy) facts.push(["Commissioned by", t.commissionedBy]);
  if (t.foundedBy) facts.push(["Founded by", t.foundedBy]);

  return (
    <div className="page">
      <header className="masthead">
        <span className="masthead-mark">Which Temple?</span>
        <span className="masthead-note">
          {temples.length.toLocaleString("en-IN")} photographed temples of
          India
        </span>
      </header>

      <main className="darshan" key={t.qid}>
        <figure className="arch">
          <img
            className="arch-photo"
            src={t.image}
            alt={`Photograph of ${t.name}`}
            onError={handleBrokenImage}
          />
        </figure>

        <h1 className="temple-name">{t.name}</h1>
        {subline && <p className="temple-subline">{subline}</p>}

        {facts.length > 0 && (
          <dl className="plaque">
            {facts.map(([label, value]) => (
              <div className="plaque-item" key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}

        <p className="links">
          {t.wikipedia && (
            <a href={t.wikipedia} target="_blank" rel="noreferrer">
              Read on Wikipedia
            </a>
          )}
          {t.lat != null && t.lon != null && (
            <a
              href={`https://www.google.com/maps?q=${t.lat},${t.lon}`}
              target="_blank"
              rel="noreferrer"
            >
              View on map
            </a>
          )}
        </p>

        <button
          className="another"
          onClick={showAnother}
          disabled={changing}
          aria-label="Show another temple"
        >
          {changing ? "Opening…" : "Another temple"}
        </button>
      </main>

      <footer className="colophon">
        {t.imageAuthor && <span>Photo: {t.imageAuthor}. </span>}
        {t.imageLicense && <span>{t.imageLicense}. </span>}
        <span>
          Data and photos from{" "}
          <a
            href="https://commons.wikimedia.org"
            target="_blank"
            rel="noreferrer"
          >
            Wikimedia
          </a>
          . Press space for the next temple.
        </span>
      </footer>
    </div>
  );
}
