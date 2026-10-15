import { redis } from "../cache/redis.js";

// Fixed-window rate limiter for sensitive endpoints (payment submission,
// staff decisions, receipt downloads). Counts in Redis when it's connected,
// so the limit holds across several server instances; falls back to an
// in-process counter when Redis is down (fail-open on *infrastructure*, but
// still limited per instance). No new dependency or paid service.
//
//   router.post("/", requireRole("passenger"), rateLimit({ name: "pay-submit", max: 5, windowSeconds: 600 }), handler)
//
// The key is the logged-in user (role + id) when there is one, else the IP.
const memory = new Map(); // key -> { count, resetAt }

function memoryHit(key, windowSeconds) {
  const now = Date.now();
  let entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowSeconds * 1000 };
    memory.set(key, entry);
  }
  entry.count += 1;
  if (memory.size > 10000) {
    for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
  }
  return { count: entry.count, ttl: Math.ceil((entry.resetAt - now) / 1000) };
}

async function redisHit(key, windowSeconds) {
  const results = await redis.multi().incr(key).expire(key, windowSeconds, "NX").ttl(key).exec();
  const count = Number(results[0][1]);
  const ttl = Number(results[2][1]);
  return { count, ttl: ttl > 0 ? ttl : windowSeconds };
}

// key(req) optionally overrides "who" (e.g. the email being logged into,
// so guessing one account's password from many IPs is still limited).
// RATE_LIMIT_DISABLED is ignored on a deployed server.
export function rateLimit({ name, max, windowSeconds, key: keyFn, message }) {
  const deployed = process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT);
  if (process.env.RATE_LIMIT_DISABLED === "1" && !deployed) return (req, res, next) => next();
  return async (req, res, next) => {
    const custom = keyFn?.(req);
    if (keyFn && !custom) return next();
    const who = custom ?? (req.user ? `${req.user.role}:${req.user.id}` : `ip:${req.ip}`);
    const key = `ratelimit:${name}:${who}`;
    let hit;
    try {
      hit = redis.status === "ready" ? await redisHit(key, windowSeconds) : memoryHit(key, windowSeconds);
    } catch {
      hit = memoryHit(key, windowSeconds);
    }
    if (hit.count > max) {
      res.set("Retry-After", String(hit.ttl));
      return res.status(429).json({ error: message ?? `Too many attempts. Please wait ${Math.ceil(hit.ttl / 60)} minute(s) and try again.` });
    }
    next();
  };
}

// Counts only FAILURES (e.g. wrong passwords) and clears on success, so a
// person logging in normally is never locked out, while guessing is capped.
//   const guard = failureLimiter({ name: "login", max: 10, windowSeconds: 900 });
//   if (await guard.blocked(key)) -> 429;  on failure: guard.fail(key);  on success: guard.reset(key)
export function failureLimiter({ name, max, windowSeconds }) {
  const full = (key) => `ratelimit:${name}:${key}`;
  async function count(key) {
    try {
      if (redis.status === "ready") return Number((await redis.get(full(key))) ?? 0);
    } catch {
      /* fall through to memory */
    }
    const e = memory.get(full(key));
    return e && e.resetAt > Date.now() ? e.count : 0;
  }
  return {
    async blocked(key) {
      return (await count(key)) >= max;
    },
    async fail(key) {
      try {
        if (redis.status === "ready") return void (await redisHit(full(key), windowSeconds));
      } catch {
        /* fall through */
      }
      memoryHit(full(key), windowSeconds);
    },
    async reset(key) {
      memory.delete(full(key));
      try {
        if (redis.status === "ready") await redis.del(full(key));
      } catch {
        /* ignore */
      }
    },
  };
}
