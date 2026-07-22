// Shared Redis client and key layout for the global temple rankings.
// Files under _lib/ are not deployed as routes (Vercel's underscore-prefix
// convention) — this module is imported by the actual /api/*.ts handlers.
import { Redis } from "@upstash/redis";

// Reads UPSTASH_REDIS_REST_URL/TOKEN (or the KV_REST_API_* aliases the
// Vercel Marketplace integration also sets) from the environment.
export const redis = Redis.fromEnv();

export const RATINGS_KEY = "temple:elo";
export const VOTES_KEY = "temple:votes";
export const DEFAULT_RATING = 1500;
export const K_FACTOR = 24;

const QID_RE = /^Q\d+$/;
export function isValidQid(v: unknown): v is string {
  return typeof v === "string" && QID_RE.test(v);
}

// Runs the whole read-compute-write as one atomic operation on the Redis
// server, so concurrent votes touching the same temple can't race each
// other (no client-side read-then-write gap). Also folds in a cheap,
// same-voter rate limit so a scripted client can't flood the leaderboard.
//
// KEYS[1] = ratings zset, KEYS[2] = votes hash, KEYS[3] = this voter's
// rate-limit counter. ARGV[1] = winner qid, ARGV[2] = loser qid,
// ARGV[3] = K factor, ARGV[4] = default rating, ARGV[5] = votes/minute cap.
const VOTE_SCRIPT = `
local winner = ARGV[1]
local loser = ARGV[2]
local K = tonumber(ARGV[3])
local default_rating = tonumber(ARGV[4])
local cap = tonumber(ARGV[5])

local count = redis.call('INCR', KEYS[3])
if count == 1 then
  redis.call('EXPIRE', KEYS[3], 60)
end
if count > cap then
  return {'RATE_LIMITED'}
end

local winner_rating = tonumber(redis.call('ZSCORE', KEYS[1], winner)) or default_rating
local loser_rating = tonumber(redis.call('ZSCORE', KEYS[1], loser)) or default_rating

local expected_winner = 1 / (1 + 10 ^ ((loser_rating - winner_rating) / 400))
local expected_loser = 1 - expected_winner

local new_winner_rating = winner_rating + K * (1 - expected_winner)
local new_loser_rating = loser_rating + K * (0 - expected_loser)

redis.call('ZADD', KEYS[1], new_winner_rating, winner, new_loser_rating, loser)
redis.call('HINCRBY', KEYS[2], winner, 1)
redis.call('HINCRBY', KEYS[2], loser, 1)

local winner_rank = redis.call('ZREVRANK', KEYS[1], winner)
local loser_rank = redis.call('ZREVRANK', KEYS[1], loser)
local total = redis.call('ZCARD', KEYS[1])

return {
  'OK',
  tostring(new_winner_rating), tostring(winner_rank),
  tostring(new_loser_rating), tostring(loser_rank),
  tostring(total),
}
`;

export type VoteResult =
  | { ok: true; total: number; winner: { rating: number; rank: number }; loser: { rating: number; rank: number } }
  | { ok: false; reason: "rate_limited" };

export async function applyVote(
  winnerQid: string,
  loserQid: string,
  voterId: string
): Promise<VoteResult> {
  const rateLimitKey = `ratelimit:vote:${voterId}`;
  const result = (await redis.eval(
    VOTE_SCRIPT,
    [RATINGS_KEY, VOTES_KEY, rateLimitKey],
    [winnerQid, loserQid, String(K_FACTOR), String(DEFAULT_RATING), "40"]
  )) as string[];

  if (result[0] === "RATE_LIMITED") {
    return { ok: false, reason: "rate_limited" };
  }
  const [, newWinnerRating, winnerRank, newLoserRating, loserRank, total] = result;
  return {
    ok: true,
    total: Number(total),
    // ZREVRANK is 0-indexed from the top; +1 for a human-readable "#1".
    winner: { rating: Number(newWinnerRating), rank: Number(winnerRank) + 1 },
    loser: { rating: Number(newLoserRating), rank: Number(loserRank) + 1 },
  };
}
