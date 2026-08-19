# alldb — Plan

**The best possible place to spin up, look at, and connect to a database — nothing else.**
Open source. Self-host it or use the managed cloud. Adapts to who's using it: a newbie gets a URL and a button; a senior engineer gets full config, logs, and shell access on the same instance.

---

## 1. Problem

Running a database today means picking a vendor per engine (RDS for Postgres, Atlas for Mongo, Upstash for Redis...), learning each one's console, and stitching together credentials by hand. That's fine for an experienced backend engineer. It is *not* fine for the growing population of people — indie hackers, AI-assisted ("vibe coding") developers, small businesses — who need a database to exist in the next 30 seconds, with a connection string, a way to look at the data, and nothing else to think about.

Existing "one-click database" tools (see §6.1) treat databases as one feature among many (app hosting, static sites, cron jobs, 280 one-click templates). None of them treat *just the database* as the whole product — which means none of them have made the actual "look at my data" experience genuinely excellent. That gap is the opening.

## 2. What alldb is

A control plane + web UI + CLI + API that does **one job** — hosting and browsing databases — better than anything that does it as a side feature:

1. Spins up a **single-tenant instance** of a database engine from a versioned reference definition.
2. Hands back a **connection URL**, credentials, and a **best-in-class web-based data browser** immediately.
3. Presents the same instance differently depending on who's looking: a **simple view** (URL, connect snippet, browse button) by default, and an **advanced view** (raw config, resource limits, logs, shell, replication/backup policy) one click away. Same object, same data — not two products.
4. Works identically whether it's deployed on **alldb Cloud** (hosted by us) or **self-hosted** by a business on their own infrastructure — same OSS core either way.

We are deliberately *not* a general PaaS. No app hosting, no static sites, no cron jobs, no 280-template catalog. Databases only, done all the way.

## 3. Non-goals

- Not a new database engine. We orchestrate existing ones (official images) — no forked storage engines.
- Not a general app-hosting / PaaS platform (this is the line that separates alldb from Coolify/Railway/Elestio — see §6.1). If a feature request is "also deploy my app," the answer is no.
- Not a horizontally-scaled multi-tenant shared cluster. Each instance is its own isolated process/container. Pooled/shared low-cost tiers are a later data-plane optimization, not a v1 requirement.
- Not a BI/analytics tool. The data browser is for inspection and light querying, not dashboards.
- **Not AI-agent-first at launch.** MCP/agent access is real (§14) but is not the thing that has to win people over first — the human experience does. See §6.1 on why racing to be "the AI-native one" isn't the wedge.

## 4. Core principles

- **One command, one URL.** `alldb create postgres` (or a UI click) → running instance → connection string. No YAML required to get started.
- **Progressive disclosure, not two products.** Every instance has exactly one simple view and one advanced view. The simple view is the default and hides everything except connect + browse. The advanced view reveals the same instance's full config, logs, resource limits, and shell — nothing is duplicated or diverges; "advanced" is just more of the same object visible. This is the concrete mechanism behind "adapts to whoever's using it," not a vague aspiration.
- **The data browser is the product, not a bolted-on Adminer link.** If someone opens alldb just to look at their data — with no intention of ever using the browse-and-connect flow — it should still be the best tool they've used for that, per engine.
- **Reference services, not magic.** Every engine is a documented, versioned "service definition" (image + config + health check + backup/restore scripts + connection-string template). Anyone can read it, fork it, or add a new engine by writing one.
- **Self-host = full product, not a crippled tier.** The OSS control plane does everything the hosted cloud does. This is the credibility bar for the OSS/dev community.
- **Production-grade by default.** Backups, TLS, resource limits, and restart policies are not opt-in add-ons — they're what "create an instance" does.

## 5. User journey (what it feels like)

**Newbie / vibe-coder, via web UI:**
1. "New Database" → pick Postgres → Create. No size/region decisions forced on them — sane defaults, changeable later in the advanced view.
2. ~10–30s later: connection URL, `.env` snippet, "Browse data" button. That's the whole screen.
3. Data browser: tables, run a query, view rows. No jargon, no unexplained knobs.

**Senior engineer, same instance:**
1. Clicks "Advanced" on that same instance.
2. Sees raw config, CPU/mem/disk graphs, connection pool settings, backup schedule, a shell into the container, structured logs.
3. Everything the simple view hid is here — nothing is a separate product or a paid unlock.

**Business, self-hosting:**
1. `docker compose up` on their own infra.
2. Same UI/API as alldb Cloud, their own AWS/GCP/DO account or bare metal.
3. Their engineers get one internal portal for every database their org runs.

