import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { randomIndex, type Temple } from "./temples";
import {
  fetchLeaderboard,
  getFavorites,
  getVoteCount,
  recordVote,
  syncVote,
  type LeaderboardEntry,
} from "./ratings";

type Pair = [number, number];
type View = "pairs" | "favorites" | "leaderboard";

function preload(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

export default function RatePage({ temples }: { temples: Temple[] }) {
  const [pair, setPair] = useState<Pair | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [wonQid, setWonQid] = useState<string | null>(null);
  const [voteCount, setVoteCount] = useState(0);
  const [view, setView] = useState<View>("pairs");
  const [leaderboard, setLeaderboard] = useState<{
    entries: LeaderboardEntry[];
    total: number;
  } | null>(null);
  const [leaderboardFailed, setLeaderboardFailed] = useState(false);
  const skipsRef = useRef(0);

  const qidMap = useMemo(
    () => new Map(temples.map((t) => [t.qid, t])),
    [temples]
  );

  const pickPair = useCallback((): Pair => {
    const a = randomIndex(temples.length);
    const b = randomIndex(temples.length, a);
    return [a, b];
  }, [temples]);

  useEffect(() => {
    if (temples.length < 2) return;
    setPair(pickPair());
    setVoteCount(getVoteCount());
  }, [temples, pickPair]);

  // Global leaderboard is shared across every visitor, so fetch it lazily
  // the first time someone opens that view rather than on every page load.
  useEffect(() => {
    if (view !== "leaderboard" || leaderboard || leaderboardFailed) return;
    fetchLeaderboard(10)
      .then(setLeaderboard)
      .catch(() => setLeaderboardFailed(true));
  }, [view, leaderboard, leaderboardFailed]);

  const advance = useCallback(
    (next: Pair) => {
      Promise.all([
        preload(temples[next[0]].image),
        preload(temples[next[1]].image),
      ]).then(() => {
        setPair(next);
        setWonQid(null);
        setTransitioning(false);
      });
    },
    [temples]
  );

  const vote = (side: 0 | 1) => {
    if (!pair || transitioning) return;
    const winner = temples[pair[side]];
    const loser = temples[pair[1 - side]];
    recordVote(winner.qid, loser.qid);
    syncVote(winner.qid, loser.qid); // background sync to the shared leaderboard
    setVoteCount(getVoteCount());
    setWonQid(winner.qid);
    setTransitioning(true);
    setTimeout(() => advance(pickPair()), 420);
  };

  // A broken photo in the pair shouldn't block voting — swap it out quietly.
  const handleBroken = () => {
    if (transitioning) return;
    if (skipsRef.current++ < 6) {
      setTransitioning(true);
      advance(pickPair());
    }
  };

  if (!pair) return null;
  const [a, b] = pair;
  const left = temples[a];
  const right = temples[b];

  const favorites =
    view === "favorites"
      ? getFavorites(10)
          .map((q) => qidMap.get(q))
          .filter((t): t is Temple => !!t)
      : [];

  return (
    <div className="rate-page">
      <header className="masthead">
        <a className="masthead-mark" href="/">
          Which Temple?
        </a>
        <div className="masthead-side">
          <span className="masthead-note">
            {voteCount > 0
              ? `${voteCount.toLocaleString("en-IN")} vote${voteCount === 1 ? "" : "s"} cast`
              : "Tap the one you like more"}
          </span>
          {view === "pairs" ? (
            <>
              {voteCount >= 3 && (
                <button
                  className="masthead-map"
                  onClick={() => setView("favorites")}
                >
                  My favorites
                </button>
              )}
              <button
                className="masthead-map"
                onClick={() => setView("leaderboard")}
              >
                Rankings
              </button>
            </>
          ) : (
            <button className="masthead-map" onClick={() => setView("pairs")}>
              ← Rate
            </button>
          )}
          <a className="masthead-map" href="/map">
            Map
          </a>
        </div>
      </header>

      {view === "favorites" && (
        <div className="rate-favorites">
          <h1 className="rate-heading">Your favorites</h1>
          {favorites.length === 0 ? (
            <p className="rate-empty">
              Vote on a few pairs and your top temples will collect here.
            </p>
          ) : (
            <ol className="favorites-list">
              {favorites.map((t) => (
                <li key={t.qid}>
                  <a href={`/${t.qid}`} className="favorites-item">
                    <img src={t.image} alt="" loading="lazy" />
                    <span className="favorites-name">{t.name}</span>
                  </a>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {view === "leaderboard" && (
        <div className="rate-favorites">
          <h1 className="rate-heading">Top rated, by everyone</h1>
          {leaderboardFailed ? (
            <p className="rate-empty">
              The global leaderboard isn’t available right now.
            </p>
          ) : !leaderboard ? (
            <p className="rate-empty">Loading…</p>
          ) : leaderboard.entries.length === 0 ? (
            <p className="rate-empty">No votes yet — be the first.</p>
          ) : (
            <>
              <ol className="favorites-list">
                {leaderboard.entries.map((e) => {
                  const t = qidMap.get(e.qid);
                  if (!t) return null;
                  return (
                    <li key={e.qid}>
                      <a href={`/${t.qid}`} className="favorites-item">
                        <span className="favorites-rank">#{e.rank}</span>
                        <img src={t.image} alt="" loading="lazy" />
                        <span className="favorites-name">
                          {t.name}
                          <em>{e.rating}</em>
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ol>
              <p className="rate-empty">
                Ranked out of {leaderboard.total.toLocaleString("en-IN")}{" "}
                temples voted on so far.
              </p>
            </>
          )}
        </div>
      )}

      {view === "pairs" && (
        <>
          <h1 className="rate-heading">Which do you like more?</h1>
          <div className="rate-pair" key={`${left.qid}-${right.qid}`}>
            {[left, right].map((t, i) => (
              <button
                key={t.qid}
                className={
                  "rate-card" +
                  (wonQid === t.qid ? " rate-card--won" : "") +
                  (wonQid && wonQid !== t.qid ? " rate-card--lost" : "")
                }
                onClick={() => vote(i as 0 | 1)}
                disabled={transitioning}
                aria-label={`Prefer ${t.name}`}
              >
                <img
                  className="rate-photo"
                  src={t.image}
                  alt={t.name}
                  onError={handleBroken}
                />
                <span className="rate-name">{t.name}</span>
              </button>
            ))}
            <span className="rate-or">or</span>
          </div>
        </>
      )}

      <footer className="colophon">
        Your picks are stored on this device and also added to a shared
        leaderboard, using the Elo system. Data and photos from{" "}
        <a href="https://commons.wikimedia.org" target="_blank" rel="noreferrer">
          Wikimedia
        </a>
        .
      </footer>
    </div>
  );
}
