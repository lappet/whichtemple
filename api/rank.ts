// GET /api/rank?qid=Q123 -> this temple's global rank and rating.
import { redis, RATINGS_KEY, VOTES_KEY, DEFAULT_RATING, isValidQid } from "./_lib/redis.js";

// Named per-method export — see the comment in api/vote.ts for why.
export async function GET(request: Request): Promise<Response> {
  // request.url on this runtime is relative, not absolute — see leaderboard.ts.
  const qid = new URL(request.url, "http://localhost").searchParams.get("qid");
  if (!isValidQid(qid)) {
    return new Response(JSON.stringify({ error: "invalid_qid" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const [score, rank, total, votes] = await Promise.all([
      redis.zscore(RATINGS_KEY, qid),
      redis.zrevrank(RATINGS_KEY, qid),
      redis.zcard(RATINGS_KEY),
      redis.hget<number>(VOTES_KEY, qid),
    ]);

    const body =
      score === null || rank === null
        ? { qid, rating: DEFAULT_RATING, rank: null, total, votes: 0 }
        : { qid, rating: Math.round(score), rank: rank + 1, total, votes: votes ?? 0 };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error("rank lookup failed", err);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
