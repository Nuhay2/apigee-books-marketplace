# Apigee Books Marketplace

A production-grade API platform built on **Apigee X**, exposing a clean OAuth2-secured façade over the public [OpenLibrary API](https://openlibrary.org/developers/api). Implements **JWT authentication with self-contained quota claims**, response transformation, distributed rate limiting, and end-to-end observability hooks.

Built as a structured, hands-on learning project to master Apigee X for API management and migration roles.

---

## Why this project

Most online tutorials show isolated Apigee features. This project applies **real-world API management patterns end-to-end**, with intentional architecture decisions and documented trade-offs — the kind of work a mid/senior API engineer would deliver.

What it demonstrates:

- Full OAuth2 + JWT implementation with custom claims (no third-party AS required)
- Pragmatic handling of Apigee's quirks (e.g. `AdditionalClaims` in `OAuthV2` vs `GenerateJWT`)
- Façade pattern with response reshaping via JavaScript policy
- Rate limiting strategy combining Spike Arrest (infra protection) and Quota (commercial limit)
- Observability designed to work even **without access to centralized logging**
- Versioned, structured repo following Apigee mono-repo conventions, ready for CI/CD

---

## Architecture

The platform consists of two cooperating Apigee proxies:

- `oauth-v1` — Authorization Server: validates client credentials and issues JWT access tokens
- `books-v1` — Resource Server: verifies JWT, enforces rate limits, transforms responses

```
Client (App)
    |
    |   (1) POST /v1/oauth/token
    |       Authorization: Basic base64(client_id:client_secret)
    |       grant_type=client_credentials
    v
+-------------------------------------------+
|   APIGEE X — oauth-v1                     |
|                                           |
|   - KVM-GetJWTSecret                      |
|   - OA-GenerateAccessToken                |
|     (validates credentials, opaque token) |
|   - JWT-GenerateAccessToken               |
|     (HS256 JWT with custom claims)        |
|   - AM-BuildTokenResponse                 |
|     (RFC-compliant JSON response)         |
+-------------------------------------------+
    |
    |   (2) returns { access_token: "eyJ...", token_type: "Bearer", expires_in: 3600 }
    v
Client
    |
    |   (3) GET /v1/books/search.json?q=tolkien
    |       Authorization: Bearer <JWT>
    v
+-------------------------------------------+
|   APIGEE X — books-v1                     |
|                                           |
|   PreFlow:                                |
|   - AM-AddCorrelationId                   |
|   - SA-AntiBurst   (10 req/s per IP)      |
|   - KVM-GetJWTSecret                      |
|   - AM-ExtractJWT                         |
|   - JWT-VerifyAccessToken (HS256)         |
|   - Q-PerAppLimit                         |
|     (limits read from JWT claims)         |
|                                           |
|   Conditional Flows:                      |
|   - SearchBooks  → JS-TransformResponse   |
|   - HealthCheck  → RF returns 200 OK      |
|                                           |
|   PostFlow:                               |
|   - AM-EchoCorrelationId                  |
|   - AM-AddRateLimitHeaders                |
|   - AM-AddDebugHeaders (opt-in)           |
+-------------------------------------------+
    |
    v
OpenLibrary public API
```

### Self-contained JWT design

Quota limits are embedded directly in the JWT as custom claims at generation time:

```json
{
  "sub": "<client_id>",
  "iss": "oauth-v1",
  "iat": 1717417200,
  "exp": 1717420800,
  "application_name": "LibraireMobileApp",
  "quota_limit": "100",
  "quota_interval": "1",
  "quota_timeunit": "minute",
  "tier": "standard"
}
```

The Resource Server (`books-v1`) reads these claims directly via `VerifyJWT`, with **zero backend lookup** during request validation. This is the canonical "self-contained token" pattern, traded against the standard JWT limitation (changes to quotas require token reissuance).

---

## Endpoints

### Token endpoint (`oauth-v1`)

| Method | Path              | Description                                        | Auth                    |
| ------ | ----------------- | -------------------------------------------------- | ----------------------- |
| POST   | `/v1/oauth/token` | Issues a JWT access token via `client_credentials` | HTTP Basic (key:secret) |

### Resource endpoints (`books-v1`)

| Method | Path                          | Description                 | Auth       |
| ------ | ----------------------------- | --------------------------- | ---------- |
| GET    | `/v1/books/search.json?q=...` | Search books by keyword     | Bearer JWT |
| GET    | `/v1/books/works/{id}.json`   | Get book details by work ID | Bearer JWT |
| GET    | `/v1/books/health`            | Healthcheck (no backend)    | None       |

---

## Quick start

### Prerequisites

- Apigee X organization (evaluation or sandbox)
- An encrypted KVM named `oauth-secrets` in your environment, with key `jwt_signing_secret`
- An Apigee Developer, App (with consumer key/secret), and API Product

### Deploy

Manual deployment via Apigee console: upload `proxies/oauth-v1/apiproxy/` and `proxies/books-v1/apiproxy/` as proxy bundles, then deploy to your target environment.

A CI/CD pipeline template is provided in `.github/workflows/` using `apigeecli` and a Google Cloud service account.

### Test

A complete Postman collection is available in `tests/postman/`. Import it, set your `apiKey` and `apiSecret` environment variables, and run:

1. **Get OAuth Token** → stores the JWT in `{{accessToken}}`
2. **Search books** → uses `{{accessToken}}` as Bearer

The collection also includes runner-friendly tests for rate limiting validation.

---

## Key design decisions

### 1. Decoupled JWT generation

`OAuthV2 GenerateJWTAccessToken` does not reliably propagate `AdditionalClaims` across all Apigee X versions. To regain full control over the JWT contents, the design uses:

1. `OAuthV2 GenerateAccessToken` — validates credentials, enriches context
2. `GenerateJWT` — crafts the JWT with custom claims (works reliably)
3. `AssignMessage` — builds the OAuth2-compliant JSON response

This pattern follows the **single-responsibility principle** and provides explicit control over every claim.

### 2. Rate limiting strategy

Two policies layered in canonical order:

- **Spike Arrest** (`10ps` per IP) — runs before authentication. Rejects bursts cheaply, before any expensive validation work.
- **Quota** (`100 req/min` per client) — runs after JWT verification. Reads its limit from the JWT claims, identifies the bucket by `sub`.

> **Trade-off**: Quota values are baked into the JWT at issuance. Updating a client's tier requires reissuing their token. Mitigated by short token TTLs (1h).

### 3. Façade pattern via JavaScript policy

OpenLibrary returns a 40+ field document per book with inconsistent naming and mixed scalars/arrays. A JavaScript policy reshapes responses into a 6-field, camelCase, paginated format:

```json
{
  "total": 2348,
  "page": 1,
  "limit": 10,
  "items": [
    {
      "id": "OL27448W",
      "title": "The Lord of the Rings",
      "author": "J.R.R. Tolkien",
      "firstPublished": 1954,
      "coverUrl": "https://covers.openlibrary.org/b/id/14625765-M.jpg",
      "rating": 4.27
    }
  ]
}
```

Consumers are decoupled from OpenLibrary's structure; backend changes can be absorbed in the policy without breaking clients.

### 4. Observability without centralized logging

Designed to provide diagnostic visibility even when Cloud Logging access is restricted:

- **Correlation ID** generated in PreFlow, propagated to backend and echoed back to client
- **Opt-in debug headers** (`X-Debug-*`) controlled by a request header (`X-Debug-Enabled: true`)
- **`X-RateLimit-*` headers** on every response (limit, remaining, reset)
- **MessageLogging policy** ready (currently `enabled="false"`) — can be turned on as soon as logging permissions are granted

---

## Policy naming conventions

| Prefix | Policy type             | Example                     |
| ------ | ----------------------- | --------------------------- |
| `AM-`  | AssignMessage           | `AM-AddCorrelationId`       |
| `RF-`  | RaiseFault              | `RF-HealthCheckOk`          |
| `Q-`   | Quota                   | `Q-PerAppLimit`             |
| `SA-`  | SpikeArrest             | `SA-AntiBurst`              |
| `OA-`  | OAuthV2                 | `OA-GenerateAccessToken`    |
| `JWT-` | VerifyJWT / GenerateJWT | `JWT-VerifyAccessToken`     |
| `JS-`  | JavaScript              | `JS-TransformBooksResponse` |
| `KVM-` | KeyValueMapOperations   | `KVM-GetJWTSecret`          |
| `ML-`  | MessageLogging          | `ML-LogTransaction`         |

---

## Repository structure

```
.
├── proxies/
│   ├── oauth-v1/apiproxy/           # OAuth2 Authorization Server proxy bundle
│   └── books-v1/apiproxy/           # Resource Server proxy bundle
├── config/
│   ├── api-products/                # API Product definitions (JSON)
│   └── apps/                        # App definitions (JSON)
├── tests/
│   └── postman/                     # Postman collection for end-to-end tests
├── docs/
│   ├── architecture.md              # Architecture decisions and trade-offs
│   └── policy-variants.md           # Quota policy variants per auth method
└── .github/
    └── workflows/                   # CI/CD pipeline template (apigeecli)
```

---

## Known limitations

This is a learning project; certain production concerns are intentionally out of scope or marked as future work:

- **JWT revocation**: No blacklist mechanism implemented. Token compromise mitigation relies on short TTLs.
- **HS256 vs RS256**: Symmetric signing chosen for simplicity. For multi-service production architectures, RS256 with key rotation would be preferred.
- **MessageLogging**: Policy is present but disabled due to environment-level logging restrictions.
- **Refresh tokens**: Not applicable to `client_credentials` flow.
- **Scope-based authorization**: Not yet implemented; all authenticated clients have identical permissions.

---

## Migration notes (Apigee → other gateways)

The architectural patterns used here are portable, but the policies are not. Approximate mappings for migration planning:

| Apigee X policy                     | Kong equivalent                                        | Azure APIM equivalent            |
| ----------------------------------- | ------------------------------------------------------ | -------------------------------- |
| `OAuthV2 GenerateAccessToken`       | External AS (Keycloak/Auth0) — not in OSS Kong         | Azure AD or built-in OAuth flow  |
| `VerifyJWT`                         | Plugin `jwt`                                           | Policy `validate-jwt`            |
| `VerifyAPIKey`                      | Plugin `key-auth`                                      | Subscription key validation      |
| `Quota`                             | Plugin `rate-limiting`                                 | Policy `rate-limit-by-key`       |
| `SpikeArrest`                       | Plugin `rate-limiting-advanced`                        | Policy `rate-limit`              |
| `AssignMessage` (headers/body)      | Plugins `request-transformer` / `response-transformer` | `<set-header>`, `<set-body>`     |
| `JavaScript` policy                 | Plugin `serverless` (Lua via OpenResty)                | `<set-body>` with C# expression  |
| `KeyValueMapOperations` (Encrypted) | Plugin `vault`                                         | Named values backed by Key Vault |

Key challenge in any migration: **Apigee's hierarchical model (Developer / App / Product / Proxy) and its automatic context enrichment after `VerifyAPIKey` or `VerifyAccessToken`** has no direct equivalent in most gateways. Quota configuration, in particular, must be re-thought when migrating.

---

## Built with

- Apigee X (proxy runtime and Authorization Server)
- OpenLibrary API (public backend)
- Postman (test client and integration tests)
- VS Code + Git (local development)
- GitHub Actions (CI/CD template)

---
