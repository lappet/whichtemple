// One-time (and safely re-runnable) setup: seeds the global Elo leaderboard
// in Redis with every temple at the default rating, so /api/rank can return
// a real "#212 of 2,727" for a temple before it's ever been voted on.
//
// Uses ZADD NX ("only add new elements"), so re-running after new temples
// are added to temples.json will seed just the newcomers without touching
// anyone's accumulated rating.
//
// Needs UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN in the environment
// (`vercel env pull .env.local` after linking the project, then
// `node --env-file=.env.local scripts/seed-ratings.mjs`).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "@upstash/redis";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RATINGS_KEY = "temple:elo";
const DEFAULT_RATING = 1500;
const BATCH_SIZE = 500;

if (!process.env.UPSTASH_REDIS_REST_URL && !process.env.KV_REST_API_URL) {
  console.error(
    "Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.\n" +
      "Run `vercel env pull .env.local` after linking the project and " +
      "adding the Upstash integration, then re-run this with " +
      "`node --env-file=.env.local scripts/seed-ratings.mjs`."
  );
  process.exit(1);
}

const redis = Redis.fromEnv();

const temples = JSON.parse(
  fs.readFileSync(path.join(root, "public", "temples.json"), "utf8")
);
console.log(`Seeding ${temples.length.toLocaleString()} temples...`);

let added = 0;
for (let i = 0; i < temples.length; i += BATCH_SIZE) {
  const batch = temples.slice(i, i + BATCH_SIZE);
  const members = batch.map((t) => ({
    member: t.qid,
    // A tiny random nudge so never-voted temples don't all tie at exactly
    // 1500 and fall back to alphabetical ordering in ZREVRANK.
    score: DEFAULT_RATING + Math.random() * 0.01,
  }));
  const n = await redis.zadd(RATINGS_KEY, { nx: true }, ...members);
  added += n;
  console.log(`  ${Math.min(i + BATCH_SIZE, temples.length)}/${temples.length}`);
}

const total = await redis.zcard(RATINGS_KEY);
console.log(
  `Done. ${added.toLocaleString()} newly seeded, ${total.toLocaleString()} total in ${RATINGS_KEY}.`
);
