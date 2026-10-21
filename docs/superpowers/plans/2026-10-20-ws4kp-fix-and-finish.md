# WS4KP Fork: Fix and Finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the jhammond045/ws4kp fork (OSD menu + embedded video on top of WeatherStar 4000+) secure, working on GitHub Pages, current with upstream 8.0.1, and complete against its two specs.

**Architecture:** Three phases. Phase 0 hotfixes the live 6.2.1 site in place (security + broken data paths), because it is public and broken today. Phase 1 ports the fork's self-contained modules (`osd/`, `video/`) onto a fresh branch from `upstream/main` (8.0.1) and hand-ports the ~1.1k lines of glue; a merge produces 15 conflicted files and upstream has restructured every one of them. Phase 2 fixes the remaining bugs in the ported code. Phase 3 is optional spec-completion work.

**Tech Stack:** Vanilla ES modules, Express 5 (server/proxy mode), gulp + webpack static build, SCSS, GitHub Actions → GitHub Pages. Unit tests use Node's built-in `node:test` (no new deps).

**Spec:** `WORK.md` (embedded video), `docs/OSD.md` (OSD menu). As of this plan's first commit, both are **untracked** in the main working tree; Task 0 commits them. Review evidence for every finding is in the Findings appendix at the end of this file.

## Global Constraints

- No new runtime or baseline dependencies (both specs: "minimal deps"). hls.js stays lazy-loaded.
- Must work in all three modes: `npm start` (server/proxy), `DIST=1 npm start`, and the static build served from a subpath (`https://jhammond045.github.io/ws4kp/`).
- All asset/data URLs relative, never root-absolute (subpath hosting).
- Video and permalink URLs: `http:` and `https:` only.
- User-supplied text (video titles, scroll text, feed text, location names) goes into the DOM via `textContent`, never `innerHTML`.
- Video playback default muted; `playsinline` always set.
- Code style: repo eslint config (airbnb-base, tabs, single quotes). `npm run lint` must pass with 0 errors.
- Node ≥ 20 (upstream `engines.node >=20`; upstream CI uses 24).
- Commit conventions: one commit per task, stage by path, never `git add -A` (shared working tree).

## Review Focus

1. **Hostile permalink.** Any `?video=` / `video_N_url=` / scroll-text param from a link someone else sent. Expected: unsafe schemes dropped, no script runs, nothing hostile persists to localStorage. Pinned in Task 1.
2. **Non-ASCII titles.** "Traffic – Downtown" (en dash), emoji, CJK. Expected: Copy Permalink and Share work and round-trip the title. Pinned in Task 2.
3. **Opening a shared link, then editing.** Recipient deletes a video in the OSD and refreshes. Expected: deletion sticks, and their own stored list wasn't silently replaced without the URL being cleaned. Pinned in Task 2.
4. **Dead or slow video source.** A YouTube ID that's gone private, a 404 `.m3u8`, a host that never responds. Expected: the slot shows the WeatherStar-style "Video unavailable" card for its duration, then rotation continues; after 2 consecutive failures it's skipped. Pinned in Task 9.
5. **Kiosk / unattended 24-hour run.** 10 video sources, 10-minute data refresh, tab hidden and shown. Expected: no growth in intervals or mounted players, media paused while hidden, active video not torn down by refresh. Pinned in Task 9.

---

## Decisions needed before Phase 1

The port forces four product decisions. Recommendation in **bold**; confirm or override before Task 5.

| # | Conflict | Options | Recommendation |
|---|----------|---------|----------------|
| D1 | Settings UI | Upstream 8.x tabbed settings panel vs fork OSD menu | **OSD replaces the tab panel**, bound to upstream's `settings` objects. The OSD is the fork's point. |
| D2 | Screen effect | Upstream scanlines (`utils/scanlines.mjs`, scan-line toggle) vs fork CRT strength effect | **Keep upstream scanlines, drop fork CRT.** Fewer conflicts; the OSD spec asks for a "Scan lines" toggle, not CRT strength. Port CRT later if wanted. |
| D3 | Music volume | Upstream volume UI (7100390) vs fork volume in OSD | **Upstream volume logic, exposed as an OSD row (0–100 in steps of 10).** |
| D4 | Video display registration | Fork's sparse `displays[]` + `unregisterDisplay`/`trimDisplayTail` vs upstream load-order changes (26c6703, d81b0cf) | **Append video displays after upstream's static list** via one `registerDisplay`/`unregisterDisplay` pair in navigation.mjs; no sparse array. |

