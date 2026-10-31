# ADR-003: Use Supabase Auth with SSR client

**Date:** 2026-10-29  
**Status:** Accepted (matches GUIDE.md spec — no deviation)

## Context

GUIDE.md §5 specifies Supabase Auth for user authentication.

## Decision

Use Supabase Auth via the `@supabase/ssr` package for Next.js App Router. Sessions are stored in httpOnly, SameSite=Lax cookies managed by the SSR client middleware.

## Reasons

- Specified in GUIDE.md.
- `@supabase/ssr` handles cookie refresh transparently in middleware without exposing the session to client-side JavaScript.

## Consequences

- `apps/web/middleware.ts` runs the Supabase session refresh on every request.
- Device-token routes (`/ingest`, `/devices/pair`) do not use Supabase Auth JWT; they authenticate via the hashed device token and set `app.current_tenant_id` explicitly (Amd-1).

