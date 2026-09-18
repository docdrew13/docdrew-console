# docdrew-console — project notes

Standing context for future Claude sessions working on this project. Read this first.

## What this is

A fully custom "Star Trek terminal" browser start page for Andrew, deployed on Netlify
with continuous deployment from GitHub.

- **Live site:** docdrew-console.netlify.app
- **Netlify site name:** docdrew-console (site id `e04c4a41-8937-496a-b1bb-34886b1293b0`)
- **GitHub repo:** docdrew13/docdrew-console, `main` branch, deploys automatically on push
- **This folder** (`~/Sites/docdrew-console`) is the real git working directory and the
  source of truth. Any cloud-workspace scratch copy (e.g. `/home/claude/docdrew-start`
  in a given session) is ephemeral and should be treated as untrustworthy/stale — always
  diff against this folder before editing, and never let a delivery from a stale copy
  overwrite a fix that was only applied here.

## Pages

Four static pages, each a large single-file HTML doc with inline CSS/JS:

- `public/index.html` — main English console
- `public/fr/index.html` — French console (mirrors index.html, translated strings)
- `public/for-peter/index.html` — preconfigured for Andrew's brother Peter (Wakefield, RI)
- `public/for-susie/index.html` — preconfigured for Susie (light theme — note different
  color literals in places, e.g. cloud-haze rendering uses `rgba(230,220,205,...)` here
  vs `rgba(205,222,230,...)` in the other three; always Read/Grep-diff before editing
  this file so per-page styling isn't clobbered)

These four files diverge in small, deliberate ways (labels, location, theme colors).
When making a change that should apply everywhere, edit all four and verify each one's
existing local variations are preserved, don't just copy one file over the others.

## Backend

- `netlify/functions/weather-grid.mts` — serverless function feeding the weather globe.
  Fetches a lat/lon grid from Open-Meteo in a **single request** (previously batched into
  4 parallel requests, which quadrupled the app's contribution to Open-Meteo's shared-IP
  per-minute rate limit and caused intermittent 429s — don't reintroduce batching).
  Keeps an in-memory `lastGood` cache and serves it (marked `stale:true`) if a fresh
  fetch fails, so transient rate-limiting doesn't show as "weather unavailable."
- Other `netlify/functions/*.mts` power news, weather-by-city, ISS tracking, flights,
  quotes, currency, aurora, YouTube, sports/tennis scores, etc. (fetched via `/api/*`
  redirects configured in `netlify.toml`).

## Weather globe — radar rendering

The globe's precipitation layer renders real RainViewer radar imagery, not synthetic dots:

- Metadata: `https://api.rainviewer.com/public/weather-maps.json`
- Tiles: `https://tilecache.rainviewer.com{path}/{size}/{zoom}/{x}/{y}/{color}/{options}.png`
  (color scheme `2` = "Universal Blue", options `smooth_snow` e.g. `1_1`)
- Approach (in `drawWeatherGlobe()` / `renderRadarLayer()`): tiles are stitched into an
  offscreen mosaic once (`loadRadarMosaic()`), then **every frame**, for every pixel of a
  small offscreen buffer canvas, the code computes the inverse of the globe's orthographic
  + tilt projection to recover the (lat, lon) under that pixel, samples the real radar
  color via `sampleRadar()` (Web Mercator projection into the mosaic), and blits the whole
  buffer onto the visible canvas in one `drawImage` call. This true per-pixel rasterization
  is what makes it look like a smooth radar sheet.
  - An earlier version instead sampled radar color onto the existing sparse jittered
    lattice of points and drew each as a translucent circle — this looked like scattered
    overlapping "bubbles" and was explicitly rejected. **Don't go back to a per-point/circle
    approach for this layer** — rasterize the whole disc instead.
- The globe auto-rotates and can be tilted by vertical mouse drag: `G2.tilt += dy * 0.4`.
  This sign was previously wrong (`-=`) and got reintroduced once already when an
  uncommitted local-only fix was silently overwritten by a later delivery built on a
  stale copy — see the git-workflow note below.

## Git / delivery workflow (no direct push access)

This session (Cowork) does not have push/write access to the GitHub repo — there's a
native "GitHub Integration" that authenticates for read access (confirmed via
`git ls-remote` and the GitHub API), but the repo-specific `add_repo` write-access flow
referenced in GitHub's API error message isn't exposed in Cowork (it appears to be a
Claude Code CLI-only feature). So the workflow is:

1. Claude edits files in its cloud workspace, verifies (lint/typecheck/Playwright as
   appropriate), then delivers them via SendUserFile + writes them into this folder via
   the device bridge.
2. Andrew (or Claude via `device_bash`, since a shell on this machine is available) runs
   `git add` / `git commit` / `git push` from this folder.
3. Push to `main` triggers a Netlify deploy automatically — confirm it went live by
   checking the Netlify deploy record for the new commit hash before considering a fix
   "done."

**Important lesson learned:** a fix applied directly to a file *on this machine* via
`device_bash`/`sed` without also committing it to git can be silently lost — if a later,
unrelated change is built from a stale cloud-workspace copy and delivered back, it
overwrites the local file and reverts the earlier fix. Always commit a fix to git right
after applying it (don't leave it as an uncommitted local-only edit), and when in doubt,
diff the cloud-workspace copy against this folder's `git log`/contents before building
further edits on top of it.

## Testing

- `test_radar.py` (Playwright, not committed/shipped — a local dev artifact) mocks
  `/api/**` plus RainViewer's metadata and tile endpoints with a synthetic gradient PNG,
  to validate the radar rendering visually and check frame-timing performance without
  needing live network access (the cloud sandbox can't reach api.rainviewer.com or
  tilecache.rainviewer.com directly — only a real browser, e.g. via Claude in Chrome, or
  WebFetch for docs pages, can).
- Before shipping a JS change across all four HTML files, run `node --check` on the
  extracted inline `<script>` content for each file.

## Open items / things to watch

- None currently blocking. Last confirmed-live fix: the tilt-drag-direction restore,
  commit `5c6f90c`.
