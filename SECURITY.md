# Security Policy

Wharf provisions and runs real database containers with real credentials on whatever host it's deployed to — security issues here can matter a lot more than in a typical web app. Please report them responsibly.

## Reporting a vulnerability

**Please don't open a public GitHub issue for a security vulnerability.**

Use GitHub's private vulnerability reporting instead: go to this repository's **Security** tab → **Report a vulnerability**. That opens a private disclosure thread visible only to the maintainers, and is the preferred channel for anything that could put a running deployment at risk before a fix ships.

If you can't use that flow for some reason, opening a regular issue with as few exploit details as possible (just "there's a security issue in X, please contact me") and waiting for a maintainer to reach out privately is the fallback — please still avoid posting exploit details publicly.

Please include, as far as you can:

- What the issue is and its likely impact (e.g. cross-instance data access, credential exposure, container escape, injection).
- Steps to reproduce, or a proof of concept.
- Which version/commit you tested against.

This is a young, largely solo-maintained project — there's no guaranteed response SLA yet, but security reports get priority over everything else.

## Scope

In scope: the control plane (`control-plane/`), the web UI (`web/`), the CLI (`cli/`), and the self-host deployment config (`deploy/`). Vulnerabilities in the upstream database engine images themselves (Postgres, MongoDB, MySQL, Redis, ClickHouse) are out of scope here — report those to the respective upstream project.

## Known, documented gaps

Some things are deliberately not built yet, and are already written down rather than hidden — see `PLAN.md` §10 ("Security & isolation"). As of this writing, that includes: no encryption at rest for the SQLite metadata store, and self-hosting relies on whatever TLS termination you put in front of it (Wharf doesn't run its own gateway/TLS termination). These are real gaps, not solved problems — please don't report them as new findings, but do flag it if you find a way to actually exploit one of them.

## Supported versions

Pre-1.0, single rolling `main` branch — there's no LTS/backport policy yet. Fixes land on `main` and self-hosters should stay reasonably current.
