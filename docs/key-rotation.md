# Cryptographic Key ID Architecture & Rotation Plan

**Scope:** Customer Phone Number PII Encryption (`AES-256-GCM`) & Blind Index Exact Lookup (`HMAC-SHA256`).

---

## 1. Key Registry & Separation of Concerns

WalletSync enforces strict physical and logical separation between encryption keys and search blind index keys.

| Purpose | Environment Variable | Key ID Variable | Default Key ID | Algorithm |
| :--- | :--- | :--- | :--- | :--- |
| **Field Encryption** | `CUSTOMER_NO_ENCRYPTION_KEY` | `CUSTOMER_NO_KEY_ID` | `v1` | AES-256-GCM (96-bit random IV, tenant AAD) |
| **Blind Index (Search)** | `CUSTOMER_SEARCH_HMAC_KEY` | `CUSTOMER_SEARCH_HMAC_KEY_ID` | `h1` | HMAC-SHA256 |

### Non-Negotiable Invariants:
1. `CUSTOMER_NO_ENCRYPTION_KEY` and `CUSTOMER_SEARCH_HMAC_KEY` must **never** be identical. The server checks this at boot and throws a fatal error if violated.
2. In production (`NODE_ENV === 'production'`), both keys are mandatory; default dev fallbacks are strictly prohibited.
3. Every encrypted ciphertext includes the Key ID as its prefix: `keyId:iv:tag:ciphertext`.

---

## 2. Key Rotation Procedure

### Phase A: Rotating the Encryption Key (`CUSTOMER_NO_ENCRYPTION_KEY`)
1. **Provision New Key:**
   - Generate a new 256-bit random key.
   - Set `CUSTOMER_NO_KEY_ID=v2`.
   - Keep `CUSTOMER_NO_KEY_ID_PREVIOUS=v1` and the old key in the key registry (`ENCRYPTION_KEYS`).
2. **Dual-Read Mode:**
   - All **new writes** are encrypted with `v2`.
   - Existing records prefixed with `v1:` are seamlessly decrypted using the registered `v1` key.
3. **Background Re-encryption Migration:**
   - Run the background migration script:
     ```bash
     pnpm --filter @walletsync/web run db:reencrypt --from=v1 --to=v2
     ```
   - Scans records where `customer_no LIKE 'v1:%'`, decrypts using `v1`, re-encrypts using `v2`, and writes back atomically under transaction.
4. **Retire Old Key:**
   - Once 0 records remain with `v1:`, remove the old key from the environment.

---

## 3. Rotating the Search Blind Index Key (`CUSTOMER_SEARCH_HMAC_KEY`)

Because HMAC hashes are deterministic and one-way:
1. **Provision New HMAC Key:**
   - Set `CUSTOMER_SEARCH_HMAC_KEY_ID=h2` and set the new key in `CUSTOMER_SEARCH_HMAC_KEY`.
   - Register old key under `h1`.
2. **Dual-Query Search Strategy:**
   - When searching by customer phone number during transition, compute hashes under both `h1` and `h2`:
     ```sql
     SELECT * FROM transactions 
     WHERE customer_no_hash IN (hmac_h2, hmac_h1)
     ```
3. **Background Hash Recomputation:**
   - Iterate through active tenant transactions:
     - Decrypt `customer_no` using current encryption key.
     - Compute new HMAC under `h2`.
     - Update `customer_no_hash = hmac_h2`.
4. **Finalize:**
   - Decommission `h1` once all records reflect `h2` hashes.

