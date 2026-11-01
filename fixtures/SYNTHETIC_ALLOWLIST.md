# Documented Synthetic Identifier Specification

Synthetic numbers start with 5 so they do not match the [6-9]\d{9} pattern this repository's scanner forbids.

All test fixtures, mock data, and unit tests in WalletSync strictly use generated synthetic values from the reserved patterns below:

1. **Customer Phone Numbers**: `5xxxxxxxxx` (`5000000001` - `5000009999`). Pattern: `/^5\d{9}$/`
2. **Transaction IDs (SimpleWallet Trn No)**: `55xxxxxx` (`55000001` - `55999999`). Pattern: `/^55\d{6}$/`
3. **Order IDs & Receipt IDs (EG Payment)**: `555xxxxxxxxxxx` (`55500000000001` - `55500000009999`). Pattern: `/^555\d{11}$/`
4. **Operator References**: `OPRxxxxxxxxxx` (`OPR0000000001` - `OPR0000009999`). Pattern: `/^OPR\d{10}$/`
5. **Retailer Codes**: `SYNRETxxxx` (`SYNRET0001` - `SYNRET9999`). Pattern: `/^SYNRET\d{4}$/`
6. **Merchant / Retailer Names**: `Demo Merchant X`. Pattern: `/^Demo Merchant \d+$/`
7. **Synthetic Dates & Timestamps**: Base date `2025-01-01` (`01/01/2025` in fixtures, `2025-01-01T...` in ISO). Pattern: `/^01\/01\/2025/` or `/^2025-01-01/`. Any non-synthetic date fails the scan.
8. **Synthetic Amounts & Totals**: Generated from documented formulas in `packages/contract/src/synthetic-generator.ts`:
   - SimpleWallet Row `i` (1..5): Amount = `100.00 * i`, Discount (1.5%) = `1.50 * i`
   - SimpleWallet Grand Total = `1500.00` (Grand Discount = `22.50`, Balance = `500.00`)
   - EG Payment Row `i` (1..50): Amount = `100.00 + (i * 10.00)`, Commission (2%) = `(100.00 + i * 10.00) * 0.02`
   - EG Payment Page Total = `17750.00` (Total Commission = `355.00`)
   - Deliberate Mismatch Fixture: Grand Total = `50.00`
   - Empty Fixture: Grand Total = `0.00`

## Scanner Enforcement
The scanner strictly enforces that any customer phone number, transaction ID, order ID, operator reference, retailer code, merchant name, transaction amount, or date/timestamp found in `fixtures/` matches these synthetic generator patterns. Any detected value from real portals immediately fails CI.
Sensitive detected values are never printed to the logs.
