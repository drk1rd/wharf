# Wharf — Plan

**The best possible place to spin up, look at, and connect to a database — nothing else.**
Open source. Self-host it or use the managed cloud. Adapts to who's using it: a newbie gets a URL and a button; a senior engineer gets full config, logs, and shell access on the same instance.

---

## 1. Problem

Running a database today means picking a vendor per engine (RDS for Postgres, Atlas for Mongo, Upstash for Redis...), learning each one's console, and stitching together credentials by hand. That's fine for an experienced backend engineer. It is *not* fine for the growing population of people — indie hackers, AI-assisted ("vibe coding") developers, small businesses — who need a database to exist in the next 30 seconds, with a connection string, a way to look at the data, and nothing else to think about.

Existing "one-click database" tools (see §6.1) treat databases as one feature among many (app hosting, static sites, cron jobs, 280 one-click templates). None of them treat *just the database* as the whole product — which means none of them have made the actual "look at my data" experience genuinely excellent. That gap is the opening.

## 2. What Wharf is

A control plane + web UI + CLI + API that does **one job** — hosting and browsing databases — better than anything that does it as a side feature:

1. Spins up a **single-tenant instance** of a database engine from a versioned reference definition.
2. Hands back a **connection URL**, credentials, and a **best-in-class web-based data browser** immediately.
3. Presents the same instance differently depending on who's looking: a **simple view** (URL, connect snippet, browse button) by default, and an **advanced view** (raw config, resource limits, logs, shell, replication/backup policy) one click away. Same object, same data — not two products.
4. Works identically whether it's deployed on **Wharf Cloud** (hosted by us) or **self-hosted** by a business on their own infrastructure — same OSS core either way.

We are deliberately *not* a general PaaS. No app hosting, no static sites, no cron jobs, no 280-template catalog. Databases only, done all the way.

## 3. Non-goals

- Not a new database engine. We orchestrate existing ones (official images) — no forked storage engines.
- Not a general app-hosting / PaaS platform (this is the line that separates Wharf from Coolify/Railway/Elestio — see §6.1). If a feature request is "also deploy my app," the answer is no.
- Not a horizontally-scaled multi-tenant shared cluster. Each instance is its own isolated process/container. Pooled/shared low-cost tiers are a later data-plane optimization, not a v1 requirement.
- Not a BI/analytics tool. The data browser is for inspection and light querying, not dashboards.
- **Not AI-agent-first at launch.** MCP/agent access is real (§14) but is not the thing that has to win people over first — the human experience does. See §6.1 on why racing to be "the AI-native one" isn't the wedge.

## 4. Core principles

- **One command, one URL.** `wharf create postgres` (or a UI click) → running instance → connection string. No YAML required to get started.
- **Progressive disclosure, not two products.** Every instance has exactly one simple view and one advanced view. The simple view is the default and hides everything except connect + browse. The advanced view reveals the same instance's full config, logs, resource limits, and shell — nothing is duplicated or diverges; "advanced" is just more of the same object visible. This is the concrete mechanism behind "adapts to whoever's using it," not a vague aspiration.
- **The data browser is the product, not a bolted-on Adminer link.** If someone opens Wharf just to look at their data — with no intention of ever using the browse-and-connect flow — it should still be the best tool they've used for that, per engine.
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
2. Same UI/API as Wharf Cloud, their own AWS/GCP/DO account or bare metal.
3. Their engineers get one internal portal for every database their org runs.

**AI agent (post-MVP, §14):**
1. Agent calls `create_database(engine="postgres")` via MCP, gets `{connection_url, admin_ui_url}` back.
2. Runs migrations directly. No human touches a console.
3. This works *because* the underlying product is already excellent for humans — the agent surface rides on top, it doesn't have to carry the product on its own.

## 6. Supported engines

Depth before breadth. Ship **a small number of engines done exceptionally well**, prove the wedge, then expand via the reference-manifest pattern.

| Phase | Engines |
|---|---|
| MVP (Phase 1) | **PostgreSQL and MongoDB** — the whole simple/advanced UI, the whole data-browser experience, built and polished against a relational and a document engine so the manifest/adapter pattern is proven on two genuinely different protocols, not just parameterized SQL twice |
| Phase 2 (shipped) | **MySQL and Redis** — see §6.2a for what this proved and didn't |
| Phase 3 | ClickHouse, Elasticsearch/OpenSearch, MinIO, SQLite (ephemeral/dev) |
| Phase 4 | Vector DBs (Qdrant, Weaviate), Neo4j |

Each engine is defined by one **service manifest** (see §8) — adding an engine should be a PR that adds one manifest + a data-browser adapter, not a change to the control plane. Phase 1's goal is "is the Postgres/Mongo experience good enough that people talk about it" — breadth beyond these two is explicitly a later, evidence-gated decision (see §16).

### 6.1 Competitive reality (why this scope, honestly)

This space is not empty:

- **Coolify** (Apache-2.0, 55k+ GitHub stars) already does one-click Postgres/MySQL/Mongo/Redis, self-hosted, as one feature of a broader PaaS (280+ app/service templates). It has years of head start and community gravity.
- **Elestio** / **Northflank** — managed, BYOC, 25+ engines, SOC2/HIPAA compliance already in place.
- **Selfhost.dev** already ships 150+ MCP tools for provisioning/managing databases from Claude/Cursor — the "AI-agent-native" angle is not an open door, it's contested.
- **Railway** sets the UX bar for "click → URL → done" (not open source, not self-hostable).

None of them make the *database itself* — browsing it, understanding it, working with it day to day — the whole product with a UI that scales from total beginner to power user on the same instance. That gap, not breadth of engines or being first with an MCP server, is what Wharf is betting on. Racing incumbents on breadth (more engines, more compliance certs, more infra options) is a losing game for a new, smaller entrant — racing them on depth of one experience is not.

### 6.2 Ask your data (natural-language queries) — feature, not the wedge

The instinct "make text-to-SQL obsolete via something MCP-like" is worth separating into two different things, because they have very different value:

- **An MCP server that lets any AI agent (Claude, Cursor, ...) talk to a Wharf instance** doesn't make Wharf the inventor of natural-language database querying — any MCP client already does that translation itself once it can see a schema and run a query. Neon, Supabase, and Selfhost.dev (§6.1) already ship this. It's good hygiene, not a differentiator, which is why it stays a Phase 2+ roadmap item (§14), not something built to be the headline.
- **An in-app "ask your data a question in plain English" box**, built directly into the Simple view, is different: it works for someone who never opens an AI coding tool at all, which fits "adapts to whoever's using it" better than an agent integration does. It's also cheap to build on top of what already exists — the query runner and schema-listing endpoints did almost all the work.

So this shipped as the second kind: a plain-English input in the Simple view that calls a model with the instance's schema, gets back a single query (a read-only `SELECT` for Postgres/MySQL; a structured `{collection, filter}` for Mongo — never raw code execution against the container either way), runs it through the same `runQuery` path the manual query runner uses, and shows the result. It's gated on `OPENROUTER_API_KEY` being set on the control plane (see §17a for why OpenRouter rather than a single hardcoded provider), off by default for self-hosters who haven't configured it, with a visible hint rather than a hidden feature. Don't market it as "obsoletes text-to-SQL" — several competitors already have some version of natural-language query access; market it as "you don't have to know SQL to ask your database a question."

### 6.2a What Phase 2 (MySQL + Redis) actually proved

The stated goal of Phase 2 (§13) was to test whether the manifest/adapter pattern from §8 generalizes, not just to add engines for their own sake. It mostly held up, with one real gap it exposed:

- **MySQL was close to a copy-paste of the Postgres manifest and adapter** — different image, different identifier-quoting character (backtick vs double-quote), different `information_schema` query shape, same everything else (connection string template, backup via a SQL dump tool, the ask-your-data SQL prompt just needed the dialect name swapped in). This is exactly the outcome the pattern was supposed to produce.
- **Redis broke two assumptions the pattern had baked in without anyone noticing**, because Postgres and Mongo happen to agree on both: (1) that a manifest only needs `env()` to configure the container — Redis's password has to be a server *argument* (`--requirepass`), which didn't exist as a manifest concept until Redis needed it, so `ServiceManifest.command()` and the corresponding `Cmd` wiring in the Docker driver got added; (2) that every engine can do a clean stdin/stdout dump-and-restore — Redis's dump path works (`redis-cli --rdb -`) but there's no equivalent stdin-based restore, so `backup` became optional on the manifest type rather than forcing a fake or broken implementation to exist. Both changes are now load-bearing for any future non-SQL engine, not just Redis.
- **A real bug only a live Docker daemon could catch**: the first end-to-end run against a real (if network-restricted) daemon in this environment showed that a failed container create (bad image, unavailable port, ...) leaked the volume it had already created — the instance row never recorded a volume name to clean up later, so nothing could remove it. Fixed by making volume creation and container creation a single unit that cleans up after itself on any failure. This is the kind of bug that "the code compiles and the manifest pattern looks right on paper" cannot surface — it took an actual daemon rejecting an actual image pull to find it.

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
                 instance.wharf.dev:PORT  (or path-based for HTTP admin UI)
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

| | Wharf Cloud (managed) | Self-hosted OSS |
|---|---|---|
| Who runs the control plane | us | the business/dev, on their own infra |
| Install | n/a, sign up | `docker compose up` |
| Data location | our cloud accounts | their own AWS/GCP/DO/bare metal |
| License model | same OSS core + hosted convenience | Apache-2.0 core |

`docker-compose.yml` is the only self-host installer target for Phase 1 — single VM, zero to a running control plane + first Postgres instance in under 5 minutes. This is the OSS credibility artifact; it needs to be flawless before anything else gets built. Helm chart and one-line installer are Phase 2+.

## 10. Security & isolation

- Each instance = its own container with its own network namespace, resource limits, and generated credentials (no shared root password across instances).
- **As built** (see §17a, superseded by §22): real accounts (scrypt-hashed passwords, httpOnly session cookies) with per-instance ownership, plus an admin/service token (`WHARF_TOKEN`) for the CLI. There is no anonymous-access window at all anymore, not even a single-user one — §22 retired it: every fresh instance requires a mandatory first-boot superadmin account before anything works.
- Secrets generated per-instance. **As built** (see §25, superseded — this paragraph originally listed these as gaps): self-signed-CA TLS on the provisioned database connections themselves, for Postgres/MySQL/MongoDB (Redis/ClickHouse still need it — see §25's scope cut); an audit log, though scoped to per-instance mutating actions (§20) rather than every control-plane action platform-wide — account-management actions (promote/demote/delete a user, login/logout) aren't in it. Still genuinely not built: encryption at rest for the SQLite store, and TLS on the control plane's own HTTP API/web UI (self-host still relies on whatever's in front of it for that — a tunnel, a reverse proxy you add; §25 only covers the database connections it provisions, not its own API). Don't read any of this as "the security model is done" — real gaps remain.
- Network policy: instances cannot reach each other by default.

