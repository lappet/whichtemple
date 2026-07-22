// GET /api/leaderboard?limit=10 -> top-rated temples, globally, across every
// visitor's votes. Returns bare qids + ratings; the client already has
// temples.json loaded, so names/photos are joined in locally rather than
// duplicating temple metadata into Redis.
import { redis, RATINGS_KEY } from "./_lib/redis.js";

const MAX_LIMIT = 100;

// Named per-method export — see the comment in api/vote.ts for why.
export async function GET(request: Request): Promise<Response> {
  // request.url on this runtime is relative ("/api/leaderboard?limit=5"),
  // not absolute, so URL needs an explicit (otherwise-unused) base.
  const url = new URL(request.url, "http://localhost");
  const requested = Number(url.searchParams.get("limit") ?? 10);
  const limit = Math.min(
    MAX_LIMIT,
    Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 10
  );

  try {
    // withScores returns a flat, interleaved array: [member, score, member, score, ...].
    const flat = await redis.zrange<(string | number)[]>(
      RATINGS_KEY,
      0,
      limit - 1,
      { rev: true, withScores: true }
    );
    const total = await redis.zcard(RATINGS_KEY);

    const entries: { qid: string; rating: number; rank: number }[] = [];
    for (let i = 0; i < flat.length; i += 2) {
      entries.push({
        qid: String(flat[i]),
        rating: Math.round(Number(flat[i + 1])),
        rank: entries.length + 1,
      });
    }

    return new Response(JSON.stringify({ total, entries }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("leaderboard failed", err);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