**AI agent (post-MVP, §14):**
1. Agent calls `create_database(engine="postgres")` via MCP, gets `{connection_url, admin_ui_url}` back.
2. Runs migrations directly. No human touches a console.
3. This works *because* the underlying product is already excellent for humans — the agent surface rides on top, it doesn't have to carry the product on its own.

## 6. Supported engines

Depth before breadth. Ship **one engine done exceptionally well**, prove the wedge, then expand via the reference-manifest pattern.

| Phase | Engines |
|---|---|
| MVP (Phase 1) | **PostgreSQL only** — the whole simple/advanced UI, the whole data-browser experience, built and polished against one engine first |
| Phase 2 | MySQL/MariaDB, MongoDB, Redis/Valkey — prove the manifest pattern generalizes |
| Phase 3 | ClickHouse, Elasticsearch/OpenSearch, MinIO, SQLite (ephemeral/dev) |
| Phase 4 | Vector DBs (Qdrant, Weaviate), Neo4j |

Each engine is defined by one **service manifest** (see §8) — adding an engine should be a PR that adds one manifest + a data-browser adapter, not a change to the control plane. But manifest-portability is a Phase 2 proof point, not a Phase 1 goal — Phase 1's only goal is "is the Postgres experience good enough that people talk about it."

### 6.1 Competitive reality (why this scope, honestly)

This space is not empty:

- **Coolify** (Apache-2.0, 55k+ GitHub stars) already does one-click Postgres/MySQL/Mongo/Redis, self-hosted, as one feature of a broader PaaS (280+ app/service templates). It has years of head start and community gravity.
- **Elestio** / **Northflank** — managed, BYOC, 25+ engines, SOC2/HIPAA compliance already in place.
- **Selfhost.dev** already ships 150+ MCP tools for provisioning/managing databases from Claude/Cursor — the "AI-agent-native" angle is not an open door, it's contested.
- **Railway** sets the UX bar for "click → URL → done" (not open source, not self-hostable).

None of them make the *database itself* — browsing it, understanding it, working with it day to day — the whole product with a UI that scales from total beginner to power user on the same instance. That gap, not breadth of engines or being first with an MCP server, is what alldb is betting on. Racing incumbents on breadth (more engines, more compliance certs, more infra options) is a losing game for a new, smaller entrant — racing them on depth of one experience is not.

## 7. Architecture

```
                        ┌─────────────────────────┐
                        │        Web UI / CLI       │
                        │  (simple view / advanced   │
                        │   view — same instance)     │
                        └────────────┬─────────────┘
                                     │ REST + WS(logs/metrics)
                        ┌────────────▼─────────────┐
                        │       Control Plane        │
                        │  (API, auth, scheduler,    │
                        │   metadata DB)              │
                        └──┬──────────────┬──────────┘
                           │              │
                 ┌─────────▼───┐   ┌──────▼───────┐
                 │  Provisioner │   │  MCP Server   │
                 │  (per-driver)│   │ (post-MVP,    │
                 │              │   │  see §14)      │
                 └──────┬───────┘   └───────────────┘
                        │
                 ┌──────▼─────┐
                 │  Docker /   │   (Kubernetes / bare-VM drivers land later,
                 │  Compose    │    same interface — see §12)
                 │  driver     │
                 └──────┬─────┘
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
              │  (TCP passthrough +  │
              │   HTTP routing)      │
              └─────────┬─────────┘
                        │
                 instance.alldb.io:PORT  (or path-based for HTTP admin UI)
```

**Components:**

- **Control plane** — the only "always-on shared" thing. Owns auth, instance metadata, and the reconciliation loop (desired state → actual state).
- **Provisioner** — pluggable drivers. MVP ships **Docker only**; Kubernetes and bare-VM drivers land in Phase 2+ behind the same interface (`create(manifest, size) -> InstanceHandle`, `start/stop/delete`, `snapshot/restore`, `exec`, `logs`, `metrics`).
- **Service manifests** — one per engine, see §8. The extensibility point, exercised for real starting in Phase 2.
- **Gateway** — routes traffic to the right container; TCP passthrough for the wire protocol, TLS terminated at the edge.
- **Data browser** — a stateless service that speaks the engine's protocol server-side and exposes a normalized "list tables, run query, get schema" API. This is the single most important component to get right — it's the actual product, not plumbing.
- **MCP server** — post-MVP (§14), not part of the Phase 1 build.
- **Connectors** — per-instance connection string, `.env` block, and framework snippets rendered from the manifest's template.

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