## 11. Backups, monitoring, scaling

- **Backups**: scheduled `pg_dump` snapshot, retained N days, one-click restore to a new instance.
- **Monitoring**: CPU/mem/disk/connection metrics in the advanced view.
- **Scaling**: vertical only (resize CPU/mem/disk, stop/restart). Horizontal scaling is out of scope until an engine actually needs it.

## 12. Repo structure (as built)

```
control-plane/           # Express + TypeScript API
  src/
    manifests/            # postgres.ts, mongodb.ts, mysql.ts, redis.ts, registry.ts — the extensibility contract
    browser/              # matching adapters — list/browse/query/schema-context, normalized
    ask.ts                 # OpenRouter-backed natural-language query generation, live model list
    auth.ts                 # sessions, admin-token bypass, the bootstrap-window rule (§17a)
    users.ts                  # password hashing/verification (scrypt), validation
    docker.ts                  # provisioner: create/stop/stats/logs/exec via dockerode
    instances.ts                # orchestration: create/delete/connection-string/ownership logic
    backups.ts                   # dump/restore via docker exec, binary-safe, optional per-engine
    db.ts                         # SQLite metadata store (users, sessions, instances, backups)
    routes/                        # auth.ts, instances.ts, browse.ts — the REST API
web/                      # React + Vite UI — accounts, Settings, Simple/Advanced instance views
cli/                      # `wharf` CLI (create/list/rm/url), authenticates via WHARF_TOKEN
deploy/
  docker-compose.yml      # self-host quickstart
PLAN.md
README.md
```

No separate gateway service or pluggable-driver abstraction yet — ports are published directly by Docker and the provisioner talks to the Docker daemon directly. Both are real §7/§9 ideas for when a second driver (Kubernetes) or real multi-tenant routing is actually needed; building them before that need exists would have been speculative.

## 13. MVP scope (Phase 1 — prove the wedge, not the breadth)

Goal: a stranger can `docker compose up`, open the UI, create a Postgres, MongoDB, MySQL, or Redis instance, get a URL, and say **"this is the best database browsing/connecting experience I've used"** — in under 5 minutes, with zero docs beyond the README.

- [x] Control plane: create/list/delete instance, optional shared-token auth, Docker driver.
- [x] Service manifests: Postgres, MongoDB.
- [x] Per-instance port publishing (no dedicated gateway yet — see §12).
- [x] **Data browser**: table/collection listing with row-count estimates, row browsing with pagination, a query runner (raw SQL for Postgres; structured JSON filter for Mongo — deliberately no `$where`/eval, so it can't become remote code execution against the container).
- [x] Web UI: create flow; instance page with **Simple view** (URL, `.env` snippet, browse + query panel) and **Advanced view** (live CPU/mem/net/disk metrics, config, logs, backups) on the same instance.
- [x] CLI: `wharf create <engine>`, `wharf list`, `wharf rm`, `wharf url <id>`.
- [x] `docker-compose.yml` self-host install (with the host-gateway networking fix needed for the control plane to reach sibling containers from inside its own container).
- [x] Backup/restore (`pg_dump`/`mongodump` via `docker exec`, binary-safe) — beyond the original MVP checklist, included because it was cheap given the exec plumbing backups already needed.
- [x] **Ask your data** (natural-language query, beyond the original MVP checklist — see §6.2): a plain-English question box in the Simple view, gated on `ANTHROPIC_API_KEY` being set. Not "text-to-SQL as a headline feature" per §6.1's reasoning — it's a small addition on top of the query runner that already existed, aimed at the person who doesn't want to learn SQL/Mongo query syntax at all. Extended to MySQL when it shipped; explicitly not offered for Redis (see §6.2/AskPanel).
- [x] **Phase 2 engines (MySQL, Redis)** — landed ahead of the original "prove Postgres/Mongo first" sequencing once real usage confirmed the core experience works; see §6.2a for what it proved about the manifest pattern, including a real bug (a container-create-failure volume leak) that only a live Docker daemon surfaced.
- [x] README quickstart — **run end-to-end on a real machine with Docker** (not just this build sandbox): `docker compose up --build` came up clean and instances were created through the UI successfully.
- [ ] **Still deferred**: syntax highlighting/autocomplete in the query runner, CSV/JSON export, Kubernetes driver, MCP server, billing/cloud, multi-user auth, Redis backup/restore (see §6.2a — no clean stdin-restore path without a container restart). Not started until this Phase 1+2 slice gets more real usage feedback.

**Honest status**: this was built, type-checked, and unit-smoke-tested against the real Express app and SQLite store throughout. Two rounds of live verification since the first draft of this status note:

1. **Self-host quickstart, on a real machine**: confirmed working — `docker compose up --build`, create flow, connection info, all as designed.
2. **A real (if network-restricted) Docker daemon, in this build sandbox**: this environment couldn't run compose end-to-end (its own egress policy blocks pulling images from Docker Hub — an environment restriction, not a code issue), but starting the daemon directly here was enough to exercise the actual `dockerode` calls — volume/container creation, failure handling, cleanup — for the first time, and it found a real bug (§6.2a's volume leak) that no amount of type-checking or mocking would have.

Still unverified: **the "ask your data" Claude API round trip** — the request shape (strict tool use, forced `tool_choice`, the read-only-SQL / structured-filter safety checks on the response) type-checks against the current `@anthropic-ai/sdk`, and the feature's gating/error-surfacing was verified live, but no `ANTHROPIC_API_KEY` has been available in any session so far to confirm a real response from Claude. That's the next concrete gap to close, not a hypothetical one — everything else in this list has now had a real external system behind it at least once.

## 14. Roadmap after MVP

1. ~~**Phase 2 engines** (MySQL, Redis)~~ — shipped; see §6.2a.
2. **MCP server** — wraps the control-plane API as MCP tools once there's a human-proven product underneath it. Explicitly not a launch feature (see §6.1) — it's how an already-good product becomes usable by agents too, not what makes the product good.
3. **Kubernetes driver** — self-host-at-scale, and the basis for Wharf Cloud's backend.
4. **Wharf Cloud** — hosted control plane; billing, org/team management, regions.
5. **Backups & restore automation, resize UI, alerting, Phase 3/4 engines** (including closing the Redis backup/restore gap — needs a different mechanism than the generic exec-based one, see §6.2a).
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

## 17. Pilot readiness plan

The evidence-generating step §16 called for is now built and confirmed working on real hardware (Postgres, MongoDB, MySQL, Redis — create, connect, browse, query, ask-your-data, backups). The next step isn't more engines — it's getting a handful of real people to actually use it. "Furnished enough for that" is a much smaller bar than "production launch," and it's worth being explicit about the difference so this doesn't quietly turn into another round of building instead of shipping.

