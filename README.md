# Wharf

**Where your data docks.** Spin up a database, get a URL, look at your data — in one place, done exceptionally well.

[![CI](https://github.com/drk1rd/alldb/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/drk1rd/alldb/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
![Postgres · MongoDB · MySQL · Redis · ClickHouse](https://img.shields.io/badge/engines-Postgres%20%C2%B7%20MongoDB%20%C2%B7%20MySQL%20%C2%B7%20Redis%20%C2%B7%20ClickHouse-informational)

[Landing page source](./landing) (not yet deployed to a live URL — see `landing/README.md` to preview or deploy it) &middot; [Contributing](./CONTRIBUTING.md) &middot; [Security policy](./SECURITY.md)

![Wharf dashboard](./docs/screenshots/dashboard.png)

Open source. Self-host it on your own infrastructure, or run one shared instance and give people accounts on it — same product either way. Every instance adapts to who's looking at it: a **Simple** view (connection URL, `.env` snippet, browse button) by default, an **Advanced** view (metrics, logs, config, backups) one click away — same instance, not two products.

![Wharf instance page](./docs/screenshots/instance-simple.png)

Ships **PostgreSQL, MongoDB, MySQL, Redis, and ClickHouse**, real user accounts, live CPU/memory resize with no restart, CSV/JSON export, and an **Ask your data** natural-language query box backed by [OpenRouter](https://openrouter.ai) with your choice of model. See [`PLAN.md`](./PLAN.md) for the full product plan, the competitive reasoning behind the scope, and an honest go/no-go assessment.

> This repo was previously named `alldb`; the product is now called **Wharf**. The git repository name is unchanged.

## Quickstart (self-host)

Requires Docker and Docker Compose.

```bash
cd deploy
docker compose up --build
```

- Web UI: http://localhost:5173
- API: http://localhost:8080

The first thing you'll see is a **"Create your superadmin account"** screen — Wharf requires this before anything else works, on every fresh instance. That account gets full management access to every database and every other account created afterward (see Settings → Users once you're in). There's no anonymous or single-user mode to opt out of; every request needs a real session or the `WHARF_TOKEN` admin credential, from the very first request onward.

Once that's done, click a database engine to create an instance — within ~10–30 seconds you'll have a connection URL and a data browser for it.

To enable **Ask your data** (ask a database question in plain English instead of writing SQL/Mongo queries by hand), set `OPENROUTER_API_KEY` on the control plane. Off by default — the UI shows a hint instead of the input box until it's configured. Each signed-in user picks their own model from OpenRouter's live catalog in Settings (or inline per question); there's no single hardcoded model.

## Running a small pilot (letting a few people try it)

1. **Set `WHARF_MAX_INSTANCES`** (e.g. `10`) so one enthusiastic tester can't exhaust the host by creating instances in a loop. On its own this only caps *count* — live resize (below) still lets any single instance grow to 16 cores / 32GB, so also set **`WHARF_MAX_TOTAL_CPU`** (cores) and/or **`WHARF_MAX_TOTAL_MEMORY_MB`** to cap the combined cpu/memory reserved across every instance on the host. Both are enforced on create *and* resize; either is optional and unset means no limit on that dimension.
2. **Have testers sign up for real accounts** rather than sharing one login — each account only sees its own instances (plus anything created before any account existed). You're already the superadmin from completing the initial setup step, so you can see and manage everything by default; set `WHARF_TOKEN` too if you also want an admin/CLI bypass that doesn't need a browser session.
3. **Expose it** — the fastest path for a handful of people is a tunnel from a machine you already have (`docker compose up` locally, then `cloudflared tunnel --url http://localhost:5173` or `ngrok http 5173` for a public HTTPS URL), rather than standing up new cloud infra for a short pilot. Set `WHARF_COOKIE_SECURE=true` once it's served over HTTPS so session cookies get the `Secure` flag.

See `PLAN.md` §17 for the full reasoning and what's still deliberately *not* built (billing, org/team accounts, an onboarding flow).

## Local development (without Docker Compose)

Run the control plane directly against your local Docker daemon:

```bash
npm install
npm run dev:control-plane   # http://localhost:8080, needs /var/run/docker.sock
npm run dev:web             # http://localhost:5173, proxies /api to :8080
```

## CLI

```bash
npm install --workspace cli
node cli/bin/wharf.js signup            # first time on a fresh instance — becomes its superadmin
node cli/bin/wharf.js login             # afterward, or on any other machine
node cli/bin/wharf.js create postgres
node cli/bin/wharf.js list
node cli/bin/wharf.js url <instance-id>
node cli/bin/wharf.js rm <instance-id>
node cli/bin/wharf.js whoami
node cli/bin/wharf.js logout
```

The CLI has a real login of its own — `wharf login`/`signup` authenticate as an actual account (email/password, prompted interactively with the password masked, or via `WHARF_EMAIL`/`WHARF_PASSWORD` for scripts) and store a session locally at `~/.wharf/sessions.json` (`0600`, keyed by `WHARF_API_URL` so logins to different Wharf instances don't collide). It sees exactly what that account would see in the web UI — a superadmin sees everything, a regular account sees its own instances.

Setting `WHARF_TOKEN` still works exactly as before — an admin/service credential (`WHARF_API_URL`, default `http://localhost:8080`) that always sees every instance and takes precedence over any saved login session for as long as it's set, so CI/automation using `WHARF_TOKEN` is never silently affected by a session saved on that machine.

**Scoped tokens.** Any instance's Advanced view can mint a token bound to just that one instance — read-only (view data, no queries/resize/backup/restore/delete) or read-write (everything except creating instances or managing its own tokens). It's a normal `x-wharf-token` value, so `WHARF_TOKEN=<scoped token> node cli/bin/wharf.js ...` gets the CLI a narrower, single-instance credential with no code changes — useful for CI or a script that should only ever touch one database.

## Repository layout

```
control-plane/   API server, SQLite metadata store, Docker provisioner, data-browser adapters, accounts/sessions
web/             React/Vite UI — accounts, Settings, create flow, Simple/Advanced instance views
cli/             `wharf` command-line client (admin/service token)
deploy/          docker-compose.yml self-host quickstart
landing/         self-contained static marketing page — see landing/README.md to preview or deploy
PLAN.md          product plan, competitive reasoning, roadmap, honest scoring
.env.example     every control-plane environment variable, documented, all optional
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the dev workflow, how to add a new engine, and pre-PR checks; [`SECURITY.md`](./SECURITY.md) for reporting vulnerabilities privately; [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) for community expectations.

## Status

Postgres, MongoDB, MySQL, Redis, and ClickHouse, single Docker driver — working end to end: create, connect, browse, run queries, live metrics, logs, CSV/JSON export, and live CPU/memory resize (no restart). Backup/restore works for every engine, including Redis and ClickHouse — neither fits the exec-based dump/restore the other three use, so they back up via their protocol client directly (Redis: per-key `DUMP`/`RESTORE`; ClickHouse: schema + `JSONEachRow` data over its HTTP interface). Real user accounts (signup/login/sessions) with per-user instance ownership, plus an admin/service token for the CLI.

A further nine-feature round shipped on top of that (see `PLAN.md` §20 for the full write-up, including two real bugs CI found): sample data seeded into every fresh instance, framework connection snippets in the Connect panel, CSV/JSON import, scheduled/automated backups, scoped per-instance API tokens (read or read-write, bound to one instance), an audit log of every mutating action, resource/slow-query webhook alerting, database branching (instant clone via dump-and-restore into a fresh instance), and an auto-generated REST API per table (`GET/POST/PATCH/DELETE /instances/:id/api/:table`, Postgres/MySQL/ClickHouse) — plus an aggregate host-wide CPU/memory budget (`WHARF_MAX_TOTAL_CPU`/`WHARF_MAX_TOTAL_MEMORY_MB`) so live resize can't let every instance on a host overcommit it together.

A real test suite and CI run on every push — real Postgres/MySQL/MongoDB/Redis/ClickHouse containers in CI, not mocks (see `PLAN.md` §18–20). Confirmed with a real `docker compose up --build` on real hardware, not just in the build sandbox. Not yet built: Kubernetes driver, MCP/AI-agent server, billing, org/team accounts. See `PLAN.md` §13–14 for what's deliberately deferred and why.

The repo itself is publish-ready: a filled-in `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `.env.example`, GitHub issue/PR templates, and a real `landing/` marketing page — see `PLAN.md` §21.

There's no more anonymous-access bootstrap window: every fresh instance requires a mandatory first-boot **superadmin setup** step before anything else works, and that account gets full platform-wide management — every database regardless of owner, plus a Users panel (Settings) to promote, demote, or delete other accounts. See `PLAN.md` §22.

The CLI has real login parity with the web UI now — `wharf login`/`signup`/`logout`/`whoami` against real accounts, not just the `WHARF_TOKEN` admin credential (which still works, and still takes precedence over a saved session when set). See `PLAN.md` §23.

The product UI carries the same visual identity as the landing page now — ink-navy/amber/teal, Fraunces/Public Sans/IBM Plex Mono, both light and dark themes designed as real themes rather than one inverted into the other — and the data browser got materially better: a filter builder (column/operator/value, AND-combined, real parameterized `WHERE` clauses — Postgres/MySQL/ClickHouse) and inline row editing (edit/delete/add for Postgres/MySQL, add-only for ClickHouse, reusing the auto-generated table API from task 22). See `PLAN.md` §24.

Database connections can be encrypted now — self-signed-CA TLS for **Postgres, MySQL, and MongoDB** (Redis and ClickHouse need bigger structural changes — a second TLS port, an XML config block — and are deliberately deferred), chosen per instance at create time. The first-boot setup wizard also collects where this deployment lives (an IP or a domain) and a default TLS setting for new databases, both editable afterward from Settings — including a CA certificate download, for anyone who wants to verify the connection fully rather than just encrypt it. The product UI also picked up a persistent sidebar in place of the old scrolling top bar, reading more like an actual product and less like a form. See `PLAN.md` §25.

The instance page went further still: the Advanced view's seven stacked panels became real sub-tabs (Overview, Backups & branching, Access, Activity, Logs) instead of one long scroll, the query box became an actual editor — line-number gutter, Cmd/Ctrl+Enter to run, Tab-to-indent, per-instance query history, row-count/timing feedback — and a couple of real pre-existing bugs got fixed along the way (a query-history dropdown that never refreshed, and an unthemed table-name input that was silently clipping its own placeholder text). See `PLAN.md` §26.

The product's visual language then got a harder second look: a warm cream background, a serif display face, big soft shadows, and generous rounded corners read as consumer/editorial rather than the tight, neutral, information-dense look real B2B SaaS dashboards share. Rewritten at the design-token level — a cooler neutral palette, one crisp sans typeface (Inter) throughout instead of a second display face, tighter radii and thinner shadows, denser panels, and a more saturated, precisely-used accent color. `landing/`'s separate marketing site keeps its original warm/serif identity on purpose. See `PLAN.md` §27.