Also confirm: **D5** — should "Reset to defaults" also clear video sources? Recommendation: **yes**, with the confirm text saying so.

---

## Phase 0 — Hotfix the live 6.2.1 site (on `main`)

**Owner confirmation needed before Phase 0.** The working tree holds changes from an earlier session or by hand:
- Uncommitted WIP in `gulp/publish-frontend.mjs` (Prettier reformat + `copyCustomJs`) and `server/scripts/modules/utils/data-loader.mjs` (relative path, Prettier-formatted). Task 3 replaces the data-loader change with a lint-clean equivalent. The gulp reformat gets dropped because upstream replaces that file.
- `dist/readme.txt` deleted. The cause is unknown; the gulp `clean` task does not delete it.
- Untracked: `WORK.md`, `docs/OSD.md`, `docs/video-notes.md`, `BUILD_SPA.md`, `DEPLOY_GITHUB_PAGES.md`, `deploy-gh-pages.sh`, `.DS_Store`.

### Task 0: Commit the specs and docs

- [ ] **Step 1:** Once the owner confirms, `git add WORK.md docs/OSD.md docs/video-notes.md BUILD_SPA.md DEPLOY_GITHUB_PAGES.md` (by path), then commit `docs: add video and OSD specs, build and deploy guides`. Leave `deploy-gh-pages.sh` untracked; Task 4 deletes it. Add `.DS_Store` to `.gitignore`.
- [ ] **Step 2:** Verify `git ls-files WORK.md docs/OSD.md BUILD_SPA.md` lists all three. Task 5 copies these from `main` and fails without them.

### Task 1: Block unsafe video URL schemes

**Files:**
- Modify: `server/scripts/modules/video/sources.mjs:85-100` (`normalizeSource`)
- Modify: `server/scripts/modules/video/renderers/iframe.mjs:13-19`
- Modify: `server/scripts/modules/video/manager.mjs:61-75` (`computeIssues`)
- Modify: `package.json` (`test` script)
- Test: `tests/unit/video-sources.test.mjs`

**Interfaces:**
- Produces: `export const isAllowedMediaUrl = (value: string) => boolean` in `sources.mjs`. True only when `new URL(value).protocol` is `http:` or `https:`. Task 9 and Task 10 reuse it.
- Produces (test helper, top of `tests/unit/video-sources.test.mjs`): `load(search = '', storage = {}, history = {}) => Promise<module>`. It sets the globals below, then runs `import('../../server/scripts/modules/video/sources.mjs?' + n++)` with a fresh query string so each call re-runs module hydration.
  - `globalThis.window = { location: { search, href: 'https://e.test/ws4kp/' + search }, history: { replaceState() {}, ...history } }`
  - `globalThis.localStorage` = an in-memory object seeded from `storage`
  - `globalThis.btoa` / `atob` (Node has them)
  - Task 2 reuses this helper.

- [ ] **Step 1: Write the failing test** using `load()`.

```js
test('drops javascript: and data: URLs from permalink', async () => {
	const { getVideoSources } = await load('?video_0_url=javascript:alert(1)&video_1_url=data:text/html,x&video_2_url=https://e.test/a.m3u8');
	assert.deepEqual(getVideoSources().map((s) => s.url), ['https://e.test/a.m3u8']);
});
test('drops unsafe URLs already in localStorage', async () => {
	const { getVideoSources } = await load('', { 'ws.video.sources': JSON.stringify([{ url: 'javascript:alert(1)' }]) });
	assert.equal(getVideoSources().length, 0);
});
test('isAllowedMediaUrl', async () => {
	const { isAllowedMediaUrl } = await load('');
	assert.equal(isAllowedMediaUrl('https://youtu.be/x'), true);
	assert.equal(isAllowedMediaUrl('JavaScript:alert(1)'), false);
	assert.equal(isAllowedMediaUrl('not a url'), false);
});
```

