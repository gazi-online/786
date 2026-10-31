# Documented Synthetic Identifier Specification

Synthetic numbers start with 5 so they do not match the [6-9]\d{9} pattern this repository's scanner forbids.

All test fixtures, mock data, and unit tests in WalletSync strictly use generated synthetic values from the reserved patterns below:

1. **Customer Phone Numbers**: `5xxxxxxxxx` (`5000000001` - `5000009999`). Pattern: `/^5\d{9}$/`
2. **Transaction IDs (SimpleWallet Trn No)**: `55xxxxxx` (`55000001` - `55999999`). Pattern: `/^55\d{6}$/`
3. **Order IDs & Receipt IDs (EG Payment)**: `555xxxxxxxxxxx` (`55500000000001` - `55500000009999`). Pattern: `/^555\d{11}$/`
4. **Operator References**: `OPRxxxxxxxxxx` (`OPR0000000001` - `OPR0000009999`). Pattern: `/^OPR\d{10}$/`
5. **Retailer Codes**: `SYNRETxxxx` (`SYNRET0001` - `SYNRET9999`). Pattern: `/^SYNRET\d{4}$/`
6. **Merchant / Retailer Names**: `Demo Merchant X`. Pattern: `/^Demo Merchant \d+$/`

## Scanner Enforcement
The scanner strictly enforces that any phone number pattern, transaction number, operator reference, retailer code, or order ID found in `fixtures/` matches these synthetic generator patterns. Any detected value matching `[6-9]\d{9}` or other non-synthetic portal identifier formats immediately fails CI.
Sensitive detected values are never printed to the logs.
