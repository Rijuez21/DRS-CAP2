import Redis from "ioredis";
import "dotenv/config";

// Per the document's Table 10 ("Redis... used as an in-memory cache for
// frequently accessed data such as active trips and bus locations"),
// Redis sits in front of MySQL for two specific hot paths: the active
// trip list (trips.js) and the latest known position per bus (tracking.js).
//
// Railway's Redis add-on exposes REDIS_URL the same way MySQL exposes
// MYSQL_URL — add a Redis service to the same Railway project and this
// picks it up automatically once deployed there.
export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 2,
  lazyConnect: false,
});

redis.on("error", (err) => {
  // Redis is a performance layer, not a source of truth — log and let
  // callers fall back to MySQL rather than crashing the process.
  console.error("Redis connection error (falling back to MySQL only):", err.message);
});

export const CACHE_TTL_SECONDS = {
  activeTrips: 15, // short TTL: trip status/seat counts change frequently
  busLocation: 30, // a stale-by-30s dot on the map is an acceptable trade-off
  fleetLocations: 15, // whole-fleet admin panel — shorter TTL than a single bus since dispatchers watch it live
  dashboardSummary: 20, // admin dashboard metric cards — short enough to feel live, long enough to spare MySQL on every page load
};