- [ ] **Step 2: Set `"test": "node --test tests/unit/"` in package.json, then run `npm test`.** Expected: FAIL (first two tests return the javascript URL; third throws because `isAllowedMediaUrl` is undefined).
- [ ] **Step 3: Implement.** Add `isAllowedMediaUrl`. In `normalizeSource`, set `url` to `''` when it's disallowed (the existing filter drops empty URLs) and `poster` to `''` likewise. In `computeIssues`, push `'URL must start with http:// or https://'` when the URL is non-empty and disallowed. In `iframe.mjs`, refuse to mount a disallowed URL and set `iframe.sandbox = 'allow-scripts allow-same-origin allow-presentation allow-popups'`.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Manual check.** `npm run build:spa`, serve, and load `?video_0_title=P&video_0_url=javascript:parent.window.__p%3D1&video_0_dur=10`. Expected: `window.__p` stays `undefined`, and `localStorage['ws.video.sources']` holds no javascript URL.
- [ ] **Step 6: Commit** `fix(video): allow only http(s) video URLs and sandbox generic iframes`.

### Task 2: Unicode-safe permalinks; don't resurrect deleted sources

**Files:**
- Modify: `server/scripts/modules/video/sources.mjs:170-180` (`base64UrlEncode`/`base64UrlDecode`), `:281-292` (`hydrateInitialSources`)
- Test: `tests/unit/video-sources.test.mjs`

**Interfaces:**
- Consumes: the `load()` helper from Task 1's test file.
- Produces: `encodeSourceForPermalink` / `decodeSourceFromPermalink` stay the same names. They no longer throw on non-Latin-1 text.

- [ ] **Step 1: Write the failing tests.**

```js
test('permalink round-trips non-Latin-1 titles', async () => {
	const { encodeSourceForPermalink, decodeSourceFromPermalink } = await load('');
	const enc = encodeSourceForPermalink({ title: 'Traffic – Downtown 🚗', url: 'https://e.test/a.m3u8', durationSec: 20 });
	assert.equal(decodeSourceFromPermalink(enc).title, 'Traffic – Downtown 🚗');
});
test('hydrating from URL strips video params from the address bar', async () => {
	const calls = [];
	await load('?video_0_url=https://e.test/a.m3u8&units=us', {}, { replaceState: (...a) => calls.push(a[2]) });
	assert.equal(calls.length, 1);
	assert.ok(!String(calls[0]).includes('video_'));
	assert.ok(String(calls[0]).includes('units=us'));
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL (`InvalidCharacterError`, and `replaceState` is never called).
- [ ] **Step 3: Implement.** Encode with `TextEncoder` → binary string → `btoa`. Decode with `atob` → `Uint8Array` → `TextDecoder`. In `hydrateInitialSources`, after taking `querySources`, delete the `video` and `video[-_]N[-_]*` params and call `window.history.replaceState(null, '', url)`.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `fix(video): unicode-safe permalink encoding; strip video params after import`.

### Task 3: Make the static build work from a subpath

**Files:**
- Modify: `server/scripts/modules/utils/data-loader.mjs:9` → `` `data/${dataType}.json...` `` (keep the file's tabs/single quotes; this replaces the Prettier WIP)
- Modify: `server/scripts/modules/radar-tiles.mjs:68` → `` `images/maps/radar/...` ``
- Modify: `server/manifest.json` → icon `src` values `images/logos/...`, `"start_url": "./"`
- Restore: `git checkout dist/readme.txt` (after owner confirms; see the Phase 0 note)

- [ ] **Step 1: Build and serve under a subpath.** `npm run build:spa && mkdir -p /tmp/site && rm -rf /tmp/site/ws4kp && cp -R dist /tmp/site/ws4kp && npx http-server /tmp/site -p 7655 -c-1`
- [ ] **Step 2: Load `http://localhost:7655/ws4kp/`, enter "Chicago, IL", and advance to Local Radar.** Then run `performance.getEntriesByType('resource').filter(e => e.responseStatus >= 400).map(e => e.name)` in the console. Expected: only `scripts/custom.js` (an optional probe). No `/data/`, `/images/maps/radar/`, or manifest 404s. The radar basemap is visible.
- [ ] **Step 3: Run `npm run lint`.** Expected: data-loader.mjs has no errors.
- [ ] **Step 4: Commit** `fix(static): relative data, radar tile and manifest paths for subpath hosting`.

