# simplewallet.in Fixtures

This folder holds HTML samples used by the parser tests.

| File | Status | Notes |
|---|---|---|
| `normal-day.html` | **PLACEHOLDER** | Owner will replace with a real, sanitized HTML page. Commit only after removing all real mobile numbers and transaction IDs, or replacing them with synthetic data. |
| `empty-table.html` | **SYNTHETIC** | Fake data only. Replace when owner supplies the real zero-transaction page layout. |
| `logged-out.html` | **SYNTHETIC** | Fake data only. |
| `layout-changed.html` | **SYNTHETIC** | Fake data only — column headers intentionally wrong. |
| `totals-mismatch.html` | **SYNTHETIC** | Fake data only — Grand Total deliberately wrong. |

## Rules
- **Never commit real mobile numbers, transaction IDs, or session tokens.**
- All synthetic files use the fake mobile number `9990000001` (clearly not a real customer).
- When replacing a placeholder with a real fixture, run a search for 10-digit numbers and replace every mobile number with `98XXXXXXXX` before committing.

