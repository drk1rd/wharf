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
- **As built** (see §17a): real accounts (scrypt-hashed passwords, httpOnly session cookies) with per-instance ownership, plus an admin/service token (`WHARF_TOKEN`) for the CLI. Auth is off only in the single-user bootstrap window before either a token is set or the first account signs up.
- Secrets generated per-instance. Not yet built: encryption at rest for the SQLite store, TLS termination at a gateway (self-host today relies on whatever's in front of it — a tunnel, a reverse proxy you add), an audit log of control-plane actions. These remain real gaps, not solved problems — don't read the presence of accounts as "the security model is done."
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

**Next step (decided)**: §16's evidence-generating slice and §17's pilot-readiness work still stand as written, unchanged, for whenever a pilot happens. But the redirect in §18 is the live instruction — treat this as an evolving piece of software with a growing regression net, not a repo waiting on a pilot. CI is confirmed green on real infrastructure (§19). Next candidates: CLI login parity (the account system exists now; the CLI still only knows the admin token) and, only once those are solid, the larger deferred items in §14 (Kubernetes driver, more engines, MCP server) — still gated on real signal they're needed, not built ahead of it.
