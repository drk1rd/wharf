# Contributing to Wharf

Thanks for looking at this. Wharf is a young project — the fastest way to help right now is real usage and real bug reports, but code contributions are welcome too. This doc covers the practical mechanics; for *why* things are built the way they are, see [`PLAN.md`](./PLAN.md).

## Before you start

- **Bug fix or small improvement?** Just open a PR — no need to file an issue first.
- **New engine, new feature, or anything that touches the extensibility contract** (`ServiceManifest` in `control-plane/src/manifests/types.ts`, or `BrowserAdapter` in `control-plane/src/browser/types.ts`)? Open an issue first to talk through the shape of it. These two interfaces are the whole extensibility story — getting them right matters more than getting a PR merged fast.
- **Something bigger** (a driver besides Docker, a new deployment mode, auth changes)? Same — open an issue first. See `PLAN.md` §14–16 for what's already been thought through and what's deliberately out of scope.

## Development setup

```bash
npm install
npm run dev:control-plane   # http://localhost:8080 — needs a local Docker daemon (/var/run/docker.sock)
npm run dev:web             # http://localhost:5173 — proxies /api to :8080
```

Copy [`.env.example`](./.env.example) to `.env` in `control-plane/` if you want to override any defaults (everything is optional).

Repository layout, plus what each piece owns, is in [`README.md`](./README.md#repository-layout).

## Before opening a PR

```bash
npm run typecheck   # both workspaces
npm run build        # both workspaces
npm test              # control-plane test suite
```

All three need to pass. CI (`.github/workflows/ci.yml`) runs the same checks against real Postgres/MySQL/MongoDB/Redis/ClickHouse containers on GitHub-hosted runners — if you're adding a control-plane feature that touches a database engine, add a real end-to-end test in `control-plane/src/__tests__/engines.integration.test.ts` (gated behind `dockerAvailable()`, so it skips gracefully wherever a Docker daemon isn't reachable — most local sandboxes included) rather than only a mocked/unit one. See `PLAN.md` §18 for why this project is strict about that: several real bugs (a container-readiness race, a foreign-key cleanup gap, two branching bugs) were only ever caught by a real container in CI, never by reasoning about the code.

## Adding a new database engine

This is the contribution shape the project is explicitly designed for. You need two files:

1. **A service manifest** (`control-plane/src/manifests/<engine>.ts`) — image, versions, ports, env/command, health check, connection-string template, and backup strategy (either an exec-based dump/restore command, or delegate to the adapter's `dumpAll`/`restoreAll` if the engine has no clean stdin/stdout dump path — see Redis and ClickHouse for that pattern).
2. **A data-browser adapter** (`control-plane/src/browser/<engine>.ts`) implementing `BrowserAdapter` — `listObjects`, `browseObject`, `runQuery`, `getSchemaContext`, plus whatever optional methods make sense for the engine (`importRows`, `seedSampleData`, `getRowById`/`updateRowById`/`deleteRowById` for the auto-generated table API — SQL engines only).

Register both in `manifests/registry.ts` and `browser/registry.ts`. Then add a real end-to-end test to `engines.integration.test.ts` — create, connect, browse, query, backup, at minimum.

## Code style

- No new comments unless they explain a non-obvious *why* — a hidden constraint, a workaround for a specific bug, something that would surprise a future reader. Don't restate what the code already says.
- Match the existing pattern in the file you're editing before introducing a new one. This codebase has fairly consistent conventions (see `respondError()` in `routes/instances.ts`, the `withClient`/`withConnection` helpers per adapter, dependency-injected functions like `runDueBackups(getInstance)` for testability) — consistency matters more than a personal preference.
- Don't add abstractions, config flags, or error handling for cases that can't happen. This project's own working style (documented throughout `PLAN.md`) is to build only what's needed and say plainly what's cut, not to build ahead of real need.

## Reporting bugs / requesting features

Use GitHub Issues. The templates ask for the practical details (engine, environment, steps to reproduce) — filling them in saves a round trip.

## Security issues

Do not open a public issue for a security vulnerability. See [`SECURITY.md`](./SECURITY.md).
