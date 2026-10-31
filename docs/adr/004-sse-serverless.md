# ADR-004: SSE on serverless — reconnect handling and polling fallback

**Date:** 2026-10-29  
**Status:** Accepted

## Context

The web app uses Server-Sent Events (SSE) for live transaction updates (`GET /api/v1/stream`). The app is hosted on Vercel, which runs serverless functions with a maximum execution duration (25 s on Hobby, 300 s on Pro). A long-lived SSE response may be terminated by this limit or by edge-network proxies.

## Options Considered

1. **SSE + automatic client reconnect only** — `EventSource` reconnects via `Last-Event-ID`. Works if duration limits are not hit in practice. No extra complexity.
2. **SSE + polling fallback** — On disconnect or timeout, the client falls back to polling `GET /api/v1/transactions?since=<cursor>` every 10 seconds. Degrades gracefully on all Vercel plans.
3. **Supabase Realtime** — Postgres change-data-capture WebSocket channel. No Vercel duration limit. Adds a dependency on Supabase Realtime being enabled and configured.

## Decision

Implement **option 2** for M4: SSE with automatic reconnect via `Last-Event-ID` plus a client-side polling fallback that activates when `EventSource` fails to reconnect within 15 seconds.

Document Supabase Realtime as the upgrade path if duration limits become a production problem.

## Consequences

- `GET /api/v1/stream` must emit a heartbeat comment (`: heartbeat`) every 20 seconds to prevent proxy timeouts.
- The web app SSE client wrapper detects `EventSource.onerror` and starts polling after 15 s without reconnection.
- Polling uses cursor pagination (`since` param = ISO timestamp of the last received event).
- If the owner upgrades to Supabase Realtime later, replace the SSE endpoint and the client wrapper; no schema changes are needed.

