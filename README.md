# Wharf

**Where your data docks.** Spin up a database, get a URL, look at your data — in one place, done exceptionally well.

Open source. Self-host it on your own infrastructure or point it at a Docker daemon anywhere. Every instance adapts to who's looking at it: a **Simple** view (connection URL, `.env` snippet, browse button) by default, an **Advanced** view (metrics, logs, config, backups) one click away — same instance, not two products.

Ships **PostgreSQL, MongoDB, MySQL, and Redis**. See [`PLAN.md`](./PLAN.md) for the full product plan, the competitive reasoning behind the scope, and an honest go/no-go assessment.

> This repo was previously named `alldb`; the product is now called **Wharf**. The git repository name is unchanged.

## Quickstart (self-host)

Requires Docker and Docker Compose.

```bash
cd deploy
docker compose up --build
```

- Web UI: http://localhost:5173
- API: http://localhost:8080

Open the UI, click a database engine to create an instance, and within ~10–30 seconds you'll have a connection URL and a data browser for it.

By default the API is **unauthenticated** — fine for local/dev use on a machine you trust. Before exposing this to a network, set `WHARF_TOKEN` (see `deploy/docker-compose.yml`) and pass the same value as the `x-wharf-token` header / `WHARF_API_URL`+`WHARF_TOKEN` env vars to the CLI.

To enable **Ask your data** (ask a database question in plain English instead of writing SQL/Mongo queries by hand), set `ANTHROPIC_API_KEY` on the control plane. It's off by default — the UI shows a hint instead of the input box until it's configured. `WHARF_ASK_MODEL` overrides the model (default: Anthropic's current recommended model).

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
node cli/bin/wharf.js create postgres
node cli/bin/wharf.js list
node cli/bin/wharf.js url <instance-id>
node cli/bin/wharf.js rm <instance-id>
```

Set `WHARF_API_URL` (default `http://localhost:8080`) and `WHARF_TOKEN` if auth is enabled.

## Repository layout

```
control-plane/   API server, SQLite metadata store, Docker provisioner, data-browser adapters
web/             React/Vite UI — create flow, Simple/Advanced instance views
cli/             `wharf` command-line client
deploy/          docker-compose.yml self-host quickstart
PLAN.md          product plan, competitive reasoning, roadmap, honest scoring
```

## Status

Postgres, MongoDB, MySQL, and Redis, single Docker driver, no auth beyond an optional shared token, vertical-scaling-only — working end to end: create, connect, browse, run queries, live metrics, logs. Confirmed with a real `docker compose up --build` on real hardware, not just in the build sandbox. Backup/restore works for every engine except Redis (no clean stdin-restore path for an RDB dump — see `PLAN.md` §6.2a). Not yet built: Kubernetes driver, MCP/AI-agent server, billing, multi-user auth. See `PLAN.md` §13–14 for what's deliberately deferred and why.
