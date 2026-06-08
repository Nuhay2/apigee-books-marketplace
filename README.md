# Apigee Books Marketplace

A production-grade API proxy built on **Apigee X**, exposing a clean, secured façade
over the public [OpenLibrary API](https://openlibrary.org/developers/api).

> Built as part of a structured Apigee learning journey, applying real-world API
> management patterns: authentication, rate limiting, response transformation,
> observability, and gateway hygiene.

## Architecture

The proxy `books-v1` exposes a versioned, paginated, façade-shaped API on top of
OpenLibrary's verbose backend:

\`\`\`
Client (Postman / App)
│
│ GET /v1/books/search.json?q=tolkien
│ x-api-key: <consumer-key>
▼
┌─────────────────────────────────────────┐
│ APIGEE X — books-v1 proxy │
│ │
│ PreFlow: │
│ • AM-AddCorrelationId │
│ • SA-AntiBurst (10 req/s) │
│ • VK-VerifyKey │
│ • Q-PerAppLimit (100 req/min/app) │
│ │
│ Conditional Flows: │
│ • SearchBooks → JS-Transform façade │
│ • HealthCheck → RF returns 200 OK │
│ │
│ PostFlow: │
│ • AM-EchoCorrelationId │
│ • AM-AddRateLimitHeaders │
│ • AM-AddDebugHeaders (opt-in) │
└─────────────────────────────────────────┘
│
▼
OpenLibrary public API
\`\`\`

## What it demonstrates

- **API design**: versioning (`/v1/`), façade pattern, decoupled URL from backend.
- **Security**: API Key authentication via Developer/App/Product hierarchy.
- **Traffic management**: Spike Arrest (instantaneous protection) + Quota (commercial limit) — applied in canonical order.
- **Transformation**: JavaScript-based response reshape (40 fields → 6 fields, camelCase, computed cover URLs).
- **Observability**: Correlation ID propagation, debug-mode headers, MessageLogging policy structure (Cloud Logging-ready).
- **Resilience**: DefaultFaultRule for error logging, IgnoreUnresolvedVariables on optional paths.

## Endpoints

| Method | Path                        | Description              | Auth    |
| ------ | --------------------------- | ------------------------ | ------- |
| GET    | /v1/books/search.json?q=... | Search books by keyword  | API Key |
| GET    | /v1/books/works/{id}.json   | Get book details         | API Key |
| GET    | /v1/books/health            | Healthcheck (no backend) | None    |

## Policy naming conventions

| Prefix | Type           | Example                   |
| ------ | -------------- | ------------------------- |
| AM-    | AssignMessage  | AM-AddCorrelationId       |
| RF-    | RaiseFault     | RF-HealthCheckOk          |
| VK-    | VerifyAPIKey   | VK-VerifyKey              |
| Q-     | Quota          | Q-PerAppLimit             |
| SA-    | SpikeArrest    | SA-AntiBurst              |
| JS-    | JavaScript     | JS-TransformBooksResponse |
| ML-    | MessageLogging | ML-LogTransaction         |

## Repository structure

\`\`\`
.
├── proxies/books-v1/apiproxy/ # The Apigee proxy bundle
├── config/ # API Products and Apps definitions
├── tests/postman/ # Postman collection for integration tests
├── docs/ # Architecture decisions, conventions
└── .github/workflows/ # CI/CD pipelines
\`\`\`

## Deployment

This proxy is deployable on any Apigee X organization. Manual deployment via
the Apigee console (Upload bundle), or automated via `apigeecli` (see `.github/workflows/`).
