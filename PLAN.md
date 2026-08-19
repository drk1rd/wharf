# alldb — Plan

**One place to spin up, browse, and connect to any database.**
Open source. Self-host it or use the managed cloud. Built to be as easy as pasting a URL — for humans and for AI agents.

---

## 1. Problem

Running a database today means picking a vendor per engine (RDS for Postgres, Atlas for Mongo, Upstash for Redis...), learning each one's console, and stitching together credentials by hand. That's fine for an experienced backend engineer. It is *not* fine for the growing population of people — indie hackers, AI-assisted ("vibe coding") developers, small businesses — who need a database to exist in the next 30 seconds, with a connection string, a way to look at the data, and nothing else to think about.

There's no single, open, self-hostable control plane that treats "give me a Postgres" and "give me a MongoDB" and "give me a Redis" as the same three-click action.

## 2. What alldb is

A control plane + web UI + CLI + API that:

1. Spins up a **single-tenant instance** of a database engine (Postgres, MySQL, MongoDB, Redis, ClickHouse, ... — see §6) from a versioned reference definition.
2. Hands back a **connection URL**, credentials, and a **web-based data browser** immediately.
3. Works identically whether it's deployed on **alldb Cloud** (hosted by us) or **self-hosted** by a business on their own infrastructure (Docker / Kubernetes / bare VM) — same OSS core either way.
4. Exposes everything through an API and an **MCP server**, so AI coding agents can provision and use a database without a human touching a console.

The name is the pitch: *all* the databases, *one* place.

## 3. Non-goals (v1)

- We are not building a new database engine. We orchestrate existing ones (official Docker images) — no forked storage engines.
- We are not building a horizontally-scaled multi-tenant shared cluster (i.e. not "one big Postgres with schemas per customer"). Each instance is its own isolated process/container — simpler operationally, simpler for backups, simpler for the "it's just your database" mental model. Pooled/shared low-cost tiers can come later as a data-plane strategy, not a v1 requirement.
- We are not building a BI/analytics tool. The data browser is for inspection and light querying, not dashboards.

## 4. Core principles

- **One command, one URL.** `alldb create postgres` (or a UI click) → running instance → connection string. No YAML required to get started.
- **Reference services, not magic.** Every engine is a documented, versioned "service definition" (image + config + health check + backup/restore scripts + connection-string template). Anyone can read it, fork it, or add a new engine by writing one.
- **Self-host = full product, not a crippled tier.** The OSS control plane does everything the hosted cloud does. The cloud is a convenience (someone else runs the control plane and pays for the boxes), not a feature unlock. This is the credibility bar for the OSS/dev community.
- **AI-native from day one.** Treat "an LLM agent is the driver" as a first-class client, not an afterthought bolted on later. MCP server, machine-readable errors, idempotent create calls.
- **Production-grade by default.** Backups, TLS, resource limits, and restart policies are not opt-in add-ons — they're what "create an instance" does.

## 5. User journey (what it feels like)

**Human, via web UI:**
1. Sign in → "New Database" → pick engine (Postgres 16, Mongo 7, Redis 7, ...) → pick size/region → Create.
2. ~10–30s later: status = running. Page shows connection URL, a copyable `.env` snippet, and a "Browse data" button.
3. Data browser opens: tables/collections/keys, run a query/command, view rows, export CSV/JSON.
4. "Connect" tab: ready-made snippets for psql/mongosh/redis-cli, and for common app stacks (Node/Prisma, Python/SQLAlchemy, Django, Rails, Go).

**AI agent, via MCP/API:**
1. Agent calls `create_database(engine="postgres")`.
2. Gets back `{connection_url, host, port, admin_ui_url}` as structured JSON.
3. Agent runs migrations directly against the URL. No human ever opened a console.

**Business, self-hosting:**
1. `docker compose up` (or Helm chart) on their own cloud account.
2. Same UI/API as alldb Cloud, pointed at their own infra credentials (their AWS/GCP/DO account, or bare metal).
3. Their engineers get one internal portal for every database their org runs, instead of five vendor consoles.

