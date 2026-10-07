# Atlas Market: Capstone E-commerce Platform

A small e-commerce app (catalogue, cart, checkout, order history) built as four services plus PostgreSQL and Redis, provisioned on AWS EKS with Terraform.

> Infrastructure, deployment, design decisions and cleanup sections are added during the capstone build.

## Architecture

```text
Browser
  │
  ├── /        → frontend         (nginx, static UI)          :8080
  └── /api/*   → gateway          (routing, rate limit)       :3000
                   ├── /api/products → product-service        :3001 ──→ PostgreSQL (products)
                   │                                                 └→ Redis (catalogue cache)
                   └── /api/orders   → order-service          :3002 ──→ PostgreSQL (orders)
                                          └── reserves stock via product-service
  gateway ──→ Redis (rate-limit counters, shared across replicas)
```

| Service | Image | Talks to | Purpose |
|---|---|---|---|
| frontend | `atlas201/shop-frontend` | gateway (Compose only) | Static shop UI |
| gateway | `atlas201/shop-gateway` | product-service, order-service, Redis | Single API entry point, request IDs, per-client rate limit |
| product-service | `atlas201/shop-product-service` | PostgreSQL, Redis | Catalogue and stock. Cache-aside reads from Redis |
| order-service | `atlas201/shop-order-service` | PostgreSQL, product-service | Places orders, reserves stock first, releases it if saving fails |
| postgres | `postgres:16-alpine` | | One database `shop`; each service owns its own tables |
| redis | `redis:7-alpine` | | Cache and rate-limit counters. Not a source of truth |

### Behaviour worth knowing

- **Redis is optional at runtime.** If it goes down, product-service serves straight from PostgreSQL and the gateway stops rate limiting (fails open). Nothing returns an error.
- **Stock cannot go negative.** Reservation is a single conditional `UPDATE ... WHERE stock >= qty` inside a transaction, all items or none. Tested with 15 parallel orders against a stock of 7: exactly 7 succeeded, 8 got `409`.
- **Prices come from the server.** The client sends product IDs and quantities only.
- **Schema is created by the services on startup** (`CREATE TABLE IF NOT EXISTS`, guarded by a Postgres advisory lock so several replicas can start at once). product-service seeds 12 products on first start. No init SQL to mount.
- **Graceful shutdown.** On `SIGTERM` each service fails `/readyz` immediately, keeps serving for `SHUTDOWN_DELAY_MS` (default 5 s) so Kubernetes can remove it from endpoints, then drains and exits. This is what makes rolling updates zero-downtime.

## API

All routes are reached through the gateway under `/api`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | Gateway only, no downstream calls. Returns `version` and Pod `hostname`. Use for load tests |
| GET | `/api/products` | Optional `?category=kitchen\|desk\|outdoor`. Response header `X-Cache: HIT\|MISS` |
| GET | `/api/products/:id` | |
| GET | `/api/orders` | Latest orders with items. Optional `?limit=1..100` |
| GET | `/api/orders/:id` | |
| POST | `/api/orders` | Body below. `201` on success, `409` if out of stock, `400` on bad input |

```json
{
  "customer_name": "Jason",
  "customer_email": "jason@example.com",
  "items": [{ "product_id": 1, "quantity": 2 }]
}
```

Every service also exposes `/healthz` (liveness, no dependencies) and `/readyz` (readiness, checks its own database). The frontend exposes `/healthz`.

## Configuration

| Variable | Used by | Default |
|---|---|---|
| `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` | product, order | standard libpq variables |
| `PGPASSWORD` | product, order | **secret** |
| `REDIS_HOST`, `REDIS_PORT` | product, gateway | `redis`, `6379` |
| `CACHE_TTL_SECONDS` | product | `30` |
| `PRODUCT_SERVICE_URL` | order, gateway | `http://product-service:3001` |
| `ORDER_SERVICE_URL` | gateway | `http://order-service:3002` |
| `RATE_LIMIT_PER_MIN` | gateway | `600` per client IP. `0` disables |
| `SHUTDOWN_DELAY_MS` | all Node services | `5000` |
| `GATEWAY_URL` | frontend | `http://gateway:3000` |
| `APP_VERSION` | all Node services | set at build time from the Git tag |

## Run locally (Docker Compose)

```powershell
Copy-Item .env.example .env   # then edit POSTGRES_PASSWORD
docker compose up -d --build
```

Open http://localhost:8080.

## Images

- Node services: multi-stage build, runtime is `alpine` plus the distro `nodejs` package (no npm or build tools in the final image). Run as UID `10001`.
- Frontend: `nginxinc/nginx-unprivileged`, runs as UID `101` on port `8080`.
- Built for `linux/amd64` by GitHub Actions on every push to `main` and every `v*` tag.
