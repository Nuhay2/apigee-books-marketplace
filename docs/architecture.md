# Architecture Decisions

## 1. Façade Pattern over OpenLibrary

OpenLibrary returns a 40+ field document per book, with inconsistent naming,
mixed scalars and arrays, and search-engine-oriented structure (`numFound`,
`docs`). Direct exposure would couple consumers to the backend's quirks.

The proxy reshapes responses into a 6-field, camelCase, paginated structure
(`total`, `page`, `limit`, `items[]`), exposing only what consumers need.

**Trade-off accepted:** Slight JavaScript policy overhead in exchange for
backend independence and a stable consumer contract.

## 2. Security model: Developer / App / Product / Proxy

API Key authentication is enforced via Apigee's hierarchical model:

- **Developer** identifies a partner organization.
- **App** is the credential holder (consumer key).
- **API Product** packages the proxy with permissions and quota defaults.
- **API Proxy** is the technical implementation.

This separates _commercial packaging_ (Product) from _technical contract_
(Proxy), allowing the same proxy to serve different audiences with different
limits.

## 3. Rate limiting strategy: Spike Arrest + Quota

Two policies, applied in canonical order:

- **SA-AntiBurst** rejects bursts above 10 req/s per IP — protects backend
  infrastructure from instantaneous load.
- **Q-PerAppLimit** rejects requests above 100 req/min per App — enforces
  commercial limits per consumer.

Spike Arrest runs before authentication (cheapest check first); Quota runs
after authentication (needs `client_id` to identify the bucket).

## 4. Observability without centralized logging

In environments where Cloud Logging access is restricted, the proxy provides:

- **Correlation ID** generation and propagation (both to backend and back to client).
- **Opt-in debug headers** (`X-Debug-*`) controlled by `X-Debug-Enabled: true`,
  exposing flow metadata without persistent logs.
- **Native Apigee Analytics** for aggregate metrics.
- **MessageLogging policy** present but disabled, ready for enablement when
  logging permissions are granted.