**Scope**: 3–10 people you know (mix of the "newbie/vibe-coder" and "senior engineer" personas from §5, not just other developers who'll be polite), for a short window (days, not an open-ended beta), on a shared instance you control. Not a public launch — no HN/Product Hunt post, no anonymous signups. That comes later, if this round says it should.

**Must-do before inviting anyone** (safety, not polish):

1. **Set a real `WHARF_TOKEN`.** It's optional today and the docs already warn it's dev-only — that warning becomes load-bearing the moment anyone outside you can reach the URL. Non-negotiable, not a nice-to-have.
2. **Cap the number of instances a shared pilot can create.** Nothing today stops one curious tester from spinning up 30 databases and exhausting the host. This is a real gap on a shared box, worth closing before strangers (even friendly ones) touch it — see below, this one I can build now.
3. **Say the trust model out loud to testers**: it's one shared token, everyone sees everyone's instances, don't put real/sensitive data in it. Simpler than building per-user isolation for a 3–10 person pilot, but only safe if testers actually know that going in.

**Where it runs — needs your call, not something I can do from here:**

- **Fastest**: `docker compose up --build` on a machine you already have (your laptop, a spare box), exposed to testers via a tunnel (Cloudflare Tunnel or `ngrok http 5173`) instead of standing up new cloud infra. Zero new spend, reversible in one command, matches "smallest real thing" — my default recommendation for a pilot this size.
- **Alternative**: a small VPS (Hetzner/DigitalOcean/similar) if you want it reachable without your machine staying on. I can walk through the setup, but provisioning it and paying for it is yours to do — I don't have a cloud account or payment method to do that on your behalf.
- Either way: real domain optional, a raw IP or tunnel URL is fine for a pilot.

**Deliberately not doing for this round** (would be building for a launch that isn't happening yet):

- A formal onboarding flow / product tour — the UI is self-explanatory enough from a one-line "click an engine, then look at Simple vs Advanced" from whoever sends the invite. Building a tour for 5 people is premature.
- An in-app feedback widget — just ask people directly (DM, call, whatever you'd use anyway). Simpler and gets better signal than a form nobody fills in.
- Org/team accounts, billing — Kubernetes driver, Wharf Cloud, MCP server (§14) — none of them make the pilot better; they're answers to problems this pilot hasn't confirmed exist yet.

### 17a. What shipped instead of the shared-token plan above

This section originally scoped the pilot around one shared `WHARF_TOKEN` and explicitly deferred multi-user auth as out of scope at this size. That call got revisited mid-build on direct instruction: real accounts, a Settings page, and — separately — swapping ask-your-data from a hardcoded Anthropic call to OpenRouter with a live, per-user model picker. Both landed, and both are now real, not aspirational:

- **Accounts replace the shared token as the default.** Signup/login/sessions (scrypt-hashed passwords, httpOnly session cookies), with each instance owned by the account that created it — an account only sees its own instances plus anything created before any account existed. `WHARF_TOKEN` didn't go away; it's now specifically the admin/service-account path (what the CLI uses, and a deliberate full-visibility bypass for the operator), not the only auth mechanism. This is a strictly better fit for the pilot than the original plan: testers no longer see each other's instances by default, and the "say the trust model out loud" must-do above is largely moot for anyone who signs up for their own account.
- **A bootstrap window, not a flag to remember to flip.** Auth is off (single-user local/dev, matching the original pre-accounts behavior) exactly until either `WHARF_TOKEN` is set or the first account signs up — at that instant, every other request needs a real session or the admin token. No separate "now enable auth" step to forget.
- **Ask-your-data moved off Anthropic onto OpenRouter**, on explicit instruction, with a per-user model picker (Settings, or inline per question) populated live from OpenRouter's `/models` endpoint rather than a hardcoded list — model catalogs move fast enough that a baked-in list would go stale. `OPENROUTER_API_KEY` replaces `ANTHROPIC_API_KEY`; the safety checks that mattered (read-only `SELECT` enforcement, structured-filter-only for Mongo) carried over unchanged, since they're about what the generated query is allowed to do, not which provider generated it.
- **Verified live**, same standard as everything else in this document: the full signup → auth-required-flips → login-screen-appears → real-form-login → per-user instance isolation → 404-not-403-on-someone-else's-instance chain was exercised against a running control plane (curl for the API-level isolation checks, Playwright for the actual UI flow — bootstrap dashboard, login screen, post-login dashboard with the account's email in the topbar, Settings page). What's *not* verified: a real OpenRouter API call (no key available in any session so far — same category of gap as the earlier Anthropic-key gap it replaces) and the model catalog fetch/filter against OpenRouter's real, current response shape (the code defends against the shapes I'm confident about, but I haven't fetched the live endpoint).

**What I can build right now, safely and reversibly**: the instance-count cap (shipped), and the accounts/OpenRouter work above (shipped). What's left in "must-do" — picking where this actually runs, setting real secrets, inviting people — is a decision or an action on your infrastructure, not code.

### 17b. Adoption/appeal pass — closing the obvious gaps, not chasing more polish

Asked separately: "how do we make this easy to adopt, appeal more." Worth splitting into what's a real, checkable gap versus what's cosmetic, because it's easy to spend a lot of time on the second and call it the first.

**Shipped, unambiguous, no decision needed:**
- **A `LICENSE` file.** There wasn't one — a from-scratch check of the repo root confirmed it, this wasn't a guess. A missing license is a hard stop for a lot of serious adopters (businesses in particular, exactly who §2 targets) before they read a single line of code; Apache-2.0, matching the recommendation §15 already made months ago but never actually added. Zero downside to fixing this immediately.
- **README leads with the actual product now**, not just prose about it — real screenshots (`docs/screenshots/`, captured from a running instance this session, not mockups) at the top, before the reader has to decide whether to keep reading. GitHub's own browsing/discovery flow is almost entirely visual triage in the first few seconds; a wall of text at the top of a README is a real, measurable drop-off point.

**Real levers, but need your call — not something to silently build:**
- **Prebuilt Docker images** (published to GHCR or Docker Hub) so `docker compose up` pulls instead of building from source — meaningfully cuts time-to-first-instance for a new adopter, and removes "do I have the right Node toolchain" as a failure mode. Needs a registry namespace and either manual publishing or a CI workflow with package-write permission — your call on where, and whether to wire up the GitHub Action now or once the pilot's given real signal it's worth the upkeep.
- **A one-line installer script** (`curl | sh` wrapping the compose file) — nice, but only worth it once the prebuilt-images question above is settled; a one-liner that still does a multi-minute local build isn't actually the win it looks like.

**Not doing, and saying so plainly**: none of this — a nicer README, a license file, faster pulls — is a substitute for §17's actual pilot. A repo that's easier to *try* isn't the same claim as a product people *want*; only real usage tells you the second thing, and that's still the one open, unresolved question this whole document keeps coming back to (§16's distribution score, §17's original point, this section's own framing). Polish compounds the effect of real usage once it exists; it doesn't create it.

## 18. Redirect: evolve the software, not the pilot

Asked directly: not a pilot — keep evolving this as software. Worth naming what that changes, since §17 was written for a different next step.

The honest gap wasn't a missing feature — it was that **every claim of correctness in this document rested on one person manually verifying it, once, per session** (curl calls, screenshots, reading logs). Nothing was repeatable, nothing ran automatically, and nothing would have caught a regression the next time any of this changed. That's the actual ceiling on "evolving as software" at this point, not the absence of a Kubernetes driver or an MCP server.

**Shipped**: a real test suite (`node:test`, zero new test-framework dependency) and CI (`.github/workflows/ci.yml`).

- **Pure unit tests** (manifests, identifier-quoting safety on Postgres/MySQL, the Redis command tokenizer) — fast, no infra, and specifically pin down the injection boundary between a name a user clicks in the UI and a raw SQL/command string, which is exactly the kind of logic that's easy to silently break while refactoring.
- **HTTP-level auth tests** — the bootstrap-to-required-auth transition, signup/login/logout, wrong-password rejection, the admin-token path — against a real Express app instance (`app.ts` was split out of `index.ts` specifically so it's importable without binding a port), a real ephemeral SQLite DB per test file, real HTTP requests, real cookies.
- **A real cross-user isolation test** — this is the one that mattered most to get right: two real accounts, instance rows inserted directly (bypassing Docker, so it's fast and infra-free), and assertions that user A gets a 404 (not a 403 — existence shouldn't leak) on user B's instance across list/get/delete/browse/query. This is a security property, and until this session it had never been tested, only reasoned about while writing `canAccessInstance`.
- **Real-engine integration tests**, gated on Docker actually being reachable — create→running→browse→query→backup against real Postgres/MySQL/MongoDB/Redis containers, skipping gracefully (not failing) when no daemon is present. They skip in this sandbox, same reason as every Docker-dependent thing has all session (this environment's own network policy blocks Docker Hub); they will not skip in CI, where GitHub-hosted runners have a real daemon and unrestricted internet. That's the actual point of writing them — CI is the first place in this entire project's history that can verify the create→browse→query path against a real engine that this sandbox has never been able to.

**Verified before pushing**: `npm run typecheck`, `npm run build`, and `npm test` all pass locally — 35 tests, 31 passing, 4 correctly skipped (the Docker ones). What "verified" doesn't yet cover: whether the CI workflow itself is correctly configured — that only gets confirmed by watching it actually run on GitHub, which is the next thing to check after this pushes, not an assumption to leave standing.

## 19. Feature push: ClickHouse, live resize, export, Redis backup — and what CI actually caught

Asked directly, in these words: "No amendment features feature set. It has to be more good, more adaptable, more better, more features into it. Like, all in one solution for database is nothing else." This section covers that batch and, just as important, the first real bug CI (not this sandbox) found.

**Shipped:**
- **ClickHouse as a fifth engine** — manifest + a new HTTP-interface browser adapter (no official client library needed; ClickHouse's HTTP endpoint takes raw SQL and returns `FORMAT JSON`). Deliberately shipped with only the `latest` version tag, not a pinned numbered one — this sandbox can't pull from Docker Hub to verify a specific tag exists, and shipping an unverified version string is worse than shipping none.
- **Redis full backup/restore** — Redis has no `pg_dump`-style exec command, so `BrowserAdapter` grew an optional `dumpAll`/`restoreAll` pair (client-protocol-level backup, for engines where an exec-based dump doesn't exist). Redis's implementation walks the keyspace with `SCAN`, and uses per-key `DUMP`/`RESTORE` — the binary-safety detail that mattered: node-redis v4's typed `client.dump()` returns a `string` by default, which silently corrupts binary payloads; the fix was `client.sendCommand(["DUMP", key], {returnBuffers: true})` instead.
- **ClickHouse backup/restore** — same `dumpAll`/`restoreAll` mechanism, using `SHOW CREATE TABLE` for schema plus `FORMAT JSONEachRow` for data (one of ClickHouse's oldest, most symmetric I/O formats — chosen over an exec-based `clickhouse-client` pipeline specifically because that format couldn't be verified against a real instance in this sandbox; an unverified backup format is a false sense of safety, not a feature).
- **Live CPU/memory resize** — `PATCH /instances/:id/resize`, applied to the running container via `dockerode`'s `container.update()` (cgroup limits), no restart or recreation. Disk is deliberately excluded — a Docker volume can't be live-grown this way.
- **CSV/JSON export** — client-side, from any query/browse result already in the UI, no new server endpoint.

**A bug only CI found, not this sandbox:** the first CI run after this batch (`ci.yml` run for the test-suite commit) failed two of its five real-engine integration tests — Postgres and MySQL both got a `500` on the first query issued immediately after their instance was marked `"running"`; MongoDB and Redis passed. Full job logs (pulled via the GitHub MCP tools, not guessed at) showed why: the official Postgres and MySQL images both do an `initdb`-then-restart startup sequence, where the port accepts a TCP connection *before* the server can actually serve a query. `waitForPort` was TCP-only, so "running" was being declared a beat too early. Fixed with `waitForAdapterReady()` in `instances.ts` — after the TCP check passes, it retries a real `adapter.listObjects()` call (up to 30s, 500ms interval) and only then marks the instance `"running"`. This is the exact scenario §18 was written to eventually catch: a race that no amount of manual curl-testing in a sandbox without a full Docker daemon could ever have surfaced, found the first time this project's CI ran against real containers.

**Verified before pushing**: `npm run typecheck`, `npm run build`, and `npm test` pass locally for both workspaces (control-plane: 35 runnable tests green, 5 Docker-gated tests correctly skipped; web: typecheck + Vite build). The readiness-race fix itself can only be confirmed by a fresh CI run against real Postgres/MySQL containers — that's the next thing to check after this pushes, same discipline as §18.

**CI is now fully green, end to end, against real containers.** Getting there took four more rounds after the readiness-race fix above, each found by actually reading a CI failure rather than guessing from the sandbox (this sandbox still can't run any of this — no Docker Hub access — so every one of these was invisible until it ran on GitHub's infrastructure):

1. **Unhandled client "error" events crashing across tests.** node-postgres's `Client` and node-redis's client are both `EventEmitter`s that throw on an unhandled `"error"` event instead of just rejecting the in-flight call — and the new `waitForAdapterReady()` retry loop hits exactly that condition, hammering a client against a server that's still mid-startup. CI's log showed the literal symptom: `Error: Socket closed unexpectedly`, attributed to whatever test happened to be running when the stray event fired (redis's own test hung for a full two minutes from this). Fixed by attaching a no-op `.on("error", ...)` listener in both adapters' `withClient` helpers — a real production reliability fix, not just a test one, since the same retry loop runs against real containers outside of tests too.
2. **ClickHouse's `query()` appending `FORMAT JSON` to writes.** Valid for `SELECT`, but appended to `CREATE TABLE` or `INSERT ... VALUES (...)` it either errors or silently conflicts with the inline data — an insert immediately followed by a select came back empty because of exactly this. Fixed by only appending/parsing `FORMAT JSON` for read-shaped statements.
3. **500s silently swallowed with no server-side log.** Every route in `routes/instances.ts` caught its own errors and returned them as JSON without ever calling `console.error`, so a genuine bug there was invisible in CI's log — this is *why* it took two guesses (attempts 1 and 2, still not the real cause) before the actual error surfaced. Fixed with a `respondError()` helper that logs any 5xx before responding, plus the postgres delete test printing the real response body on assertion failure — a debuggability fix that paid for itself immediately: the very next run named the real cause in one line.
4. **A missing `FOREIGN KEY` cleanup on delete.** `backups.instance_id` references `instances.id` with no cascade, and `deleteInstance` removed the instance row without ever removing its backup rows first — every engine's delete hit this identically (the log showed it for mysql, mongodb, redis, and clickhouse too; postgres's test was just the only one that asserted on the delete status, so it was the only one that visibly failed). Fixed with `deleteBackupsForInstance()`, which also cleans up each backup's file from disk — a separate, real leak that existed independently of this bug.

Five rounds of push-then-watch-real-CI in total for this one feature batch (readiness race + these four), each one a genuine bug this sandbox could never have surfaced on its own. That is the entire point of §18's redirect, working exactly as intended.

---

## 20. Nine-feature push: resource budgets, and everything from seed data to an auto-generated REST API

Asked directly to think about resource limits, then — after a two-persona ("vibe coder" and "senior engineer") brainstorm of what else a user of this product would actually want — to scope every idea discussed as a tracked task and build all of them. This section is the record of that batch, each one shipped with the same discipline as §19: typecheck/build/test locally for both workspaces, a real end-to-end test against a real container in `engines.integration.test.ts` where applicable, a push, and a real CI run actually read before moving on.

**Resource budgets** (the request that started the batch): live resize (§19) already let any single instance grow to 16 cores / 32GB with nothing stopping every instance on a host from doing that simultaneously. `WHARF_MAX_TOTAL_CPU` / `WHARF_MAX_TOTAL_MEMORY_MB` cap the combined cpu/memory reserved across every instance on the host, enforced on both create and resize (`assertWithinResourceBudget()` in `instances.ts`), each optional and independent of `WHARF_MAX_INSTANCES`'s count-only cap. Deliberately resize-only for picking CPU/memory (no size decision forced at creation time) — a scoped decision, not a default, per the earlier `AskUserQuestion` exchange this session.

**The nine features:**

1. **Seed/sample data on instance create** — every fresh SQL/document instance now provisions with a small `customers`/`orders` dataset already in it (`seedSampleData()` on the manifest, gated by `WHARF_SEED_SAMPLE_DATA`), so the data browser isn't an empty screen on first look. System-initiated only, fixed statements, never fed user input.
2. **Framework connection snippets** — the Connect panel now renders ready-to-paste connection code for common frameworks/ORMs per engine (`frameworkSnippets()` in `InstancePage.tsx`), not just a raw connection string.
3. **CSV/JSON import** — `POST /instances/:id/browse/import`, reusing each adapter's new `importRows()` method against a table/collection that must already exist; a file-upload control in the Browse panel on the web side.
4. **Scheduled/automated backups** — `PATCH /instances/:id/backup-schedule` (interval + retention), a `backup_schedules` table, and `runDueBackups()` — dependency-injected so it's testable without a real scheduler timer — run from `index.ts`'s interval alongside the alert checker, never wired into `buildApp()` itself so tests don't inherit a live timer.
5. **Scoped per-instance API tokens** — `api_tokens` table, `mintApiToken`/`resolveApiToken` (sha256-hashed, `wst_` prefix), a new `AuthContext` kind (`scoped`) bound to exactly one instance with `read` or `write` scope. A read-scoped token can't reach raw query execution at all (query text can't be safely classified read-vs-write across five engines' syntaxes), only the structured read paths.
6. **Audit log** — `audit_log` table (deliberately no FK on `instance_id`, so a "delete" entry survives the instance row itself being removed), `recordAudit()` called at the point each mutating action actually succeeds, an Activity panel in the Advanced view.
7. **Resource/slow-query alerting** — `checkResourceAlerts()` (cpu/memory thresholds against live container stats) and `alertSlowQuery()` (per-query duration), both POSTing to `WHARF_ALERT_WEBHOOK_URL` with a per-instance-per-type cooldown so one hot instance doesn't spam a webhook every tick.
8. **Database branching / instant clone** — `POST /instances/:id/branches`: dumps the source, provisions a new instance of the same engine/version, restores the dump into it. Found two real bugs only real CI against real containers surfaced (see below) — this is the feature that most validated the "verify against real infrastructure" discipline this round.
9. **Auto-generated REST API per table** — `GET/POST/PATCH/DELETE /instances/:id/api/:table` for Postgres/MySQL/ClickHouse (the SQL engines with a real notion of "a table" — Mongo/Redis gated out, same pattern as ask-your-data). Row-identification is caller-specified (`idColumn` query param, default `"id"`) rather than assumed, since none of the three engines guarantee a single well-known primary-key column — ClickHouse's MergeTree "primary key" is a sort/index key, not a uniqueness constraint. ClickHouse itself only got GET; its `UPDATE`/`DELETE` are async background mutations, not immediately-consistent operations, so wrapping them in a REST `PATCH`/`DELETE` that returns before the mutation actually applies would have misrepresented what happened — left unsupported rather than shipped dishonestly.

**Two real bugs, both found only by reading actual CI log output against real containers, not by reasoning about the code:**

- **Branching bug 1**: `restoreBackup()`'s same-instance safety check (`backup.instance_id !== row.id`, correct for the normal restore-your-own-backup flow) directly blocked branching, whose entire point is restoring the *source's* backup into a *different, new* instance. CI's log named it exactly: `Error: backup not found for this instance`. Fixed by splitting the shared restore mechanics into `applyRestore()`, with `restoreBackup()` (keeps the check, used by the public route) and a new `restoreBackupInto()` (used only by `createBranch`, which has already established the correct source/target relationship itself).
- **Branching bug 2**, found by a *second* real CI run right after fix 1: a branch ended up with 3 rows instead of the source's 4. Root cause — the branch's own normal provisioning runs `seedSampleData()` (3 rows) *before* `createBranch`'s restore step runs; the restored dump's `CREATE TABLE`/`INSERT` statements then collided with what was already there, and `psql` doesn't abort on a per-statement error without `-v ON_ERROR_STOP=1`, so the restore "succeeded" while silently restoring nothing. Fixed with an optional `seed` parameter threaded through `createInstance()`/`provision()` (default `true`, unchanged for every other caller), so `createBranch` can skip seeding entirely for the instance it's about to overwrite with real data anyway.

**Verified before pushing**, every task: `npm run typecheck`, `npm run build`, and `npm test` pass locally for both workspaces; the control-plane suite now runs 85 tests (80 pass locally without Docker, the rest Docker-gated and green in CI). Every task got its own CI run actually checked via the GitHub MCP tools, not assumed green — task 22's first CI run failed on an unrelated ClickHouse container-provisioning timeout (`fetch failed` reaching `running`, in code the task's diff never touches); one re-run of just that job confirmed it was a flake, not a regression, per the same "same-diff-unrelated failure gets at most one confirming re-run" discipline used throughout this project's CI handling.

---

**Next step (decided)**: §16's evidence-generating slice and §17's pilot-readiness work still stand as written, unchanged, for whenever a pilot happens. But the redirect in §18 is the live instruction — treat this as an evolving piece of software with a growing regression net, not a repo waiting on a pilot. CI is confirmed green on real infrastructure (§19, §20). Next candidates: CLI login parity (the account system exists now; the CLI still only knows the admin token) and, only once those are solid, the larger deferred items in §14 (Kubernetes driver, more engines, MCP server) — still gated on real signal they're needed, not built ahead of it.

## 21. Publish-readiness pass, and a real marketing landing page

Asked directly: make the repo ready to publish world-wide, and build a real landing page in its own directory. Two different kinds of work — one closes gaps a serious OSS adopter checks for before trusting a repo, the other is the front door someone hits before they ever clone it.

**Repo publish-readiness:**
- **`LICENSE`'s copyright line was still the literal `[yyyy] [name of copyright owner]` placeholder** — Apache-2.0's template text, never filled in when the file was added (§17b). Fixed to `Copyright 2026 Wharf contributors`.
- **`CONTRIBUTING.md`** — dev setup, the pre-PR checklist (typecheck/build/test, real-container integration tests for anything engine-related), and, explicitly, how to add a new database engine (the two files — a manifest and a browser adapter — and where to register them), since that's the contribution shape this project's whole extensibility story (§8) is built around.
- **`SECURITY.md`** — points to GitHub's private vulnerability reporting rather than public issues, states scope (control plane/web/CLI/deploy config; upstream engine images are out of scope), and is honest about the two real gaps §10 already named (no encryption at rest for the SQLite store, no built-in TLS termination) rather than pretending they don't exist.
- **`CODE_OF_CONDUCT.md`** — Contributor Covenant 2.1, the OSS standard.
- **`.env.example`** — every control-plane environment variable that exists in the codebase (checked by grepping `process.env.WHARF_*`/`OPENROUTER_API_KEY` directly, not written from memory), documented, all defaulted off/unset.
- **GitHub issue templates** (bug report, feature request, a security-advisory contact link) **and a PR template** with the same checklist `CONTRIBUTING.md` describes.
- **`package.json` metadata** — `license`, `repository`, `homepage`, `bugs`, `keywords` were all missing at the root; added so the repo's own package manifest agrees with what `LICENSE` and the GitHub UI already say.
- **README** — a CI status badge (there was a license/engines badge but nothing showing whether the build is actually green, which is exactly the kind of signal §18/§19/§20's entire testing investment was for), and links to the new docs.

**The landing page** (`landing/`): a single self-contained `index.html` (plus a small `assets/` with the two real product screenshots and a `README.md` covering local preview and deployment to any static host) — no build step, no framework, deliberately independent of `web/`'s Vite app so it can be pointed at by GitHub Pages/Vercel/Netlify without dragging the product's own toolchain along.

Design-wise, it leans into what "Wharf" already means rather than a generic SaaS template: a dark ink-navy base matching the product's own UI, an amber "beacon" accent and teal "channel marker" secondary, Fraunces/Public Sans/IBM Plex Mono for a display-serif-plus-manifest-mono pairing, and — the one real structural idea — a "manifest ledger" feature list where each row's reference column is a literal string from the codebase (`resize`, `branch.create`, `token.mint`, `api.insert`, `audit_log`, `WHARF_ALERT_WEBHOOK_URL`, ...), not decorative numbering. Verified rendered correctly (desktop, tablet, and mobile viewports), no horizontal overflow at any width, and the copy-to-clipboard button actually works, using Playwright against the pre-installed Chromium — the same "don't just claim it, check it" standard as everything else in this document.

**Verified before pushing**: `npm run typecheck`, `npm run build`, and `npm test` pass locally for both workspaces (unaffected by this batch — it's docs, config, and a new static directory, no application code touched). No CI check needed beyond confirming the push itself succeeds, for the same reason §20's docs-only commit didn't need one.

## 22. Mandatory first-boot superadmin setup — retiring the anonymous bootstrap window

Asked directly: a fresh instance should prompt for a superadmin account on first boot, and that account must have full management over everything. This replaces the bootstrap-window model §10 and §17a described (auth off entirely — no login screen at all — until either `WHARF_TOKEN` was set or someone happened to sign up) with something stricter and simpler to reason about: **nothing works, for anyone, until the first account is created**, and that first account is automatically the platform's superadmin.

**What changed, mechanically:**
- `users.is_superadmin` (new column, migrated in for existing installs — see below). `needsSetup()` (`auth.ts`) is `usersRepo.count() === 0`; `GET /config` now reports it in place of the old `authRequired` field, which is gone (it would always be `true` under this model, so it stopped carrying information).
- **No new "setup" endpoint** — `POST /auth/signup` itself promotes whoever creates the very first account on the instance, checked with `usersRepo.count() === 0` right before the insert. The web UI just labels that same call differently (`AuthPage.tsx` shows "Create your superadmin account", no login/signup toggle, whenever `needsSetup` is true) — one mechanism, not two code paths to keep in sync.
- **The `AuthContext.anonymous` kind is gone entirely**, not just unreachable. `identify()` no longer has a branch that grants access when no session/token matches — previously that branch fired whenever `!adminToken && userCount() === 0`, which was the entire bootstrap window. Deleting it was sufficient on its own: `requireAuth` already 401s anything with no `req.auth`, and the only pre-setup paths that need to work (`/api/config`, `/auth/signup`) already sit outside that gate. No new blocking logic had to be written — the mandatory-setup behavior falls straight out of removing the old grant.
- `{kind:"user"}` grew an `isSuperadmin` field, refreshed from the DB on every request (`identify()` looks the row up by id, not just by session-to-userId), so a promotion or demotion takes effect on that account's very next request — never mind their next login.
- `canAccessInstance` treats a superadmin exactly like the `WHARF_TOKEN` admin credential (sees/manages every instance regardless of owner); `GET /instances` extends the same way.
- **New platform-wide user management** (`routes/admin.ts`, all behind a new `requireSuperadmin()` guard — admin token or a superadmin account, nothing else): `GET /users` (every account, with each one's owned-instance count), `PATCH /users/:id` (promote/demote — blocked from acting on yourself, and blocked from dropping the last remaining superadmin to zero), `DELETE /users/:id` (blocked on yourself; reassigns the removed account's instances to ownerless rather than deleting real running databases, and invalidates their sessions). This is the "must have all management for everything" half of the ask — instance access was already covered, accounts themselves weren't.
- **Upgrade path for existing self-hosted installs**: the `is_superadmin` column migration doesn't just add the column and stop — an install with pre-existing accounts and no superadmin concept would otherwise have nobody able to reach the new management surface at all (granting superadmin requires already being superadmin). The migration promotes whichever existing account signed up first, same rule as a fresh install's first signup, so upgrading never strands anyone.

**Why no separate `/auth/setup` route**: it was the first design considered, and rejected once it became clear the *only* difference between "the first account" and "any other account" is who gets promoted — same validation, same session creation, same response shape. A second endpoint would have meant two places that could drift out of sync for zero behavioral gain; the promotion check is three lines inside the existing handler.

**Test suite impact**: this was the largest blast radius of any change this session, because the old anonymous-bootstrap window was the *standard way* nearly every Docker-free test file in this suite got a full-access client (`new Client(server.baseUrl) // anonymous bootstrap mode`, repeated across ~10 files). Every one of those now calls a new harness helper, `setupSuperadmin()` (`testing/harness.ts`), which signs up the first account and hands back a `Client` already holding that session — a direct, mechanical replacement. Two files needed real thought, not just substitution: `ownership.test.ts`'s Alice was previously the harness's first-ever signup in that file's DB, which would now make her a superadmin and silently defeat the very ownership-boundary tests the file exists to prove — fixed by consuming the superadmin slot with a throwaway `setupSuperadmin()` call before Alice signs up. And `auth-flow.test.ts`, which was written specifically to exercise the old bootstrap semantics, needed a real rewrite rather than a substitution — it now proves the new ones instead (unauthenticated requests 401 before setup, `needsSetup` flips correctly, only the *first* signup gets promoted, a second one doesn't). A new `superadmin.test.ts` covers the management surface itself: cross-account instance visibility, the self-modification and last-superadmin guards, promotion taking effect without re-login, and instance reassignment (not deletion) on account removal.

**Verified live in a real browser**, not just the test suite: started both dev servers, drove the actual flow with Playwright against the pre-installed Chromium — fresh boot shows the setup screen (no login/signup toggle), completing it lands on the dashboard as superadmin, a second visitor gets the normal sign-in screen (not setup again), Settings' Users panel is invisible to that regular second account and fully visible to the superadmin, and promote/demote/delete all worked through the real UI (toast feedback, live table updates, the delete confirmation dialog's copy correctly describing reassignment rather than data loss).

**Verified before pushing**: `npm run typecheck`, `npm run build`, and `npm test` pass locally for both workspaces — the control-plane suite grew to 94 tests (89 passing without Docker, including the entire rewritten auth/ownership/superadmin coverage; 5 Docker-gated and green in CI).

## 23. CLI login parity — a real account, not just WHARF_TOKEN

Asked directly, after a "what else could this product use" exploratory pass named a short, honest list of candidates (org/team-style collaborators, SSO, the already-deferred Kubernetes driver and MCP server): pick the smallest, most obviously-overdue one and build it. CLI login parity won on that basis — the web UI has had real accounts, sessions, and now superadmin/user roles for a while; the CLI never grew past the one shared `WHARF_TOKEN` credential from before any of that existed, which is exactly the kind of rough edge that's cheap to fix and easy to keep deferring forever otherwise.

**What shipped**: `wharf login`, `wharf signup`, `wharf logout`, and `wharf whoami`, all in `cli/bin/wharf.js` — no new dependency, reusing the same `POST /auth/login` / `POST /auth/signup` endpoints the web UI already calls.

- **Session storage**: `~/.wharf/sessions.json`, keyed by `WHARF_API_URL` (not a single slot) — running the CLI against more than one self-hosted Wharf shouldn't mean logging in again every time you point it somewhere else. Written with mode `0600`, since the file holds a live session credential. The directory is overridable via `WHARF_CONFIG_DIR`, the same reasoning as `WHARF_DATA_DIR` on the control plane — mainly so tests never touch a real user's home directory, but also handy for anyone who wants config outside `$HOME` (a container, a CI cache path) on principle.
- **Credential input**: `--email`/`--password` flags, `WHARF_EMAIL`/`WHARF_PASSWORD` env vars (for scripts/CI), or an interactive prompt with the password masked as it's typed — implemented with raw-mode stdin character-by-character, not a new dependency, and falling back to a plain (unmasked) prompt when stdin isn't a TTY, since there's no terminal to mask against in a pipe anyway.
- **WHARF_TOKEN precedence**: an explicit, deliberately-set env var for this one invocation always wins over a session saved by a previous `wharf login` — a forgotten login session silently overriding a token meant for CI/automation would be a much worse failure mode than the reverse. `login`/`signup` print a note when this is the case, so it's not a silent trap. Proved for real, not just asserted: the test corrupts the stored session's cookie, then shows a `list` call still succeeds with `WHARF_TOKEN` set (so the request demonstrably used the token, not the broken cookie) and fails without it.
- **`wharf signup`** matters beyond CLI convenience: it's the only *non-web* way to complete §22's mandatory first-boot setup step — useful for a scripted/headless self-host deployment that never opens a browser.

**Verified twice**: a manual smoke test against a real running control plane first (signup → whoami → list → logout → the 401's error message → login → the token-precedence note), then a real automated test, `control-plane/src/__tests__/cli-login.test.ts` — spawns the actual `cli/bin/wharf.js` binary as a child process against a real HTTP server from the existing test harness (not a mocked fetch), same standard as everything else in this suite.

**A real bug the manual pass caught before the automated test even existed**: the first draft of the masked-password reader used raw control-character string literals (`""`, `""`, `""`) typed directly into the source. Reading the file back showed what looked like `case "":` — empty string cases, which would have made Ctrl-D/Ctrl-C/Backspace handling silently dead code. Byte-level inspection (`char.charCodeAt(0)` on each line) proved the actual file was correct — codes 4, 3, and 127 respectively, not empty strings — and the apparent bug was purely a rendering quirk of viewing raw control bytes as text, not a real defect. Worth recording because the instinct to "fix" it by rewriting as character-code comparisons was the wrong move sitting right there — the right response to a suspicious diff is to verify what's actually in the file before changing it, not to trust how a tool renders it.

**Verified before pushing**: `npm run typecheck`, `npm run build`, and `npm test` pass locally for both workspaces — the control-plane suite is now at 103 tests (98 passing without Docker, 5 Docker-gated).

## 24. Product UI redesign, and a genuinely better data browser

Asked directly: the product UI read as generic/AI-templated, and the data browser — the thing PLAN.md itself has called "the actual product, not plumbing" since §2 — needed to be materially better, not just re-skinned.

**Visual redesign** (`web/src/styles.css`, `web/index.html`): extends the identity already established for `landing/` (§21) into the actual product rather than inventing a third look — ink-navy base, an amber "beacon" accent replacing the generic blue every dashboard template also reaches for, a teal "channel marker" secondary for success states, Fraunces/Public Sans/IBM Plex Mono. Both themes were designed as real themes, not one inverted into the other: light mode is a warm paper tone with darkened, still-legible accent variants for contrast, not plain cool grey with the dark palette's colors lightened. Radius scale tightened slightly (14px → 10px at the largest) to read less like a default "rounded-lg everywhere" template. Verified live in both themes with Playwright screenshots against the pre-installed Chromium, not just eyeballed as CSS.

**A real bug the visual pass caught**: the selected item in the table/collection list (`.object-list button.active`) rendered with its text nearly invisible — `button.active`'s `background: var(--accent)` and `.object-list button`'s `background: transparent` have equal CSS specificity (one class + one element each), so the later rule in the file silently won regardless of which one was "supposed" to apply, leaving `button.active`'s dark `accent-contrast` text color sitting on a transparent (still-dark) background instead of the amber it was meant to have. This predates the redesign — the old blue accent and near-black text likely also collided the same way, just closer in value so it read as merely low-contrast rather than actually broken. Fixed with a higher-specificity `.object-list button.active` rule rather than reordering, so it can't silently regress again the next time something else gets added after it in the file.

**Data browser — filter builder** (backend: `browser/types.ts`'s new `BrowseFilter`, implemented in `postgres.ts`/`mysql.ts`/`clickhouse.ts`, wired through `routes/browse.ts`; frontend: a new `FilterBuilder` component in `InstancePage.tsx`): column/operator/value rows (`=`, `!=`, `>`, `<`, `>=`, `<=`, `contains`), AND-combined, translated into a real parameterized `WHERE` clause per engine — never string-spliced SQL, same discipline as every other query-building path this project has (`$1`/`?` bind params for postgres/mysql; ClickHouse's HTTP interface has no real bind params at all, so it reuses the existing `escapeLiteral` literal-escaping helper from task 22's `getRowById`, not ad hoc concatenation). SQL engines only — Mongo/Redis don't get the filter UI at all, an explicit scope cut rather than a half-implemented mismatch, consistent with how ask-your-data and the auto-generated table API both already gate on the same three engines.

**A real, pre-existing gap the filter feature's own tests surfaced**: `quoteIdent`'s thrown errors, in all three SQL adapters, never carried a `.status`, so an invalid identifier reaching any route using it — not just the new filter path — has always 500'd ("internal error") instead of 400'ing ("bad request"), for as long as `quoteIdent` has existed. Found writing a test that expected 400 for a malicious filter column name and got 500 instead. Fixed by attaching `.status = 400` to that error in all three adapters, which corrects the classification everywhere `quoteIdent` is used, not just in the new filter code path.

**Data browser — inline row editing** (`EditableResultTable`/`EditToolbar` in `InstancePage.tsx`, no new backend routes — reuses the auto-generated per-table REST API from task 22 exactly as built): edit, delete, and add rows directly in the browse view for Postgres/MySQL; add-only for ClickHouse (its `PATCH`/`DELETE` were never implemented in task 22, for the same async-mutation reason documented there — this UI just respects that existing boundary rather than working around it); Mongo/Redis keep the plain read-only table, unchanged. The row-ID column is a caller-specified dropdown defaulting to `id` when present, not an assumption — the same row-identification design task 22 committed to, now exposed as an actual control instead of only an API query parameter. Edits are diffed against the row's original values before saving, so an unmodified cell is never sent in the `PATCH`; the ID column itself is disabled during edit (changing the identifying value mid-edit would be actively confusing) and excluded from the diff.

**Verified live**, not just by reading the code: real browser sessions (Playwright, pre-installed Chromium) walking the actual setup → dashboard → settings flow in both themes, plus a second pass using Playwright's request interception to serve realistic table data to a fake (Docker-free) instance — verifying the filter builder opens, the row-ID selector and "+ Add row" affordance render, and clicking "Edit" on a real row correctly turns it into inputs with the ID column disabled and Save/Cancel in place — the deepest check this sandbox's lack of a Docker daemon allows for the frontend rendering logic specifically (the backend query-building itself is covered by real Docker-container tests in `engines.integration.test.ts`, checked in CI as always).

**Verified before pushing**: `npm run typecheck`, `npm run build`, and `npm test` pass locally for both workspaces (107 control-plane tests, 102 without Docker). The filter builder's real end-to-end behavior against a live Postgres container (`contains`, `=`, and AND-combined filters, including a no-match case) is a new addition to `engines.integration.test.ts` — the next thing to confirm is that CI run.

## 25. TLS on database connections, a deployment-settings setup step, and a persistent-sidebar layout

Asked directly, following up on this plan's own §10 ("no TLS termination anywhere in the stack") and a "what feature is most deal-blocking" exploratory pass that named it the top pick: build TLS, extend the mandatory first-boot setup (§22) to also collect deployment-wide config, and do a real layout pass rather than more panel-level polish — with an explicit constraint that none of it should get more complicated for the target users, only more capable.

**Scope, stated honestly up front**: self-signed-CA TLS for **Postgres, MySQL, and MongoDB**. **Redis and ClickHouse are deliberately deferred** — Redis needs a second dedicated `--tls-port` (a structural change to the one-port-per-instance provisioning model this whole codebase assumes), and ClickHouse needs an XML config block under `config.d/` plus a second HTTPS port rather than command-line flags, both bigger lifts than the three CLI-flag engines that shipped. Real Let's Encrypt/ACME is also out of scope — it needs real public DNS and port 80/443 HTTP-01 challenge access, neither guaranteed for an arbitrary self-hosted IP-only deployment — in favor of a self-signed CA, which works identically whether the deployment is reachable by IP or by domain, at the honest cost that a client either accepts an unverified-but-encrypted connection or manually imports the CA cert (downloadable from Settings, never the key) to verify it fully.

**How certs get into a sibling container** (`docker.ts`, `tls.ts`, `tar.ts`): the control plane talks to Docker over a mounted socket, but its own filesystem paths aren't visible to the daemon as host paths (docker-outside-of-docker), so a bind mount from the control plane's own storage into a freshly-created sibling container doesn't work. Solved with dockerode's `container.putArchive()` — copies files directly into a specific container's filesystem via the Docker daemon API, same mechanism `docker cp` uses, independent of where the writer process itself runs. `putArchive` needs a tar archive; rather than add a `tar-stream`/`tar-fs` dependency for exactly three small, fully-controlled files, `tar.ts` hand-rolls a minimal USTAR writer (header layout, checksum, 512-byte block padding, the two-zero-block terminator) — the same call this codebase already made for the CSV parser and the Redis command tokenizer: a small, fully-understood format doesn't need a dependency.

**Cert generation** (`tls.ts`, new `node-forge` dependency — pure JS, no native compilation, verified necessary since the control plane's `node:22-alpine` base image doesn't guarantee an `openssl` CLI binary is present): a deployment-wide self-signed CA is generated once and persisted to `WHARF_DATA_DIR/tls/{ca.crt,ca.key}` (cert `0644`, key `0600`, cached in memory after first load), then a fresh leaf certificate is issued per TLS-enabled instance, signed by that CA, with the deployment's public host as its CN/SAN (plus `localhost`/`127.0.0.1` as fallback SANs) — so the CA is trusted once, not once per database. The CA's private key never leaves this module: only `caCertificatePem()` (the public cert) is ever returned by an API route or written anywhere a client could read it.

**The permissions problem this actually turned on**: `putArchive` always writes as root regardless of the target container's own runtime user (same as `docker cp`), and Postgres in particular refuses outright to start if its key file is readable by anyone but its own owner. Rather than guess each image's internal UID (fragile, unverifiable without a live registry pull) or write a custom Dockerfile per engine, `createInstanceContainer` overrides the container's `Entrypoint` to `sh -c` and wraps the original command: `chown` the certs to the engine's runtime user, `chmod 600` the key, then `exec` the image's own unmodified entrypoint script with the same TLS-flagged arguments it would have gotten anyway (`ssl_cert_file`/`ssl_key_file`/`ssl_ca_file` for Postgres, `--ssl-cert`/`--ssl-key`/`--ssl-ca` for MySQL, `--tlsCertificateKeyFile`/`--tlsCAFile` for MongoDB — mongod wants cert+key concatenated into one PEM for that flag, so `tls.ts` writes a `combined.pem` alongside the separate files the other two engines want). The engine's own entrypoint script still runs exactly as it always did — env-var-driven first-boot init included — just after ownership is fixed, not instead of it.

**Connection strings, and a real client-library wrinkle**: `ServiceManifest.tls` (new optional field, `manifests/types.ts`) carries two suffix functions per engine — `internalConnectionSuffix()` for the control plane's own outbound traffic (readiness probing, the data browser) and `externalConnectionSuffix()` for what's shown to end users — because they need different trust semantics even for the same engine. Postgres: `sslmode=no-verify` internally (this deployment's own CA, no reason to re-verify it against a public root) vs. `sslmode=require` externally (encrypts without forcing a stranger to import a CA file first; `pg-connection-string` parses both natively, no code changes needed in `browser/postgres.ts`). MongoDB: `tls=true&tlsAllowInvalidCertificates=true` for both — the official MongoDB connection-string spec defines these query params directly, so the driver honors them with zero adapter code changes either. MySQL needed real code, not just a suffix: `mysql2`'s own URI parsing doesn't reliably turn a query-string `ssl` flag into a working TLS options object, so `?ssl=true` is instead a marker `browser/mysql.ts`'s `withConnection` reads itself, passing `{ rejectUnauthorized: false }` as an explicit sibling option alongside the connection URI rather than relying on URI magic that isn't guaranteed to work.

**Deployment settings become DB-backed and call-time-read** (`settings.ts`, `db.ts`'s new `deployment_settings` singleton table): `PUBLIC_HOST`/`PROBE_HOST` in `instances.ts` were previously frozen module-load-time constants from `WHARF_PUBLIC_HOST`/`WHARF_PROBE_HOST` — meaning a value set through the setup wizard or Settings could never take effect without a restart. Replaced with `publicHost()`/`probeHost()`, read fresh on every call. `WHARF_PUBLIC_HOST` stays an **absolute override** on top of whatever's stored, so an existing docker-compose deployment that already sets it keeps behaving identically after upgrading — the DB-backed value only matters when the env var is unset. `WHARF_PROBE_HOST` deliberately stayed env-var-only and out of the wizard entirely — it's a pure internal Docker-networking concern (how the control plane's own container reaches sibling containers), not something a deployer chooses, unlike the public host a client actually connects to.

**TLS itself is a create-time-only choice**, not a live toggle on a running instance — turning it on later means new certs mounted in and the engine restarted with different flags, the same "say what's not live and why" honesty this codebase already applies to disk not being live-resizable. `createInstance` accepts an optional `tls` flag (falling back to the deployment default), silently no-ops for engines with no `manifest.tls` (Redis, ClickHouse) rather than erroring — asking for TLS on an engine that doesn't support it yet is a reasonable thing to try, not a mistake worth failing the whole create over. `createBranch` carries the source instance's TLS setting forward to its clone, rather than defaulting it away.

**Setup wizard and Settings** (`AuthPage.tsx`, `Settings.tsx`, `routes/settings.ts`): the mandatory first-boot flow (§22) grew a first step — "where does this deployment live" (IP or domain, plus a default-TLS checkbox) — before the existing superadmin-creation step, with a one-click "skip, just use localhost, no TLS" for anyone trialing locally who doesn't have a real deployment question yet. `GET/PATCH /api/deployment-settings` mirrors the existing pre/post-setup auth pattern exactly: reachable unauthenticated only while `needsSetup()` is true (same reasoning as `/auth/signup` itself), `requireSuperadmin()`-gated the moment the first account exists. Everything set in the wizard is editable afterward from a new "Deployment" panel in Settings, including a CA-certificate download button — never reachable from anywhere that isn't superadmin-gated once an account exists.

**UI polish pass — a persistent sidebar, not more panel tweaks**: per the explicit brief ("bit form-like... like Mongo or Supabase... but not that complex for people"), the single highest-leverage change was structural, not decorative — the scrolling `.topbar` (`App.tsx`) became a fixed-position `.sidebar` (Databases/Settings nav, account email, theme toggle, all pinned while `.content` scrolls independently), collapsing to a horizontal bar under 760px rather than disappearing. Deliberately only two nav destinations — this product doesn't have more top-level sections to hang on a sidebar, and adding chrome for navigation that doesn't exist would be exactly the complexity the brief was warning against, not less of it. The instance-creation flow got one new "Use TLS" checkbox above the engine cards (seeded from the deployment default, not a per-engine form), with a plain "no TLS yet" note on Redis/ClickHouse cards when it's checked — honest about the scope cut instead of silently ignoring the toggle.

**Verified live in a real browser**, not just the test suite: both dev servers started against a real (temporary) SQLite data dir, driven end-to-end with Playwright against the pre-installed Chromium — the two-step setup wizard (deployment settings → superadmin creation, including the skip path), the TLS default correctly carrying from the wizard into the Dashboard's checkbox and into Settings' Deployment panel, and the new sidebar layout at both a normal desktop width and a 500px narrow one (confirming the responsive collapse actually works, not just that the media query exists). Screenshots taken and reviewed at each step, not just "it didn't crash."

**Real Docker-container TLS integration tests** (`engines.integration.test.ts`, gated behind a reachable Docker daemon — this sandbox has none, same gap noted for every prior Docker-gated feature in this plan, closed once these run in CI): creates a TLS-enabled Postgres/MySQL/MongoDB instance each, waits for it to reach `running` (which itself proves the control plane's own probe connection completed a real TLS handshake and query, not just a bare TCP connect — `waitForAdapterReady` runs a live query through the TLS-suffixed connection string before an instance is ever marked ready), asserts the returned connection string carries the right TLS marker for each engine, and runs a real query over the encrypted connection. A separate test proves Redis silently ignores `tls: true` (`tlsEnabled: false` in the response) rather than failing the create. Plus non-Docker unit tests for the pieces that don't need a real engine at all: `tls.test.ts` proves the CA is generated once and reused (not regenerated per call), the private key is written `0600`, a leaf cert genuinely verifies against the CA's public key (`forge`'s own `certificate.verify()`, not just "no exception was thrown"), and SAN entries are correct for both IP and domain hosts; `tls.test.ts` also round-trips `buildTarArchive`'s output through a hand-written USTAR reader to confirm the format is actually correct, not merely "accepted by the one library that wrote it"; `settings.test.ts` and `settings-env-override.test.ts` cover IP/domain validation, partial-patch behavior, and — in a separate test file, since the env var is read once into a module-level constant at import time — that `WHARF_PUBLIC_HOST` really does override a DB-backed value set afterward, not just before it.

**Verified before pushing**: `npm run typecheck`, `npm run build`, and `npm test` pass locally for both workspaces — the control-plane suite grew to 122 tests (115 passing without Docker, 7 Docker-gated and expected green in CI, which has both a real daemon and unrestricted registry access this sandbox doesn't).

## 26. Instance page UI pass: real underline tabs, an editor-grade query box, and a round of real bug fixes

Asked directly, after §25's sidebar pass: the product still read as "too less" and "form-like" — specifically the instance page, which PLAN.md has called "the actual product" since §2. Not a request for more decoration; a request for the parts that actually behave like an editor and a real navigable page, not a form.

**Advanced view: seven stacked panels became five real sub-tabs** (`InstancePage.tsx`): Metrics/Configuration/Resize (**Overview**), Branching + Backups (**Backups & branching**), API tokens (**Access**), the audit log (**Activity**), and container logs (**Logs**) — previously one long scroll with no navigation at all inside "Advanced." Built on a new generic `TabBar<T>` component, reused for both this and the existing Simple/Advanced switch, which itself got a real look: `.tabs` used to be two bordered buttons sitting above a divider; it's now an actual underline tab bar (active tab's border sits flush against the bar's own border, the same shape an IDE's panel tabs or a spreadsheet's sheet tabs use), with a smaller `.tabs-sub` variant for the new Advanced-internal bar. Deliberately no new data-fetching logic — every section's existing polling interval is untouched, this is a rendering-only restructure, so there was no risk of silently changing what stays fresh in the background.

**The query box became an actual editor, not a bare `<textarea>`** (`QueryEditor` in `InstancePage.tsx`, new `queryHistory.ts`): a line-number gutter that scrolls in lockstep with the text (a second scrollable element kept in sync via `onScroll`, not CSS alone), Cmd/Ctrl+Enter to run without leaving the keyboard, Tab inserting two spaces instead of jumping focus to the next control, a small per-instance query history (`localStorage`, capped at 8, most-recent-first) surfaced as a dropdown, and a result meta line ("N rows · M ms") using client-side wall-clock timing around the API call — not a false claim of server-side execution time, just an honest round-trip measurement, same as any browser devtools network tab would show. Deliberately no syntax highlighting or autocomplete: those need a real grammar per engine (SQL dialect differences, Mongo's JSON-shaped filters, Redis commands) to do honestly, which is a bigger feature than this pass — this is the editor chrome that's true regardless of language.

**A real bug found by the verification pass, not by inspection**: the query history dropdown never actually appeared after running a query — its `useEffect` only read `localStorage` once, on mount (`[historyKey]` as its only dependency), so the parent's post-run write to `localStorage` never triggered a re-read. Caught because the Playwright script tried to click a "History" button that legitimately wasn't there yet; fixed by also re-reading whenever `running` flips back to `false` (a run just finished), not only when the instance changes.

**A second real bug, pre-existing and unrelated to this pass's own new code**: the table/collection-name input in the "Import CSV/JSON" row (`.import-target`) had no `background`/`border`/`border-radius` rule of its own — it had been silently rendering as a bare, unthemed browser-default input this whole time, and at the sidebar's original 190px width it was narrow enough to clip its own placeholder text down to "table nar". Fixed by giving it the same themed-input treatment every other text input in the app already has, and widening the browse sidebar column (190px → 220px) plus stacking the input and the import button vertically instead of squeezing them side by side.

**Small consistency fixes alongside the structural work**: the theme toggle's ☾/☀ unicode glyphs and the filter-builder's × became real inline SVG icons (a moon/sun pair and an X respectively), matching the custom-iconography direction already flagged as worth doing in an earlier design pass and never gotten to; a new `LockIcon` badges TLS-enabled instances right in the page header; result tables got subtle zebra striping (explicitly excluded from rows currently in edit mode, so the highlight for "you're editing this one" can't lose a specificity fight against alternating-row shading); toasts became click-to-dismiss instead of only auto-expiring after 3.5s.

**Verified live in a real browser**, not just by reading the diff: Playwright against the pre-installed Chromium, using request interception to serve a fake running Postgres instance's API responses (this sandbox still has no Docker daemon) — typed a 3-line query and confirmed the gutter showed exactly 3 line numbers, fired Ctrl+Enter and confirmed a result rendered with the right row-count/timing meta line, opened the history dropdown and confirmed the just-run query was in it (which is what caught the stale-history bug above), and walked all five Advanced sub-tabs confirming each rendered its own panel and nothing from the others leaked through. Screenshots taken and reviewed at every step, including the specific before/after of the `.import-target` fix.

**Verified before pushing**: `npm run typecheck`, `npm run build`, and `npm test` pass locally for both workspaces (control-plane untouched by this pass — its own 122 tests still pass unchanged, confirming this was genuinely UI-only).

## 27. Second design pass: the product still read as consumer/editorial, not SaaS

Asked directly, in the strongest terms yet ("such a kid like website"): §24's redesign and §26's structural pass hadn't actually fixed the core issue — the visual language itself. Worth naming plainly what was wrong rather than reflexively re-skinning: a warm cream background, a serif display face (Fraunces) on every heading, big soft blurred shadows, generous rounded corners, and a bouncy hover-lift on cards reads as consumer/editorial/lifestyle-brand — closer to a recipe blog or a boutique product page than the tight, neutral, information-dense look actual B2B SaaS dashboards (Linear, Vercel, Stripe's own dashboard, Supabase, Datadog) share. None of that is about the accent hue; it's the whole visual grammar.

**What changed, systemically, not cosmetically** (`web/src/styles.css`'s `:root` tokens, `web/index.html`'s font load): since the whole app is CSS-variable-driven, a token-level rewrite propagates everywhere without hunting down individual rules.
- **Typography**: dropped Fraunces from the product entirely — `--font-display` now just aliases `--font-sans`, and the sans itself became Inter (loaded from Google Fonts in place of Fraunces) rather than Public Sans, since Inter is the de facto typeface of this exact category of product. Headings got smaller and tighter (`.hero h1` 30px→22px, `.instance-header h1` 24px→20px, `.auth-card h1` 22px→19px, `h2` 15px→13px), heavier (weight 700, up from 600), and gained negative letter-spacing (-0.02em) — a functional dashboard title, not an editorial greeting.
- **Palette**: light mode's warm cream (`#f7f4ec`) became a cool neutral gray (`#f7f8fa`); text, borders, and muted colors all moved from warm-tinted to cool-neutral slate values; the amber accent itself got more saturated and precise (`#b9762a` → `#d97706`) rather than muted/brownish, and its dark-mode counterpart likewise (`#e8a33d` → `#f0a030`). Dark mode needed smaller adjustments — its navy base already read reasonably close to Linear/Vercel's own dark themes — mostly the same accent/shadow tightening applied for consistency between themes.
- **Shape and motion**: radii tightened across the board (`--radius-sm/‑/‑lg`: 5/8/10px → 4/6/8px) — soft, large rounding reads as a friendly consumer app, tight rounding as a serious tool. Shadows went from a big soft 24px-blur glow to a thin, precise `0 1px 2px / 0 2px 8px` — the difference between "floating card" and "flat surface with a hairline edge," which is what the reference products actually use. Card hover states dropped their bouncy `translateY` lift in favor of a static border/shadow change — motion on hover reads playful; SaaS surfaces mostly don't move.
- **Density**: `.panel` padding/margin, `.engine-card` padding/sizing, and the base `button` rule (added explicit `font-weight: 500`, `font-size: 13px`, tightened padding) all pulled in — the earlier pass still had noticeably more breathing room than the reference dashboards, which pack more into the same vertical space.
- Base button hover no longer flashes the accent color on every secondary/ghost button (`border-color: var(--accent)` → `var(--muted)`) — reserving color for actual primary actions and active states is part of what makes those reference dashboards feel controlled rather than busy; the sidebar/auth wordmark similarly moved from accent-colored to neutral text, leaving color to the logo mark alone.
- Favicon and `theme-color` meta updated to match the new dark-navy/amber values so the browser chrome doesn't visibly mismatch the app.

**What deliberately didn't change**: `landing/` (the separate marketing site) still uses Fraunces and the original warm palette — untouched by this pass. A crisp, neutral, functional app paired with a more expressive marketing page is itself a common, legitimate SaaS pattern (compare Stripe's own marketing site to its dashboard), not an inconsistency to fix reflexively; if the user wants the landing page brought in line too, that's a separate, explicit ask.

**Verified live in a real browser**, both themes: Playwright against the pre-installed Chromium walked the setup wizard, Dashboard (light and dark), Settings, and the instance page's Simple/Advanced views (via the same request-interception technique used in §26, since this sandbox still has no Docker daemon) — confirmed the new palette, type scale, and density render as intended in both themes, not just in the light-mode screenshot that's easiest to eyeball.

**Verified before pushing**: `npm run typecheck` and `npm run build` pass for web; control-plane untouched by this pass.

## 28. Third pass: what §27's token rewrite didn't catch

Asked directly, again: the Dashboard specifically still read as "kid-like," with an explicit "I like simple, make it nice" — meaning don't add clutter, make what's there better. §27 fixed the systemic stuff (palette, type, radii, shadows) but left three concrete, specific tells standing, found by actually looking at fresh screenshots side by side rather than assuming the token rewrite was sufficient on its own.

- **The logo had a literal wavy-water squiggle under the dock piers** (`Logo.tsx`, third `<path>`) — a classic illustrative/storybook technique, and arguably the single biggest "kid-like" tell in the whole app, since it's the one mark visible on every page. Removed it entirely; the piers-and-deck shape alone reads as equally "dock" and as an abstract bar-chart glyph, which is the more restrained version of the same idea. The favicon in `index.html` already only had the piers (never had the wave), so no change needed there.
- **Every boolean setting (TLS default, in three places: Dashboard, the setup wizard, Settings) rendered as a bare, unstyled OS checkbox** — browsers' default checkbox chrome is one of the most reliable "this wasn't designed" tells there is. Restyled `.checkbox-row input[type="checkbox"]` into a real toggle switch via `appearance: none` plus a positioned `::before` thumb — same underlying `<input type="checkbox">`, same keyboard/accessibility behavior, different paint. Found and removed a real specificity bug while doing this: `.auth-card form label.checkbox-row input[type="checkbox"] { width: auto; margin: 0; }` was more specific than the new toggle rule and would have silently reverted the setup wizard's TLS toggle back to a tiny default checkbox while everywhere else got the new switch — caught by checking the auth screen specifically, not assumed fine because Dashboard's toggle looked right.
- **The engine cards were plain text with no visual anchor** — name, version, and an amber "Create instance →" link, nothing else. Rather than hand-drawing five per-engine mini-logos (a real risk of landing right back in "cartoonish," the opposite of the goal, and of imitating five different trademarks badly), every card got the same single, restrained glyph — a standard stacked-cylinder "database" icon in a small muted badge — consistent, quiet, and reads as considered without reaching for personality the cards don't need.

**Verified live in a real browser**, both themes: Playwright screenshots of the Dashboard and a zoomed crop of both the logo mark and the toggle switch (off and on) in isolation, specifically to check the pixel-level details rather than judging from a full-page screenshot at a glance.

**Verified before pushing**: `npm run typecheck` and `npm run build` pass for web; control-plane untouched.

## 29. A dedicated Data tab, and a Dashboard that isn't an empty canvas

Asked directly: split the data browser (table list, filters, row editing, the query editor) out of the Simple view into its own full-fledged page, keep Ask your data on the Simple view only, and improve the Dashboard's layout while staying simple.

**Instance page went from two top-level views to three** (`InstancePage.tsx`): Simple now holds only Connect and Ask your data — genuinely simple, a quick orientation view — and everything data-browsing-related (the table/collection list, the filter builder, editable rows, the query editor) moved to a new **Data** tab of its own, using the same `TabBar` component the Simple/Advanced switch already used. This wasn't just moving JSX: `BrowsePanel`'s wrapping `<section className="panel">` (a bordered card sized like every other small panel on the page) became `.browse-workspace`, a full panel-styled container that's the *entire* content of its tab rather than one of three stacked sections competing for room — the object list and row table both grew from fixed pixel caps (340px/380px) to `60vh`, and the page's overall content width grew (`--content-inner` 860px → 1040px) specifically so a real table with a realistic number of columns has room to breathe. The "Browse data" heading was dropped — redundant once the tab label itself says "Data."

**Dashboard got a compact stats strip**, not a bigger rewrite — three tiles (Databases / Running / TLS-enabled) between the hero and the engine-card grid, reusing the exact `.metric` tile styling already built for the instance page's own Metrics panel rather than inventing new visual language. Shown only once at least one instance exists — a fresh empty install doesn't need three tiles all reading "0," that reads emptier, not fuller. This is deliberately the smallest change that answers "the layout still feels like an empty canvas": real information, not decoration, and gone the moment it isn't useful.

**Verified live in a real browser**: Playwright with request interception standing in for a real (Docker-free) instance and its data — caught and fixed a bug in the *test setup* along the way, not the app: an over-broad `/api/config` mock hardcoded `needsSetup: false`, which meant the setup wizard's `needsSetup: true` fresh-instance path never rendered during the test and every login attempt failed with "invalid email or password" against an account that had never actually been created. Once fixed (stop mocking `/api/config`, let the real server answer it), the run showed exactly what was asked for: Simple with only Connect + Ask, a Data tab with the table list, filter builder, editable rows, and query editor all with real room, and a Dashboard stats strip that reads as considered rather than sparse.

**Verified before pushing**: `npm run typecheck` and `npm run build` pass for web; control-plane untouched by this pass.

## 30. A real create form, with an Auto path preserved for anyone who doesn't want one

Asked directly: creating a database should be able to take real inputs (name, and so on) rather than always auto-generating one — but keep a one-click "Auto" path available too, explicitly named for the "vibe coder" persona this product has targeted since §5.

**Two paths, one toggle, not two different flows to maintain** (`Dashboard.tsx`): a new **Auto** switch sits next to the existing TLS one, defaulting **on** — clicking an engine card behaves exactly as it always has (instant creation, a generated name, the current TLS default), so nobody who's used this before sees any change unless they go looking for one. Turning Auto off changes what a card click *does*, not what it *is*: the same click now opens `CreateInstanceModal` — name (editable, still pre-filled with a sensible generated default so an empty field never blocks creation), version (a real `<select>` from the engine's own supported list, only shown when there's more than one to choose from), and TLS (seeded from the deployment default, disabled with an explanatory `title` for engines that don't support it yet) — before calling the same `createInstance` function either path ends up at. The card's own CTA text reflects which mode is active ("Create instance →" vs "Configure →"), so the button's behavior is never a surprise.

Persisted per-browser (`localStorage`, not a deployment setting) since it's a personal workflow preference, not something one person should be able to change for everyone else on a shared instance.

**Verified live in a real browser**: Playwright with request interception on `POST /api/instances` specifically to inspect the actual payload each path sends, not just that a click "did something" — confirmed Auto-on sends a generated name and closes with no modal ever appearing, and Auto-off opens the modal, accepts a real typed name, and sends exactly that name plus the selected version and TLS choice.

**Verified before pushing**: `npm run typecheck` and `npm run build` pass for web; control-plane untouched by this pass.

## 31. Publish pre-built images to GHCR on release tags, so self-hosting needs no build step

Asked directly: can Docker images ship straight from this repo, without anyone needing to compile/build on the machine they're deploying to? Asked as a follow-up to a real question about GitHub Pro/Docker hosting — the actual need underneath both was "no build step for self-hosters," which GitHub Actions + GitHub Container Registry (GHCR) solves directly, no paid plan required (GHCR is free for public images, and Actions minutes are free on public repos).

**Tag-triggered, not on every push to main** — asked and confirmed directly rather than assumed: `.github/workflows/publish.yml` fires only on `push: tags: ["v*.*.*"]`, so cutting a version tag is what publishes a release; ordinary commits to `main` build and test (`ci.yml`, unchanged) but never publish an image. Two images, one workflow via a build matrix (`wharf-control-plane` from `control-plane/Dockerfile`, `wharf-web` from `web/Dockerfile`, both already-existing multi-stage builds from earlier in the project — nothing new to build, just somewhere new to send the result). `docker/metadata-action` derives tags from the pushed git tag (`v1.2.3` → `1.2.3`, `1.2`, and `latest`), so `docker pull .../wharf-web:latest` always means "the newest release," and a specific version stays pullable forever after. Auth is the workflow's own `GITHUB_TOKEN` (`permissions: packages: write`) — no registry secret to create or rotate.

**`deploy/docker-compose.yml` now pulls by default** instead of building: `image: ghcr.io/${WHARF_IMAGE_OWNER:-drk1rd}/wharf-control-plane:${WHARF_VERSION:-latest}` (and the `wharf-web` equivalent), so the quickstart in the README is now `docker compose up` with no `--build` and no repo checkout required beyond `deploy/docker-compose.yml` itself. The from-source path didn't disappear, it moved: `deploy/docker-compose.build.yml` is a small overlay (`docker compose -f docker-compose.yml -f docker-compose.build.yml up --build`) that resets `image:` back to the original `build:` blocks via Compose's `!reset` merge tag — for local development, or for anyone deploying before the first release tag exists yet.

**One caveat that can't be automated away, flagged in both the README and here**: GHCR packages published via a workflow's default `GITHUB_TOKEN` come out **private** on their very first publish, regardless of the repository's own visibility — there's no API flag in `docker/build-push-action` or `docker/login-action` that sets initial package visibility. The first time `publish.yml` ever runs, a human has to flip it to Public once by hand (repo → **Packages** tab → the package → Package settings → Change visibility). Every publish after that stays Public. Deliberately not "solved" by e.g. a follow-up API call from the workflow using the same token — GHCR's own docs are explicit that visibility changes need a PAT with `packages:manage` scope that a workflow's ambient `GITHUB_TOKEN` never has, so working around that would mean asking the user to mint and store a broader long-lived token just to avoid one manual click after the very first release. Not worth the extra secret.

**No tag pushed by this work** — cutting the first `v0.1.0` (or whatever's chosen) is the user's own release decision, not something to do unprompted from inside a feature-build task. The workflow is ready and waiting; it publishes nothing until someone tags a release.

**Verified**: both compose files validated with `docker compose config` (daemon-independent — parses and merges the YAML without needing a running Docker daemon, which this sandbox doesn't have) — confirmed the base file resolves to `image:` references with the right defaults, and confirmed the build overlay correctly resets each service back to its original `build:` block with no `image:` key left over. `publish.yml` itself can only be fully exercised by an actual tag push, which is out of scope for this task per the point above; its structure (checkout → login → metadata → buildx → build-push) matches the same pattern `ci.yml` already uses successfully for checkout/setup-node, just extended with the registry-specific actions.