## 6. Supported engines

Ship a **thin, correct** MVP set, then grow via the reference-service pattern.

| Phase | Engines |
|---|---|
| MVP (Phase 1) | PostgreSQL, MySQL/MariaDB, MongoDB, Redis/Valkey |
| Phase 2 | ClickHouse, Elasticsearch/OpenSearch, SQLite (ephemeral/dev), MinIO (S3-compatible) |
| Phase 3 | Vector DBs (Qdrant, Weaviate), Kafka/NATS (adjacent but same UX), Neo4j |

Each engine is defined by one **service manifest** (see §8) — adding an engine should be a PR that adds one manifest + tests, not a change to the control plane.

## 7. Architecture

```
                        ┌─────────────────────────┐
                        │        Web UI / CLI       │
                        └────────────┬─────────────┘
                                     │ REST/GraphQL + WS(logs/metrics)
                        ┌────────────▼─────────────┐
                        │       Control Plane        │
                        │  (API, auth, billing,      │
                        │   scheduler, metadata DB)   │
                        └──┬──────────────┬──────────┘
                           │              │
                 ┌─────────▼───┐   ┌──────▼───────┐
                 │  Provisioner │   │  MCP Server   │
                 │  (per-driver)│   │  (AI agents)  │
                 └──────┬───────┘   └───────────────┘
                        │
        ┌───────────────┼────────────────────┐
        │               │                    │
 ┌──────▼─────┐  ┌──────▼─────┐       ┌──────▼─────┐
 │  Docker /   │  │ Kubernetes  │       │  Bare VM /  │
 │  Compose    │  │  (Helm)     │       │  systemd    │
 │  driver     │  │  driver     │       │  driver     │
 └──────┬─────┘  └──────┬─────┘       └──────┬─────┘
        └───────────────┴────────────────────┘
                        │
              ┌─────────▼─────────┐
              │   Data Plane        │
              │  one container per  │
              │  instance, per the   │
              │  engine's manifest    │
              └─────────┬─────────┘
                        │
              ┌─────────▼─────────┐
              │  Gateway/Proxy      │
              │  (TCP/TLS SNI +     │
              │   HTTP routing)     │
              └─────────┬─────────┘
                        │
                 instance.alldb.io:PORT  (or path-based for HTTP admin UI)
```

**Components:**