Only one manifest (`postgres`) needs to exist for Phase 1. The format is designed for Phase 2 portability, but it doesn't need to prove itself until then.

## 9. Deployment modes

| | alldb Cloud (managed) | Self-hosted OSS |
|---|---|---|
| Who runs the control plane | us | the business/dev, on their own infra |
| Install | n/a, sign up | `docker compose up` |
| Data location | our cloud accounts | their own AWS/GCP/DO/bare metal |
| License model | same OSS core + hosted convenience | Apache-2.0 core |

`docker-compose.yml` is the only self-host installer target for Phase 1 — single VM, zero to a running control plane + first Postgres instance in under 5 minutes. This is the OSS credibility artifact; it needs to be flawless before anything else gets built. Helm chart and one-line installer are Phase 2+.

## 10. Security & isolation

- Each instance = its own container with its own network namespace, resource limits, and generated credentials (no shared root password across instances).
- Secrets generated per-instance, encrypted at rest (file/age for self-host default).
- Network policy: instances cannot reach each other by default.
- TLS: gateway terminates TLS for HTTP admin traffic; Postgres gets `sslmode=require` support.
- Audit log of control-plane actions (create/delete/credential-rotate) from day one.

## 11. Backups, monitoring, scaling

- **Backups**: scheduled `pg_dump` snapshot, retained N days, one-click restore to a new instance.
- **Monitoring**: CPU/mem/disk/connection metrics in the advanced view.
- **Scaling**: vertical only (resize CPU/mem/disk, stop/restart). Horizontal scaling is out of scope until an engine actually needs it.

## 12. Repo structure (proposed monorepo)

```
alldb/
  control-plane/        # API server, auth, scheduler, reconciliation loop
  drivers/
    docker-compose/     # MVP: the only driver that exists
    kubernetes/          # Phase 2+
    vm-systemd/          # Phase 2+
  services/
    postgres/            # MVP: the only manifest that exists
  data-browser/          # protocol adapters + normalized browse/query API
  gateway/               # TLS + TCP/HTTP routing
  mcp-server/            # Phase 2+, not built for MVP
  web/                   # frontend — simple view + advanced view
  cli/                   # `alldb` CLI
  deploy/
    docker-compose.yml   # the self-host quickstart
  docs/
```

## 13. MVP scope (Phase 1 — prove the wedge, not the breadth)

Goal: a stranger can `docker compose up`, open the UI, create a Postgres instance, get a URL, and say **"this is the best database browsing/connecting experience I've used"** — for one engine, in under 5 minutes, with zero docs beyond the README. Breadth of engines proves nothing if the one engine isn't genuinely better than the alternatives.

- [ ] Control plane: create/list/delete instance, simple auth, Docker driver only.
- [ ] One service manifest: Postgres.
- [ ] Gateway: TCP passthrough, per-instance port allocation.
- [ ] **Data browser** (the actual bet): table listing, schema view, query runner with real syntax highlighting/autocomplete, row browsing with sane pagination for large tables, CSV/JSON export. This gets disproportionate effort relative to everything else in the MVP.
- [ ] Web UI: create flow; instance page with **simple view** (URL, `.env` snippet, browse button) and **advanced view** (config, resource graphs, logs, shell) on the same instance.
- [ ] CLI: `alldb create postgres`, `alldb list`, `alldb rm`, `alldb url <id>`.
- [ ] `docker-compose.yml` one-liner self-host install.
- [ ] Docs: README quickstart.
- [ ] **Explicitly deferred, not started until Phase 1 lands and gets real usage feedback**: any second engine, Kubernetes driver, MCP server, billing/cloud, backup automation. Multi-engine breadth is a Phase 2 decision made *after* seeing whether the Postgres-only experience actually lands — not a parallel workstream now.

## 14. Roadmap after MVP

1. **Phase 2 engines** (MySQL, MongoDB, Redis) — only once Postgres is proven, to validate the manifest pattern generalizes and the data-browser abstraction holds up across protocols.
2. **MCP server** — wraps the control-plane API as MCP tools once there's a human-proven product underneath it. Explicitly not a launch feature (see §6.1) — it's how an already-good product becomes usable by agents too, not what makes the product good.
3. **Kubernetes driver** — self-host-at-scale, and the basis for alldb Cloud's backend.
4. **alldb Cloud** — hosted control plane; billing, org/team management, regions.
5. **Backups & restore automation, resize UI, alerting, Phase 3/4 engines.**
6. **"Bring your own cloud"** — cloud-hosted control plane provisioning into the customer's own account.

