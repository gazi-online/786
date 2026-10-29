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

/**
 * Checks and updates rate limit using Upstash Redis or DB-backed atomic counter.
 *
 * @param key - Identifier to rate limit (e.g. `ingest:device:<id>`)
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
    // If DB check fails, default to allow in dev/test, or fail safe
    return {
      success: true,
      limit,
      remaining: limit - 1,
      reset,
    };
  }
}
