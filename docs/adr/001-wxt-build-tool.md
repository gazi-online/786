# ADR-001: Use WXT as the extension build tool

**Date:** 2026-10-29  
**Status:** Accepted

## Context

GUIDE.md §4 specifies `WXT (or Vite with CRXJS)` as the extension build tool for the Manifest V3 extension.

## Decision

Use WXT.

## Reasons

- WXT is the first option listed in the spec.
- It has first-class Manifest V3 support and a built-in service-worker lifecycle that works correctly with `chrome.alarms`.
- It supports HMR for the popup during development without manual reload steps.
- It is actively maintained as of October 2026.

## Consequences

- The extension entry points live in `apps/extension/entrypoints/`.
- WXT generates the final `manifest.json` from `wxt.config.ts`; hand-editing the manifest is not needed.
- If WXT becomes unmaintained, migration to plain Vite + CRXJS is the documented fallback.

