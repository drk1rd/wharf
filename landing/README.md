# Wharf landing page

A single self-contained static page (`index.html` + `assets/`) — no build step, no framework, no dependency on the rest of this monorepo. It's the marketing front door for the project, separate from `web/` (the actual product UI).

## Preview locally

```bash
cd landing
python3 -m http.server 4321
# open http://localhost:4321
```

Any static file server works — there's nothing to build.

## Deploy

Point any static host at this directory as the site root:

- **GitHub Pages**: repo Settings → Pages → deploy from a branch, folder `/landing` (or push this folder's contents to a `gh-pages` branch).
- **Vercel / Netlify / Cloudflare Pages**: set the project root to `landing/`, leave the build command empty, output directory `.`.
- **Anything else**: it's two files and an `assets/` folder — `scp` it to any web server's document root and it works.

## Editing

Everything is in `index.html` — content, styles, and the one small copy-button script are inline by design, so the whole page stays a single file to review or diff. Fonts load from Google Fonts (the only external request the page makes); screenshots live in `assets/` and are copies of `docs/screenshots/` at the repo root — update both places if the product UI changes enough to make them stale.
