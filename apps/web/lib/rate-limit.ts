import { Redis } from '@upstash/redis';
import { db } from '@/lib/db';
import { rateLimitCounters } from '@/drizzle/schema';
import { sql } from 'drizzle-orm';

// Initialize Redis client if Upstash credentials exist
const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp in seconds
}

// In-memory fallback map for offline unit testing and standalone dev
const testRateLimitMap = new Map<string, { count: number; resetAt: number }>();

/**
 * Checks and updates rate limit using Upstash Redis or DB-backed atomic counter.
 *
 * @param key - Identifier to rate limit (e.g. `ingest:device:<id>`, `pair:code:<hash>`)
 * @param limit - Maximum allowed requests in window
 * @param windowSeconds - Window size in seconds (default 60s)
 */
export async function checkRateLimit(
  key: string,
  limit: number = 30,
  windowSeconds: number = 60,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const reset = now + windowSeconds;

  // 1. If Redis is configured, use standard Redis atomic INCR + EXPIRE
  if (redis) {
    try {
      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, windowSeconds);
      }
      return {
        success: current <= limit,
        limit,
        remaining: Math.max(0, limit - current),
        reset,
      };
    } catch {
      // Fallback to DB if Redis call fails
    }
  }

  // 2. DB-backed counter (Amd-3 shared store fallback)
  const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL);
  if (hasDatabase) {
    try {
      const windowStart = new Date(now * 1000);

      const record = await db
        .insert(rateLimitCounters)
        .values({
          key,
          count: 1,
          windowStart,
          active: true,
        })
        .onConflictDoUpdate({
          target: rateLimitCounters.key,
          set: {
            count: sql`CASE 
              WHEN ${rateLimitCounters.windowStart} <= NOW() - (${windowSeconds} || ' seconds')::interval 
              THEN 1 
              ELSE ${rateLimitCounters.count} + 1 
            END`,
            windowStart: sql`CASE 
              WHEN ${rateLimitCounters.windowStart} <= NOW() - (${windowSeconds} || ' seconds')::interval 
              THEN NOW() 
              ELSE ${rateLimitCounters.windowStart} 
            END`,
          },
        })
        .returning();

      const currentCount = record[0]?.count ?? 1;

      return {
        success: currentCount <= limit,
        limit,
        remaining: Math.max(0, limit - currentCount),
        reset,
      };
    } catch {
      // Fallback to in-memory if DB call fails
    }
  }

  // 3. In-memory tracker for offline dev/test environments
  const existing = testRateLimitMap.get(key);
  if (!existing || now >= existing.resetAt) {
    testRateLimitMap.set(key, { count: 1, resetAt: reset });
    return {
      success: 1 <= limit,
      limit,
      remaining: Math.max(0, limit - 1),
      reset,
    };
  }

  existing.count += 1;
  return {
    success: existing.count <= limit,
    limit,
    remaining: Math.max(0, limit - existing.count),
    reset: existing.resetAt,
  };
}

/**
 * Shared Postgres-backed rate limiter instance.
 * Allows multiple distinct caller instances to operate on the same shared database table (or shared fallback).
 */
export class PostgresRateLimiter {
  constructor(private prefix: string = '') {}

  async check(key: string, limit: number = 30, windowSeconds: number = 60): Promise<RateLimitResult> {
    const fullKey = this.prefix ? `${this.prefix}:${key}` : key;
    return checkRateLimit(fullKey, limit, windowSeconds);
  }
}