## 15. Open decisions (need a call before/while building)

- **License**: Apache-2.0 recommended (patent grant, still fully permissive, standard for infra OSS aimed at business adoption).
- **Control-plane language/stack**: needs to be picked before Phase 1 starts. TypeScript/Node (one language across control-plane + web UI, faster iteration on the data-browser UI which is the actual bet) vs. Go (single static binary, simpler self-host installer story). Leaning TypeScript/Node given Phase 1 is UI-heavy, not infra-breadth-heavy — worth a real decision, not a silent default.
- **Team/resourcing reality**: the honest assessment in §16 assumes this is a small/solo effort unless stated otherwise. If that's wrong, some of §16's scoring changes — worth confirming explicitly.
- **Naming/branding for the hosted product** vs. the OSS project — cosmetic, pick before the landing page gets built.

## 16. Honest go/no-go assessment

Rated on the actual bar set: not "is this a reasonable plan" but "will this realistically become the tool developers and businesses across the world default to." Scored against six weighted dimensions, assuming a small/solo team and no confirmed distribution channel unless corrected in §15.

| Dimension | Weight | Score /10 | Why |
|---|---|---|---|
| Problem validity | 15% | 8 | Real pain, proven by the size of the competitors solving pieces of it. Not a burning, actively-searched-for need on its own — an improvement on known alternatives, not a category creation. |
| Differentiation / wedge strength | 20% | 6 | "Best-in-class data browser + progressive disclosure, database-only" is a real, currently unowned niche. But it's a UX bet, not a structural moat — a funded competitor could copy the winning ideas within a quarter of seeing traction. |
| Execution difficulty vs. likely resources | 20% | 4 | Even scoped to one engine, "best-in-class" data browser + adaptive UI + production-grade security/backups is a multi-quarter build to do *well*, and this is infrastructure — reliability bugs are trust-destroying, not just annoying. Biggest honest risk on the list. |
| Competitive timing / moat | 15% | 4 | Entering years after Coolify has 55k stars and community gravity, after Selfhost.dev already covers the AI-agent angle. Not first, not funded, no technical moat once the idea is visible. |
| Distribution / community / marketing plan | 15% | 2 | Nothing in this plan yet addresses *how* it reaches the world — no launch strategy, no content engine, no growth loop. OSS projects blow up as much from distribution as from code quality; this dimension is currently unaddressed entirely. |
| Technical soundness of the plan itself | 15% | 8 | Now well-scoped, focused, and internally consistent with the chosen wedge. |

**Weighted score: ≈ 5.3 / 10.**

That is below the 9 you set as the bar to proceed. Two honest things to say about that, not as a hedge but because both are true and you should have them before deciding:

1. **The score is real, not sandbagged.** The weak dimensions (execution difficulty, moat, distribution) are weak because they depend on things this plan genuinely doesn't establish yet — team size, a launch plan, a reason a funded incumbent can't just copy the winning UI idea. Sharpening the product wedge (which we just did) moved differentiation and technical soundness up; it didn't and couldn't move execution/distribution/moat, because those aren't product questions.
2. **A ">9/10 to proceed" bar, taken literally, is close to unattainable for *any* early-stage plan for an ambitious "become the global default" outcome** — Docker, Kubernetes, and Postgres itself didn't have knowably-9+/10 plans at inception; that outcome is driven by years of execution, community response, and timing luck that no document can score in advance. If the rule is meant literally, it will kill this idea and almost any other first-time OSS bet at the planning stage, before execution ever gets a chance to move the real numbers (distribution, moat, execution track record) — the only dimensions that can't be improved by writing a better plan.

Given that, the real decision isn't "does the document score above 9" — it's whether you want to treat the weak dimensions (distribution plan, resourcing commitment, a concrete answer to "what happens when Coolify copies the good idea") as gating questions to answer *before* writing code, or whether you're willing to build the Phase 1 Postgres-only slice as a cheap way to generate the evidence (real usage, real reactions) that those dimensions can't get without it. I'd lean toward the second — build the smallest real version of the wedge and let actual usage answer the distribution/moat questions, rather than trying to plan your way to a 9 on a document.

---

**Next step**: your call per §16 — either treat this as a stop, or greenlight the Phase 1 Postgres-only slice (`control-plane/`, `services/postgres/`, `data-browser/`, `deploy/docker-compose.yml`) as the cheapest way to generate real evidence on the dimensions a plan document can't score.