### Task 4: CI and dependency cleanup, deploy

**Files:**
- Modify: `.github/workflows/deploy.yml`:
  - `node-version: "22"`
  - `actions/checkout@v5`
  - `actions/setup-node@v5`
  - `actions/upload-pages-artifact@v4`
  - `actions/deploy-pages@v5`
  - add `npm test` and `npm run lint` steps before `Build SPA`
- Modify: `package.json` (remove `"npm"` from `dependencies`), `package-lock.json` (regenerate)
- Modify: the five `no-mixed-spaces-and-tabs` sites from lint (`server/scripts/index.mjs:626`, `osd/osdModal.mjs:245`, `video/sources.mjs:370`, `weatherdisplay.mjs:364,519,612`)
- Delete: `deploy-gh-pages.sh` (untracked, so just `rm` it after the owner confirms). Pages uses `build_type: workflow`, so the gh-pages branch it force-pushes is never served.
- Modify: `DEPLOY_GITHUB_PAGES.md`. Remove Option B and the gh-pages troubleshooting. Put CNAME in `server/` instead of `dist/`.
- Modify: `BUILD_SPA.md`. Use port 7654, Node ≥ 20, drop the "SPA fallback route" note, and link fork issues.

- [ ] **Step 1: Run `npm uninstall npm && npm audit fix --omit=dev`, then `npm audit --omit=dev`.** Expected: 0 critical, 0 high.
- [ ] **Step 2: Run `npm ci && npm test && npm run lint && npm run build:spa` under Node 22 (`npx -p node@22 node -v` to confirm the version).** Expected: all exit 0.
- [ ] **Step 3: Commit and push** `ci: node 22, lint+test gate, drop unused npm dep and gh-pages script`. Run `git fetch` first and check for divergence.
- [ ] **Step 4: Verify the deploy.** Run `gh run watch` on the Pages run. Expected: green. Then check `curl -s -o /dev/null -w '%{http_code}' https://jhammond045.github.io/ws4kp/data/stations.json`. Expected: `200`.

**End of Phase 0:** the live site loads weather data and the permalink XSS is closed.

---

## Phase 1 — Port onto upstream 8.0.1

Do not merge. Branch from upstream and bring the fork's code over. Phase 0's fixes to `video/` come along because files are copied from `main`, not from `9c43cd5`.

### Task 5: New branch with fork modules copied in, building

