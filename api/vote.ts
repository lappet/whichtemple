// POST /api/vote  { winner: "Q123", loser: "Q456", voterId: "uuid" }
// Records a Hot-or-Not-style pairwise vote into the shared Elo leaderboard.
// This is a background sync — the browser's own local rating (src/ratings.ts)
// already updated instantly, so a slow or failed call here never blocks the UI.
import { applyVote, isValidQid } from "./_lib/redis.js";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const { winner, loser, voterId } = (body ?? {}) as Record<string, unknown>;
  if (
    !isValidQid(winner) ||
    !isValidQid(loser) ||
    winner === loser ||
    typeof voterId !== "string" ||
    voterId.length < 8 ||
    voterId.length > 100
  ) {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }

  try {
    const result = await applyVote(winner, loser, voterId);
    if (!result.ok) {
      return json({ ok: false, error: result.reason }, 429);
    }
    return json(result, 200);
  } catch (err) {
    console.error("vote failed", err);
    return json({ ok: false, error: "internal_error" }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