- **Control plane** — the only "always-on shared" thing. Owns org/user auth, instance metadata (which engine, which driver, which region, owner), billing (cloud only), and the reconciliation loop (desired state → actual state).
- **Provisioner** — pluggable drivers so the same control plane can create instances via Docker Compose (single box, self-host default), Kubernetes (scale-out self-host / cloud), or a bare-VM/systemd driver (cheapest possible self-host, no container runtime required). Driver interface: `create(manifest, size) -> InstanceHandle`, `start/stop/delete`, `snapshot/restore`, `exec(cmd)`, `logs()`, `metrics()`.
- **Service manifests** — one per engine, see §8. This is the extensibility point.
- **Gateway** — a single ingress that routes `instance-id.alldb.io` (or `host:port` for raw TCP protocols like Postgres wire protocol) to the right container. TLS terminates here; SNI-based routing for TCP engines, hostname/path routing for HTTP-native engines (Mongo doesn't speak HTTP, so TCP passthrough + a dedicated port range, similar to how Fly.io/Render do managed Postgres).
- **Data browser** — a separate stateless service that speaks each engine's protocol server-side (never in the browser) and exposes a normalized "list tables/collections/keys, run query, get schema" API to the web UI. This is what makes "one UI for every DB" possible without reinventing five different query languages in the frontend.
- **MCP server** — wraps the same control-plane API as MCP tools: `create_database`, `list_databases`, `get_connection_info`, `run_query`, `delete_database`. This is the thing that makes an AI agent's life a single tool call.
- **Connectors** — generated, per-instance: connection string, `.env` block, and framework-specific snippets (Prisma schema `datasource` block, SQLAlchemy URL, Mongoose URI, etc.) rendered from the manifest's connection-string template.

## 8. The service manifest (the extensibility contract)

A YAML (or TOML) file per engine, e.g. `services/postgres/manifest.yaml`:

```yaml
name: postgres
display_name: PostgreSQL
versions: ["16", "15", "14"]
image: "postgres:{version}-alpine"
ports:
  - { name: db, container_port: 5432, protocol: tcp }
env:
  POSTGRES_PASSWORD: "{secret:root_password}"
  POSTGRES_DB: "{instance_id}"
volumes:
  - { name: data, path: /var/lib/postgresql/data, size: "{plan.disk_gb}Gi" }
health_check:
  type: tcp_and_exec
  exec: "pg_isready -U postgres"
connection_string:
  template: "postgres://{user}:{password}@{host}:{port}/{db}"
backup:
  strategy: exec
  dump_cmd: "pg_dump -U postgres {db}"
  restore_cmd: "psql -U postgres {db}"
data_browser_adapter: postgres   # maps to a driver in the browser service
resource_defaults:
  cpu: "0.5"
  memory: "512Mi"
  disk_gb: 1
```

Adding a new engine = adding one manifest + implementing (or reusing) a data-browser adapter for it. No control-plane code changes required for the common case.

## 9. Deployment modes

| | alldb Cloud (managed) | Self-hosted OSS |
|---|---|---|
| Who runs the control plane | us | the business/dev, on their own infra |
| Install | n/a, sign up | `docker compose up` (single box) or Helm chart (k8s) |
| Data location | our cloud accounts | their own AWS/GCP/DO/bare metal |
| License model | same OSS core + hosted convenience | Apache-2.0 / MIT core |
| Support for "bring your own cloud" (cloud but self-managed instances) | v2: connect your AWS account, we orchestrate, data never leaves your account | n/a (already the default) |

Self-host installer targets, in priority order:
1. `docker-compose.yml` — single VM, gets someone from zero to a running control plane + first database in under 5 minutes. This is the OSS credibility artifact; it needs to be flawless.
2. Helm chart — for teams already on k8s who want alldb as an internal platform.
3. One-line installer script (`curl | sh`) that wraps (1) for the "I just want it running" crowd.

## 10. Security & isolation

- Each instance = its own container/pod with its own network namespace, resource limits (CPU/mem/disk quotas), and generated credentials (no shared root password across instances).
- Secrets (root passwords, TLS keys) generated per-instance, stored in the control plane's secret store (encrypted at rest; pluggable backend — file/age for self-host default, Vault/KMS for cloud).
- Network policy: instances cannot reach each other by default; only the gateway and the org that owns the instance can reach it.
- TLS everywhere: gateway terminates TLS for HTTP admin traffic; TCP engines get TLS via the engine's native support where available (Postgres `sslmode=require`) plus network-level isolation as defense in depth.
- Audit log of control-plane actions (create/delete/credential-rotate) from day one — this is what makes a business trust it enough to self-host in production.

## 11. Backups, monitoring, scaling

- **Backups**: scheduled snapshot per instance (driver-level volume snapshot where available, engine-level dump as universal fallback), retained N days, one-click restore to a new instance.
- **Monitoring**: per-instance CPU/mem/disk/connection metrics surfaced in the UI (Prometheus-compatible `/metrics` from each driver); basic alerting (disk > 80%, instance down) via webhook/email.
- **Scaling (v1)**: vertical only — resize CPU/mem/disk on an existing instance (stop, resize, restart). Horizontal scaling (read replicas, sharding) is explicitly Phase 3+ and engine-specific; don't block MVP on it.

## 12. Repo structure (proposed monorepo)

```
alldb/
  control-plane/        # API server, auth, scheduler, reconciliation loop
  drivers/
    docker-compose/
    kubernetes/
    vm-systemd/
  services/              # one dir per engine = the manifest + engine-specific scripts
    postgres/
    mysql/
    mongodb/
    redis/
  data-browser/          # protocol adapters + normalized browse/query API
  gateway/               # TLS + TCP/HTTP routing
  mcp-server/            # MCP tool definitions wrapping the control-plane API
  web/                   # frontend (UI)
  cli/                   # `alldb` CLI
  sdk/                   # generated client libs (JS/TS, Python, Go)
  deploy/
    docker-compose.yml   # the self-host quickstart
    helm/
  docs/
```

## 13. MVP scope (Phase 1 — "make the demo real")

Goal: a stranger can `docker compose up`, open the UI, create a Postgres and a Redis instance, get URLs, browse data, and connect from a local script — in under 10 minutes, with zero docs beyond the README.

- [ ] Control plane: create/list/delete instance, auth (simple email+password or GitHub OAuth), single-node Docker driver only.
- [ ] Service manifests: Postgres, MySQL, MongoDB, Redis.
- [ ] Gateway: TCP passthrough with per-instance port allocation (skip fancy SNI routing for v1; simplest thing that works).
- [ ] Data browser: table/collection/key listing + raw query runner for all four MVP engines.
- [ ] Web UI: create flow, instance detail page (status, connection info, browse, connect snippets), delete.
- [ ] CLI: `alldb create <engine>`, `alldb list`, `alldb rm`, `alldb url <id>`.
- [ ] `docker-compose.yml` one-liner install for self-host.
- [ ] Docs: README quickstart + "add a new engine" guide (proves the manifest pattern works before Phase 2 engines get added).
- [ ] Explicitly deferred: Kubernetes driver, MCP server, billing/cloud multi-tenancy, backups automation, vertical resize UI. (Land right after MVP, in that order — MCP server especially, since it's a key differentiator.)

## 14. Roadmap after MVP

1. **MCP server + CLI polish** — this is the "AI agents use it directly" differentiator; ship it early, right after MVP.
2. **Kubernetes driver** — unlocks real self-host-at-scale and is the basis for alldb Cloud's own backend.
3. **alldb Cloud** — hosted control plane using the k8s driver; billing, org/team management, regions.
4. **Backups & restore automation, resize UI, alerting.**
5. **Phase 2 engines** (ClickHouse, OpenSearch, MinIO, vector DBs).
6. **"Bring your own cloud"** — cloud-hosted control plane that provisions into the customer's own AWS/GCP account (best of both: managed UX, their data residency).

## 15. Open decisions (need a call before/while building)

- **License**: Apache-2.0 vs MIT for the core (affects how comfortable businesses are self-hosting/forking). Recommendation: Apache-2.0 (patent grant, still fully permissive) — common choice for infra OSS aimed at business adoption.
- **Control-plane language/stack**: needs to be picked before Phase 1 starts. Recommendation lens: Go (single static binary, great for a "download and run" OSS installer, strong Docker/k8s SDKs) vs. TypeScript/Node (faster iteration, one language across control-plane + web UI + MCP server). Given the audience (AI-assisted devs, fast iteration, MCP/web-first), leaning TypeScript/Node for the control plane + a thin Go CLI, but this is worth 30 minutes of explicit discussion, not a silent default.
- **Multi-tenancy model for alldb Cloud pricing**: pure per-instance VM cost pass-through vs. bin-packing multiple small instances onto shared hosts (cheaper free tier, more ops complexity). Doesn't block OSS/self-host work; only matters once Cloud billing is designed.
- **Naming/branding for the hosted product** vs. the OSS project (e.g. "alldb" OSS + "alldb Cloud" hosted, or a distinct cloud brand) — cosmetic, but pick it before the landing page gets built.

---

**Next step**: confirm the Phase 1 engine list and control-plane stack (§15), then scaffold `control-plane/`, `services/postgres/`, and `deploy/docker-compose.yml` as the first working slice — a single engine, end-to-end, before adding the other three MVP engines.
