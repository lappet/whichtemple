// Personal, on-device Elo ratings for the Rate page. Nothing leaves
// the browser — there's no backend, so this reflects one person's taste,
// not a global ranking.
const STORAGE_KEY = "whichtemple:ratings:v1";
const RECENT_KEY = "whichtemple:favorites:recent:v1";
const DEFAULT_RATING = 1500;
const K = 24;
const MAX_RECENT = 50;

type Ratings = Record<string, { rating: number; votes: number }>;

function load(): Ratings {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function save(ratings: Ratings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ratings));
}

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

// Bumps a qid to the front of the recency log (most-recently-preferred
// first), deduping earlier appearances, capped so it can't grow forever.
function bumpRecent(qid: string) {
  const recent = [qid, ...loadRecent().filter((q) => q !== qid)];
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

export function getRating(qid: string): number {
  return load()[qid]?.rating ?? DEFAULT_RATING;
}

export function getVoteCount(): number {
  const ratings = load();
  // Every vote touches two temples, so half the sum of per-temple votes.
  let total = 0;
  for (const r of Object.values(ratings)) total += r.votes;
  return Math.round(total / 2);
}

export function recordVote(winnerQid: string, loserQid: string): void {
  const ratings = load();
  const winner = ratings[winnerQid] ?? { rating: DEFAULT_RATING, votes: 0 };
  const loser = ratings[loserQid] ?? { rating: DEFAULT_RATING, votes: 0 };

  const expectedWinner = 1 / (1 + 10 ** ((loser.rating - winner.rating) / 400));
  const expectedLoser = 1 - expectedWinner;

  ratings[winnerQid] = {
    rating: winner.rating + K * (1 - expectedWinner),
    votes: winner.votes + 1,
  };
  ratings[loserQid] = {
    rating: loser.rating + K * (0 - expectedLoser),
    votes: loser.votes + 1,
  };
  save(ratings);
  bumpRecent(winnerQid);
}

// Most recently preferred temples, newest first.
export function getFavorites(limit: number): string[] {
  return loadRecent().slice(0, limit);
}

export function resetRatings(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(RECENT_KEY);
}

// ——— global leaderboard sync ———
// Everything above is purely local. The functions below talk to /api/vote
// and /api/leaderboard (Redis-backed, see api/_lib/redis.ts) so ratings can
// also be aggregated across every visitor, not just this device.

const VOTER_ID_KEY = "whichtemple:voter-id";

// A random per-device id, used only so the backend can rate-limit a single
// device's votes — not a real identity, never sent anywhere else.
function getVoterId(): string {
  let id = localStorage.getItem(VOTER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VOTER_ID_KEY, id);
  }
  return id;
}

// Fire-and-forget: the local vote above already gave instant feedback, so a
// slow or failed sync here is silently swallowed rather than surfaced.
export function syncVote(winnerQid: string, loserQid: string): void {
  fetch("/api/vote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      winner: winnerQid,
      loser: loserQid,
      voterId: getVoterId(),
    }),
  }).catch(() => {});
}

export type LeaderboardEntry = { qid: string; rating: number; rank: number };

// Top-rated temples across every visitor's votes, not just this device.
export async function fetchLeaderboard(
  limit = 10
): Promise<{ entries: LeaderboardEntry[]; total: number }> {
  const res = await fetch(`/api/leaderboard?limit=${limit}`);
  if (!res.ok) throw new Error(`leaderboard fetch failed (${res.status})`);
  return res.json();
}
