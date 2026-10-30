# Documented Allowlist of Synthetic Test Numbers & Fixture Identifiers

This document defines the strict, approved allowlist of synthetic and mock numbers used in WalletSync acceptance test fixtures and unit tests.

## 1. Unit Test Mock Numbers
- `9876543210`, `8123456789`, `9800000000`, `9800000001` — Used in crypto and log redaction test assertions.

## 2. Test Fixture Numbers
Stored in [`fixtures/synthetic-allowlist.json`](./synthetic-allowlist.json):
- Contains 148 test identifiers extracted from sanitized HTML fixtures:
  - `fixtures/simplewallet/normal-day.html`
  - `fixtures/egpayment/normal-day.html`

## 3. Scanner Enforcement Rules
Any 10-digit number (`[6-9]\d{9}`) found outside this documented allowlist in source code, build output, or git commits is treated as un-sanitized PII and triggers a CI failure.
The scanner never prints detected sensitive values into CI or console outputs.
