# ADR-002: Use Drizzle ORM

**Date:** 2026-10-29  
**Status:** Accepted (matches GUIDE.md spec — no deviation)

## Context

GUIDE.md §5 specifies Drizzle ORM for the database layer.

## Decision

Use Drizzle ORM with the Supabase Postgres connection.

## Reasons

- Specified in GUIDE.md.
- SQL-first approach makes explicit RLS-aware queries straightforward.
- Type inference from the schema removes the need for a separate type-generation step.

## Consequences

- Migrations live in `apps/web/drizzle/`.
- The Drizzle client is instantiated with the runtime database role (not the service role), which must not have `BYPASSRLS` (see Amd-1).