**Files:**
- Branch: `port/8.0.1` from `upstream/main`
- Copy from `main`: `server/scripts/modules/osd/`, `server/scripts/modules/video/`, `server/styles/scss/_osd.scss`, `server/styles/scss/_video.scss`, `views/partials/osd-menu.html`, `views/partials/osd-modal.html`, `docs/`, `tests/unit/`, `.github/workflows/deploy.yml`, `DEPLOY_GITHUB_PAGES.md`, `BUILD_SPA.md`
- Modify: `server/styles/scss/ws.scss` (`@use 'osd'; @use 'video';`), `views/index.ejs` (include OSD partials), `server/scripts/index.mjs` (import the OSD and video entry modules), `package.json` (`test` script; `build:spa` → `npm run build`, since upstream's build compiles CSS itself)
- Do not copy: `gulp/publish-frontend.mjs` (upstream uses `gulp/build.mjs`), `.npmrc`

- [ ] **Step 1:** `git switch -c port/8.0.1 upstream/main && git checkout main -- <paths above>`
- [ ] **Step 2: Wire imports, SCSS and partials as listed.**
- [ ] **Step 3: Run `npm ci && npm test && npm run lint && npm run build`.** Expected: all exit 0.
- [ ] **Step 4: Run `npm start` and load `/`.** Expected: upstream app works, and the gear opens the OSD (rows may be unbound until Task 6). No console errors other than the `custom.js` probe.
- [ ] **Step 5: Commit** `feat: bring OSD menu and video modules onto 8.0.1`.

### Task 6: Port the glue (settings, display registration, permalink, volume)

**Files:**
- Modify: `server/scripts/modules/osd/osdMenu.model.mjs`. Bind rows to upstream `settings` (D1). Add a Scan lines toggle bound to upstream's scan-line setting (D2). Add a volume row with 0–100 in steps of 10 bound to upstream media volume (D3). Add a scroll-text row bound to upstream `custom-scroll-text.mjs`.
- Modify: `server/scripts/modules/navigation.mjs`. Add `registerDisplay`/`unregisterDisplay` support for video displays appended after the static list (D4).
- Modify: `server/scripts/modules/video/index.mjs`. Use that pair.
- Modify: `server/scripts/modules/share.mjs`. Append `encodeSourceForPermalink` values as repeated `video=` params.
- Modify: `server/scripts/index.mjs`. Gear/ArrowUp toggles the OSD. Remove upstream's tab settings panel markup in `views/index.ejs` once the OSD covers every setting it had.
- Delete from the port: fork CRT code (D2).

- [ ] **Step 1: Write a coverage check.** List every `settings.*` key and every screen in upstream, and confirm each has an OSD row. Record the list in the commit body.
- [ ] **Step 2: Implement the bindings and registration.**
- [ ] **Step 3: Manual matrix in all three run modes.**
  - Toggle each OSD row and confirm it takes effect live and persists across reload.
  - Copy Permalink, open it in a clean profile, and confirm identical settings, screens and videos.
  - Add a YouTube source and an HLS source and confirm both appear in rotation with their titles in the header.
- [ ] **Step 4: Run `npm test && npm run lint`.** Expected: pass.
- [ ] **Step 5: Commit** `feat: bind OSD to 8.0.1 settings; register video displays; video permalink`.
- [ ] **Step 6: Open a PR from `port/8.0.1` → `main`.** After merge, confirm the Pages deploy is green and the live site matches the manual matrix.

---

## Phase 2 — Remaining bugs (on the ported code)

Before each task, re-check each listed finding against the ported code. Drop any the port already removed.

### Task 7: OSD menu and modal input bugs

**Files:** `server/scripts/modules/osd/osdMenu.mjs`, `osdModal.mjs`, `osdMenu.model.mjs`, `osdMenu.view.mjs`, `views/partials/osd-menu.html`, `server/scripts/index.mjs` (location picker), `server/scripts/modules/video/manager.mjs`

Fix list (Findings O1–O10):
- Outside-pointerdown close must ignore `#divTwcBottom`, so the gear toggles the menu closed.
- Modal Enter handler only activates action buttons. Enter in inputs and other buttons passes through.
- Tab is trapped inside the open modal.
- `previousFocus` is captured before `modalPanel.focus()`.
- Kiosk row gets `beforeSet` → `requestKioskEnable()` (returns boolean).
- Pausing from the OSD uses an in-memory flag instead of the persisted `play` key.
- REMOVE → confirm returns to the video manager on both OK and CANCEL.
- Location picker moves only the input and buttons, and keeps the autocomplete results node.
- Category and item rows get `role="option"` children inside the listboxes so they appear in the accessibility tree.
- Footer legend uses characters the Star4000 font has. Copy is fixed as `SELECT: ↑↓   SET: ‹ ›   ENTER: ACTION   BACK: ESC`; if `↑↓` don't render, use `^ v`.

- [ ] **Step 1: Unit test for the enum compare.** `osdMenu.model.mjs` enum `getValue` matches a numeric setting value `50` against option `'50'`. Write it, see it fail, fix with `String()` on both sides, see it pass. This applies only if any numeric enum survives D2.
- [ ] **Step 2: Fix the rest of the list.**
- [ ] **Step 3: Manual keyboard and mouse pass against `docs/OSD.md` §9.**
  - Gear opens and closes the menu.
  - Enter in the location box submits the search.
  - Tab never leaves the modal.
  - Kiosk shows the warning modal.
  - REMOVE → CANCEL keeps the manager open.
  - Autocomplete still works after opening and closing LOCATION.
  - Reload while the OSD is open still autoplays.
- [ ] **Step 4: Commit** `fix(osd): input, focus and modal-stack bugs`.

### Task 8: Text sinks and integration leftovers

**Files:** `server/scripts/modules/currentweatherscroll.mjs` (`:204`, `:213`, `:236` on 8.0.1), `server/scripts/index.mjs`, `server/scripts/modules/hazards.mjs`

- [ ] **Step 1: Regression check.** Upstream 8.0.1 escapes custom scroll text (`custom-scroll-text.mjs:41`, `escapeHtml`), and the port drops the fork's `custom-rss-feed.mjs`. Load the port with upstream's custom scroll text param set to `<img src=x onerror="window.__s=1">`. Expected: `window.__s` stays undefined and the text shows literally. Run this before Task 6's PR merges.
- [ ] **Step 2: Fix only if Step 1 fails or the OSD adds a new text source.** Escape at the source the same way upstream does, with `escapeHtml`.
- [ ] **Step 3: Check the integration findings (I1–I5) on the port and fix any that survive.**
  - Location Reset throws on missing `#span*`.
  - Refresh while paused leaves a blank screen (progress lookup).
  - Permalinked screen toggles are ignored.
  - Hazards "!!!" badge has no element to render into.
  - Reset clears `#txtLocation`, and video sources too per D5.
- [ ] **Step 4: Commit** `fix: escape scroll text; reset/refresh/permalink leftovers`.

### Task 9: Video lifecycle

**Files:** `server/scripts/modules/video/display.mjs`, `index.mjs`, `renderers/youtube.mjs`, `renderers/hls.mjs`, `renderers/iframe.mjs`, `manager.mjs`, `detect.mjs`

**Interfaces:**
- Consumes: `isAllowedMediaUrl` (Task 1), `registerDisplay`/`unregisterDisplay` (Task 6).
- Produces: `VideoDisplay` status values `'loading' | 'loaded' | 'failed'`. Navigation includes `failed` video displays in rotation so the error card shows. `VideoDisplay` skips itself after `failureCount >= 2` until a later load succeeds.

Fix list (Findings V3–V16):
- Displays built after DOMContentLoaded run `loadTemplates()` themselves.
- Source edits call `updateSource()` on the matching display and rebuild only on add, remove or reorder.
- `dispose()` clears the auto-refresh and nav intervals.
- A data refresh does not remount the display that's on screen.
- Load timeout is `preloadSec + 5` s. On timeout, set status `failed` and render "VIDEO UNAVAILABLE" in the content area.
- hls.js rejects only when `data.fatal` is set.
- On `visibilitychange`, pause while hidden and resume on the next show.
- Prewarm runs once per upcoming show, not every `preloadSec` forever, and never unmutes off-screen.
- Generic iframe `pause()` sets `src` to `about:blank`, and `play()` restores it. Remove `loading="lazy"`.
- Sources with an empty URL are not rotated.
- YouTube embeds use `www.youtube-nocookie.com`.

- [ ] **Step 1: Unit tests in `tests/unit/video-display.test.mjs`.** Use stub renderers whose `mount` resolves or never resolves.
  - A mount that never resolves gives status `failed` after `preloadSec + 5` s (fake timers via `mock.timers`).
  - Two consecutive failures make `isEnabledForRotation()` return false.
  - `dispose()` leaves zero active intervals (spy on `setInterval`/`clearInterval`).
  - Editing a title calls `updateSource` and does not construct a new renderer.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement the fix list.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Manual check.**
  - 3 sources (live YouTube, a 404 `.m3u8`, a generic iframe). The 404 slot shows the unavailable card for its duration, then is skipped on the next two rotations.
  - Hide the tab for 30 s. Media pauses.
  - Leave it running 30 min with 10 sources. The DevTools Performance monitor shows a flat node and listener count.
  - Repeat in Firefox to exercise the hls.js CDN path.
- [ ] **Step 6: Commit** `fix(video): lifecycle, timeouts, failure card, visibility, prewarm`.

---

## Phase 3 — Spec gaps (optional; confirm scope first)

### Task 10: Finish the specs

Do each only if wanted:
- Video manager fields missing from WORK.md §1.3: Type, Preload lead-time, Poster, Start/End (`manager.mjs:326-375`).
- Non-embeddable iframe warning (§1.3).
- README: add an "OSD Menu" section (OSD.md §10.8). Fix the "Include videos" toggle text at `README.md:293`; the toggle was removed and videos are always included. Either restore the toggle or fix the text. Recommendation: fix the text.
- Vendor hls.js under `server/scripts/vendor/` instead of loading it from jsDelivr (§10), or add SRI to the CDN tag.
- Optional server-proxy passthrough for `.m3u8` (WORK.md §6). Recommendation: skip until a real CORS-blocked stream shows up.

Each item gets its own commit. Run `npm test && npm run lint` before each.

---

## Findings appendix

All findings are from the 2026-10-20 review. Severity: 🔴 broken/security, 🟡 wrong under some conditions, 🔵 cleanup. "Live" means reproduced in a browser this session; the rest come from code reading.

### Deploy / build
| # | Sev | Where | Finding | Task |
|---|-----|-------|---------|------|
| B1 | 🔴 | live site | **Live:** `data/*.json` is requested from the domain root and 404s, so no weather loads. The fix is uncommitted WIP. | 3, 4 |
| B2 | 🔴 | `radar-tiles.mjs:68` | **Live:** Root-absolute radar tile path 404s on the subpath. | 3 |
| B3 | 🟡 | `manifest.json` | Root-absolute icon and `start_url`. | 3 |
| B4 | 🟡 | `deploy.yml:28` | Node 18 is EOL, and the bundled `npm@11` dependency needs ≥ 20.17. CI has no lint or test gate. | 4 |
| B5 | 🟡 | `package.json` | `"npm"` runtime dependency (pre-fork, unused) brings 18 of 23 runtime vulns, including critical `tar`. The rest have non-breaking fixes. | 4 |
| B6 | 🔵 | `deploy-gh-pages.sh` | Force-pushes a gh-pages branch that Pages never serves (workflow mode), and runs `git init` inside `dist/`. | 4 |
| B7 | 🔵 | `BUILD_SPA.md`, `DEPLOY_GITHUB_PAGES.md` | Wrong port, wrong Node version, SPA fallback that doesn't apply, CNAME placed in `dist` (gets wiped). | 4 |
| B8 | 🔵 | lint | 44 errors: Prettier WIP in data-loader plus 11 mixed tabs/spaces. | 3, 4 |
| B9 | 🔵 | `tests/` | Puppeteer script with no assertions; the `test` script is a stub. | 1 |
| B10 | 🟡 | fork vs upstream | 294 commits behind (6.2.1 vs 8.0.1). A merge gives 15 conflicted files. | 5, 6 |

### Video (WORK.md)
| # | Sev | Where | Finding | Task |
|---|-----|-------|---------|------|
| V1 | 🔴 | `sources.mjs:93`, `iframe.mjs:18` | **Live:** `javascript:` URL from a permalink runs in the app origin on page load and persists to localStorage (stored XSS). | 1 |
| V2 | 🔴 | `sources.mjs:170` | `btoa` throws on non-Latin-1 titles, so Copy Permalink and Share break. | 2 |
| V3 | 🔴 | `sources.mjs:283` | `?video=` overwrites stored sources, and the URL is never cleaned, so deleted sources come back on refresh. | 2 |
| V4 | 🔴 | `display.mjs:190` | Displays rebuilt after an edit never get a player and stay on "Preparing video…". | 9 |
| V5 | 🟡 | `video/index.mjs:24` | Every keystroke rebuilds all N displays and players. | 9 |
| V6 | 🟡 | `display.mjs:250` | `dispose()` leaks the 10-min refresh interval; each edit leaks N. | 9 |
| V7 | 🟡 | `display.mjs:164` | 10-min refresh tears down the playing video. | 9 |
| V8 | 🟡 | renderers | No load timeout. A hung source silently drops out of rotation. | 9 |
| V9 | 🟡 | `display.mjs:181` | Failed sources are skipped, so the "Video unavailable" card never shows. `failureCount` is never read. | 9 |
| V10 | 🟡 | `hls.mjs:150` | Non-fatal hls.js errors are treated as failures. | 9 |
| V11 | 🟡 | `display.mjs:289` | **Live:** All players mount at page load. Standby prewarm re-fires every 5 s forever, and unmuted sources blip audio off-screen. | 9 |
| V12 | 🟡 | video/ | No Page Visibility handling. | 9 |
| V13 | 🟡 | `iframe.mjs:35` | `pause()` is a no-op, so hidden iframes keep playing. `loading="lazy"` defeats prewarm. | 9 |
| V14 | 🟡 | `manager.mjs:545` | REMOVE → CANCEL closes the whole manager. | 7 |
| V15 | 🟡 | `manager.mjs:505` | ADD rotates an empty-URL source. | 9 |
| V16 | 🔵 | `youtube.mjs:96` | **Live:** Uses youtube.com, not youtube-nocookie (spec §2.2). The YouTube error page shows instead of the app card. | 9 |
| V17 | 🔵 | `hls.mjs:1` | hls.js loads from jsDelivr with no SRI; the spec wanted a dep or vendored copy. | 10 |
| V18 | 🔵 | `manager.mjs:326` | No Type, Preload, Poster or Start/End fields. No non-embeddable warning. | 10 |

### OSD menu (docs/OSD.md)
| # | Sev | Where | Finding | Task |
|---|-----|-------|---------|------|
| O1 | 🔴 | `osdMenu.mjs:141` | **Live:** The gear can't close the OSD (outside-pointerdown closes it, then the click reopens it). | 7 |
| O2 | 🔴 | `osdModal.mjs:119` | Enter is swallowed in modals. Enter in the location box closes the picker; GO, Reset, GPS and Add never get Enter. | 7 |
| O3 | 🔴 | `index.mjs:330` + `autocomplete.mjs:68` | Opening LOCATION deletes the autocomplete results node, so suggestions are dead until reload. | 7 |
| O4 | 🔴 | `osdMenu.model.mjs:328` | Kiosk enables with no warning modal. | 7 |
| O5 | 🔴 | `osdMenu.model.mjs:364` | CRT strength row compares number to string, shows 0% and writes the wrong value. Moot if D2 drops CRT. | 7 |
| O6 | 🟡 | `osdMenu.mjs:46` | OSD pause persists `play=false`; reload while open stops autoplay. | 7 |
| O7 | 🟡 | `osdModal.mjs:89,240` | No Tab trap; focus is restored to the wrong element. | 7 |
| O8 | 🟡 | osd view | **Live:** Category and item rows aren't in the accessibility tree (empty listboxes). | 7 |
| O9 | 🔵 | `osd-menu.html` | **Live:** Footer legend arrows don't render in the Star4000 font. | 7 |
| O10 | 🟡 | `index.mjs:118` | Permalink drops media volume and custom feed; scan-lines setting removed. | 6 |

### Core integration
| # | Sev | Where | Finding | Task |
|---|-----|-------|---------|------|
| I1 | 🔴 | `index.mjs:631` | **Live:** Location Reset throws `Cannot set properties of null (setting 'innerHTML')`. | 8 |
| I2 | 🔴 | `index.mjs:827` | Refresh while paused leaves a blank screen (progress display lookup never matches). | 8 |
| I3 | 🔴 | `navigation.mjs:818` | `#enabledDisplays` removed, so permalinked screen on/off params are ignored. | 6, 8 |
| I4 | 🟡 | `hazards.mjs:61` | New-alert "!!!" badge never shows. | 8 |
| I5 | 🟡 | `custom-rss-feed.mjs:132` | Custom feed never applied on load and not in the OSD. Upstream replaced it with `custom-scroll-text.mjs`. | 6 |
| I6 | 🟡 | `currentweatherscroll.mjs:204,225` | Fork RSS feed text goes into `innerHTML` unescaped, so script runs via a crafted feed or link. Upstream escapes its replacement (`escapeHtml`), so the port fixes this; Task 8 checks for regressions. | 6, 8 |
| I7 | 🟡 | `navigation.mjs:742` | `crtStrength=0` from a link becomes 50 (`\|\|` instead of `??`). Moot if D2 drops CRT. | 6 |
| I8 | 🔵 | `index.mjs:170` | Dev server exposes `/src` over HTTP. | 6 |
| I9 | 🔵 | `_page.scss:608`, `cache.mjs:4`, `index.ejs:238` | Dead rule, dead function, and the Refresh button uses the menu icon. | 6 |

### Verified working (live, this session)
- Server mode, `DIST=1` mode, and the static build under `/ws4kp/` (with the data-loader fix) all load NWS data for Chicago.
- The OSD opens in-frame and pauses rotation; Escape closes it and resumes.
- YouTube and HLS video screens render with the configured title in the WeatherStar header. HLS played natively in Chrome.
- 0 video sources: rotation unaffected.
