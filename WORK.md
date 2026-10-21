# Embedded Video — Detailed Implementation Spec (for `ws4kp`)

## 0) Goals & Non-Goals

**Goal:** Add a new **Video** screen type that participates in the standard screen rotation. Users can configure **one or more video sources** (YouTube URLs, direct `.m3u8` HLS URLs, or arbitrary embeddable iframe URLs). Each source has:

- **title** (string) → shown in the normal WeatherStar header
- **url** (string) → YouTube/watch/short URL, `.m3u8`, or any embeddable URL
- **durationSec** (int) → number of seconds this screen is visible in the rotation
- Optional advanced fields (below)

**Behavior:**

- The **main WeatherStar header** is present (title left; clock/right as normal).
- **Autodetect** source type and render with the appropriate modality.
- **Pre-warm** each video to start **seamlessly** when the panel appears.
- Conform to existing code conventions (class-per-display, HTML/CSS, minimal deps) in repository.
- Persist config in localStorage and include in **permalink/env** mapping if feasible (consistent with existing permalink/env support) in repository.

**Non-goals (initial version):**

- No audio by default (autoplay policies); start **muted**. We may later add a “with audio” toggle (opt-in).
- No attempt to break cross-origin restrictions for arbitrary iframes (document limitations).
- We prefer **conditional** library loading (HLS) to keep baseline footprint small.

---

## 1) Data Model & Settings

### 1.1 Local Storage Key

- Add a new **array** under localStorage key: `ws.video.sources`:

```json
[
  {
    "title": "Traffic Cam – Downtown",
    "url": "https://www.youtube.com/watch?v=…",
    "durationSec": 20,
    "muted": true,
    "loop": true,
    "preloadSec": 5,
    "poster": "", // optional, for <video> fallback/first frame
    "startAt": 0, // optional seconds offset
    "endAt": null, // optional seconds offset
    "type": "auto" // enum: auto|youtube|hls|iframe
  }
]
```

- Defaults (when omitted): `muted=true`, `loop=true`, `preloadSec=5`, `type="auto"`.

### 1.2 Permalink / Env Mapping (Optional but nice)

- The README documents a permalink and environment-variable mapping (see **WSQS\_** related notes). Extend the mapping for compactness:

  - `&video=` repeated param with **base64url-encoded** compact JSON per source (title/url/duration only), e.g., `video=eyJ0IjoiVHJhZmZpYyIsInUiOiJodHRwcyIsImQiOjIwfQ` and then hydrate defaults in the client.
  - Server env (`WSQS_VIDEO_*`) optional: **not required** for MVP, but outline:

    - `WSQS_VIDEO_0_TITLE`, `WSQS_VIDEO_0_URL`, `WSQS_VIDEO_0_DUR` etc.

_(If the permalink gets too long, keep only in localStorage—consistent with README note that selected displays are sticky and the permalink is optional.)_

### 1.3 Settings UI

- Add a **“Video”** section in the settings interface (the same modal used for other screens).

  - UI affordances:

    - **Add video** (button)
    - For each source: Title (text), URL (text), Duration (seconds), Type (auto/youtube/hls/iframe, default auto), Muted (toggle), Loop (toggle), Preload lead-time (seconds).
    - **Remove** icon per item.
    - **Drag handle** to reorder (optional—if the global rotation has a fixed order, see §3.2 for placement rules).

  - **Validation**:

    - URL non-empty; if `.m3u8` and browser lacks native HLS, we’ll load Hls.js dynamically.
    - If YouTube, accept `youtube.com/watch?v=…`, `youtu.be/…`; store as originally entered.
    - Warn if an arbitrary iframe URL is non-embeddable (X-Frame-Options), but still allow.

- Persist changes to `ws.video.sources` immediately (consistent with other settings).

---

## 2) Source-Type Detection & Render Modalities

### 2.1 Autodetection

Given `url` and optional `type`:

- If `type !== 'auto'`, trust the explicit type.
- Else:

  - **YouTube** if hostname matches `youtube.com`, `youtu.be`, or `youtube-nocookie.com` (accept both `watch?v=` and short forms).
  - **HLS** if URL ends with `.m3u8` (or query contains it).
  - Otherwise **IFRAME**.

### 2.2 Rendering Strategies

**A) YouTube (iframe + Player API)**

- Render `<iframe>` using **privacy-enhanced** host (`www.youtube-nocookie.com`) with `embed` path and query:

  - `?autoplay=1&mute=1&playsinline=1&controls=0&rel=0&modestbranding=1&enablejsapi=1&origin=<app-origin>`

- Pre-connect in advance (see pre-warm section).
- Use postMessage/Player API to **cue** or **play** when entering; **pause** on exit.

**B) HLS (.m3u8)**

- If browser supports native HLS (`canPlayType('application/vnd.apple.mpegURL')` ok), use `<video>` with `src`, `preload="auto"`, `playsinline`, `muted`, `loop` flags from settings.
- Else **conditionally load** `hls.js` (dynamic `import()` or script injection) only for this display.

  - Create `<video>` without `src`; attach Hls instance, `hls.loadSource(url); hls.attachMedia(video)`.

- Apply `poster` if provided; `video.currentTime = startAt` on play; stop at `endAt` if set.

**C) Generic IFRAME**

- Render `<iframe src="…">` with `allow="autoplay; encrypted-media; picture-in-picture"` and `allowfullscreen` attributes.
- Autoplay depends on the content and policies; **muted** is not enforceable for unknown iframes.

**All modalities** must:

- Fit the **inner screen safe area** (same content box other displays use), with **header bar** above.
- Respect 4:3 layout styling the app uses for screens.

---

## 3) Display Integration

### 3.1 New Display Class

Create a new class **`VideoDisplay`** alongside other displays (follow naming & export conventions). Place in the same folder that holds the display classes (e.g., `src/displays/VideoDisplay.mjs`). The class should:

- Extend the base display class used by other screens (match constructor signature and lifecycle hooks).
- Expose the **same interface** used by the slideshow controller (e.g., `mount(container)`, `show()`, `hide()`, `dispose()`, `durationMs()` or equivalent—mirror the pattern from other screens).
- Accept a **single source object** (one `VideoDisplay` per configured source). The slideshow will instantiate one instance per source.

**File layout (suggested):**

```
src/displays/
  BaseDisplay.mjs            // existing
  CurrentConditionsDisplay.mjs
  …
  VideoDisplay.mjs           // NEW
src/displays/video/
  youtube.mjs                // NEW (helper)
  hls.mjs                    // NEW (helper)
  iframe.mjs                 // NEW (helper)
src/scss/displays/_video.scss // NEW
```

> If the project keeps helpers in a `modules/utils` or similar area, mirror that instead (but keep the three helpers cohesive).

### 3.2 Registration & Order in Rotation

- Find where the app **assembles the rotation** (the list of displays). Inject **N** `VideoDisplay` instances (one for each configured source) into that list.
- Placement rule (to minimize disruption):

  - **Default:** Insert the Video screens near the **end** of the rotation, right before the last “extra” screen (e.g., just before “Almanac” or the app’s closing/end card), or provide a “Video section position” selector in settings with options: `Start`, `Middle`, `End` (optional extension).

- Respect the app’s “refresh only on slideshow repeat” behavior; do **not** re-fetch between frames unless the URL or settings change.

### 3.3 Duration

- `VideoDisplay.durationMs()` should return `durationSec * 1000` from its source config.
- If the player reports **ready** late (slow warm-up), still respect the scheduled exit to keep rotation cadence stable.

---

## 4) DOM Structure & Header

### 4.1 Container

- Reuse the **standard display container** pattern (same classes/structure other displays use). Example structure:

```html
<div class="display display--video" data-display="video">
  <div class="ws-header">
    <div class="ws-header__title">{config.title || 'Video'}</div>
    <div class="ws-header__clock"></div>
    <!-- existing clock binding -->
  </div>

  <div class="ws-body ws-body--video">
    <!-- One of the three modalities: -->
    <!-- YouTube iframe | <video> for HLS | generic iframe -->
  </div>
</div>
```

- Keep the **header markup/classes** exactly as other displays so the existing clock and styling hooks continue to work.

### 4.2 SASS / CSS

- Add `_video.scss` (import into the main SASS bundle) to:

  - Constrain the **media box** to the safe area used by other screens.
  - Ensure the video maintains aspect ratio and is centered (object-fit: `cover` for `<video>`; `iframe` 100%/100% with wrapper crop as needed).
  - Apply any **scanline/texture overlays** shared across displays (opt-in via a utility class if the project uses one).

- No new fonts or external CSS.

---

## 5) Pre-Warm & Seamless Start

We want the video to **start immediately** when the panel fades in.

### 5.1 Timeline

- **`preloadSec`** before the display is scheduled to show:

  - Instantiate the player **off-screen** (or in the display container but `visibility:hidden; position:absolute; pointer-events:none`).
  - For **YouTube**: inject iframe with `autoplay=1&mute=1`, immediately pause at `0` (or `startAt`) as soon as the Player API reports `onReady` → `player.mute(); player.playVideo(); player.pauseVideo(); player.seekTo(startAt, true);`
  - For **HLS/native video**: create `<video>` with `preload="auto"`, assign source / attach Hls, call `video.load()`, then `video.play()` muted for a few frames (if allowed); immediately `pause()` and `currentTime=startAt`.
  - For **generic iframe**: best-effort only—load hidden so initial TCP/TLS and document load are done.

- **At show-time**:

  - Make container visible (or swap `visibility`) and **play**:

    - YouTube: `player.playVideo();`
    - HLS/native: `video.play();`

- **At hide-time**:

  - **Pause** and keep media element for re-use **only** if the next rotation will show the same source again soon and memory permits; otherwise **dispose** to free resources.

### 5.2 Connection Hints

- During pre-warm, add these to `<head>` if not already present:

  - `<link rel="preconnect" href="https://www.youtube-nocookie.com">`
  - `<link rel="preconnect" href="https://i.ytimg.com">`
  - For HLS with cross-origin: `<link rel="preconnect" href="{origin-of-m3u8}">`

- Only insert once per origin.

---

## 6) Optional Proxy/CORS Considerations

The project supports a **Node server with caching proxy** mode (recommended). If you want to **stabilize** `.m3u8` access or mitigate CORS on some CDNs, allow the proxy to **pass through** video MIME types and set **CORS** permissive response headers for proxied assets, limited to configured upstreams. This is an **optional** optimization; static mode still requests directly from the browser.

---

## 7) Error Handling & Fallbacks

- If a source **fails to load** within `preloadSec + 5s`, mark it **degraded** for this cycle:

  - Show the header with title and a centered **“Video unavailable”** message in WeatherStar style.
  - Advance when duration expires.

- Track **consecutive failures** (in-memory) and automatically **skip** that source for the next X rotations (e.g., X=2).
- For YouTube:

  - If the Player API errors (embedding disabled), switch to generic iframe mode once (best effort) before marking failed.

- For HLS:

  - If Hls.js fails to parse the manifest, surface the error, then fallback to “Video unavailable”.

- Respect Page Visibility API to **pause** media when the tab is not visible.

---

## 8) Accessibility / Kiosk / Autoplay Policies

- Keep default **muted** to comply with autoplay rules.
- Add a settings toggle (optional) to **allow audio**; if enabled, likely only plays after the first user interaction with the page.
- Always set `playsinline` to avoid forced fullscreen on iOS.

---

## 9) Settings UI — Implementation Notes

- The settings modal lives under `views/` and corresponding client code under `src/` (UI controllers). Add a **Video** section consistent with style/DOM used by other settings.
- Persist changes immediately to `ws.video.sources`.
- If the project has **“Copy Permalink”**, add a “**Include videos**” checkbox. When on, pack the minimal representation (title/url/duration) into repeated `video` params (base64url). On parse, hydrate defaults.

---

## 10) Build & Dependencies

- **No new baseline deps** required.
- Add **Hls.js** as an **optional**, **lazy-loaded** module:

  - In `package.json` devDependencies or ship a local copy under `src/vendor/` (project strives for minimal libraries; conditional load aligns with that ethos).

- Ensure `gulp/webpack` picks up the new modules. If the build bundles by entry globs, include `src/displays/video/*.mjs`.
- Both **Static** and **Server** deployment modes should work (server mode benefits caching).

---

## 11) Testing & QA Checklist

**Functional:**

- Add 3 sources: YouTube, `.m3u8`, generic iframe. Verify detection and render.
- Set distinct titles and durations; confirm header shows the configured title and the screen holds for the correct duration.
- Confirm pre-warm (near-instant start) by observing the first frame timing across rotations.

**Policy & Edge Cases:**

- Autoplay muted works in Chrome, Safari (iOS), Firefox.
- `.m3u8` on Safari (native HLS) and on Chrome/Firefox via Hls.js.
- Generic iframe with and without `X-Frame-Options`.
- Page hidden → media paused; page visible → resumes on next Video show.
- Large playlist (10+ video sources) does not balloon memory—disposing rules work.

**Proxy/CORS (server mode):**

- If configured, `.m3u8` and segment requests flow through proxy with cache hits visible in server logs.

**Accessibility & UI:**

- Keyboard focus doesn’t get trapped in iframes.
- Settings add/remove/reorder persists, survives refresh, and (if enabled) serializes into permalink.

---

## 12) Acceptance Criteria

- A **Video** screen appears as part of the rotation when at least one source is configured.
- Users can **add/edit/remove** multiple video sources, set **title** and **duration**, and the screen shows the title in the WeatherStar header.
- Autodetection chooses **YouTube**, **HLS**, or **IFRAME** modality correctly.
- Videos **start seamlessly** when the panel appears (pre-warm implemented).
- Default **muted** playback; optional loop.
- Rotation timing remains stable and aligns with other screens’ cadence.
- No regressions in **Development** vs **Production** modes and **Static** vs **Server** deployments.

---

## 13) Implementation Steps (Checklist for the LLM/PR)

1. **Data & Settings**

   - Add `ws.video.sources` read/write helpers where other settings are centralized.
   - Implement parsing of `?video=` repeated params (base64url JSON compact form); hydrate defaults.

2. **UI**

   - Update settings view (`views/*`) to include “Video” section with the fields described, consistent markup/classes.
   - Wire inputs to localStorage; validate and show inline errors.

3. **Display Class**

   - Create `src/displays/VideoDisplay.mjs`:

     - Constructor accepts `source` object.
     - Implements lifecycle: `mount(el)`, `show()`, `hide()`, `dispose()`, `durationMs()`.
     - Internally, create one of three **renderers** using helpers.

4. **Helpers**

   - `src/displays/video/youtube.mjs`: iframe builder, Player API controller, pre-warm/cue utilities.
   - `src/displays/video/hls.mjs`: `<video>` builder, native/Hls.js attach, pre-warm logic.
   - `src/displays/video/iframe.mjs`: generic iframe builder and best-effort pre-warm.
   - Small `utils.js` for source autodetection and preconnect insertion.

5. **Slideshow Integration**

   - Where displays are registered, map `ws.video.sources` → create a `VideoDisplay` instance per source; inject into the rotation at the chosen position.

6. **SASS**

   - Add `_video.scss` and import it into the main bundle. Ensure safe-area sizing.

7. **Optional Server/Proxy**

   - If desired, whitelist configured video origins in the server proxy to allow caching/CORS for `.m3u8` and segments (documented as optional).

8. **QA**

   - Run through the test checklist above in both **npm start** and **DIST=1 npm start** modes; verify behavior also matches the app’s documented deployment modes.

---

## 14) Notes on Conventions & Compatibility

- Keep changes **library-light** and use **conditional** loading for Hls.js to remain aligned with the project’s “minimal library” ethos.
- Preserve the app’s **rotation** model and “refresh only on slideshow repeat” rhythm rather than reloading video sources mid-cycle.
- Keep the **header** markup identical to other displays so the existing clock and styling continue to work.
- Provide clear **error states** and **skip logic** so a broken video doesn’t stall the rotation.

---

### References (repo docs & context)

- Repo root & README (architecture, deployment modes, proxy/static options, tech stack & conventions).
- Live site (confirms the rotation of multiple screens and header style). ([WeatherStar][4])
- International fork README (class-per-display, rotation, and modernization notes; conceptually identical patterns).
- Ecosyste.ms repo metadata (confirms project makeup & update recency).

---

[4]: https://weatherstar.netbymatt.com/?utm_source=chatgpt.com "WeatherStar 4000+"

---

# PR Checklist (Embedded Video screen for WeatherStar 4000+)

**Context**

- This repo uses ES modules, a class-per-display pattern, SASS, and a Gulp/Webpack build; supports static and server modes; and persists user config with a permalink feature. Keep changes library-light and match existing conventions.

## Scope

- [ ] Introduce a new **Video** screen that participates in the normal screen rotation with the standard **WeatherStar header**.
- [ ] Users can configure **one or more** video sources (YouTube, direct `.m3u8` HLS, or arbitrary embeddable iframe URLs).
- [ ] For each source, expose **title**, **url**, **durationSec** (+ sensible defaults: muted=true, loop=true, preloadSec=5).
- [ ] **Autodetect** modality: `youtube` | `hls` | `iframe` (fall back to explicit type override if provided).
- [ ] **Pre-warm** media before show-time for seamless start.
- [ ] Respect existing rotation cadence; do **not** stall slideshow if a video is slow or fails (show header + “Video unavailable,” then advance on schedule).
- [ ] Minimal dependencies; **conditionally** load Hls.js only when needed (m3u8 + no native HLS).
- [ ] Compatible with both **Server** (proxy) and **Static** modes (no server hard-require).

## Data & Settings

- [ ] Add a new persisted array `ws.video.sources` (localStorage) with objects:
      `{ title, url, durationSec, muted=true, loop=true, preloadSec=5, poster?, startAt?, endAt?, type="auto" }`.
- [ ] Extend **Permalink** support with repeated `video=` params (base64url-encoded compact JSON: title/url/duration). Parsing hydrates defaults. (Keep optional to avoid long URLs.)
- [ ] (Optional) Map selected items to `WSQS_…` env vars for Docker/server deployments in line with README env/permalink guidance.

## Settings UI

- [ ] In the existing **Settings** modal, add a **Video** section:

  - [ ] “Add Video” button.
  - [ ] Per-source fields: Title (text), URL (text), Duration (seconds), Type (auto/youtube/hls/iframe), Muted (toggle), Loop (toggle), Preload lead-time (seconds), optional Poster, StartAt/EndAt (seconds).
  - [ ] Remove control; persist immediately.
  - [ ] Validate URL; warn (don’t block) for non-embeddable iframe URLs.

## Display Integration

- [ ] Implement `VideoDisplay` with the same lifecycle hooks used by other screens (e.g., `mount`, `show`, `hide`, `dispose`, `durationMs`), one instance per configured source.
- [ ] Inject created instances into the rotation **without changing the existing fixed order paradigm** (insert near the end by default). Ensure per-screen enable/disable behavior matches existing checkbox logic.
- [ ] Duration honored from `durationSec`; don’t extend a slot if media is late to start.

## Rendering Modalities

- [ ] **YouTube**: use `youtube-nocookie.com/embed` + `autoplay=1&mute=1&playsinline=1&controls=0&rel=0&modestbranding=1&enablejsapi=1` (+ `origin`). Control with postMessage API (play/pause/seek).
- [ ] **HLS**: If native support (`canPlayType('application/vnd.apple.mpegURL')`) use `<video>`; else lazy-load **Hls.js**, `hls.loadSource(url); hls.attachMedia(video)`.
- [ ] **IFRAME**: generic `<iframe>` with `allow="autoplay; encrypted-media; picture-in-picture"` and `allowfullscreen`.

## Pre-warm & Seamless Start

- [ ] `preloadSec` before display start: build hidden player, start muted for a tick (if policy allows), then pause & seek to `startAt`.
- [ ] At show-time: unhide and play immediately. At hide-time: pause; optionally dispose to control memory.
- [ ] Insert `<link rel="preconnect">` hints once per origin (YouTube hosts, m3u8 origin).

## Error Handling

- [ ] If not ready within `preloadSec + 5s`, show “Video unavailable” body; still advance on schedule.
- [ ] Track transient failures and skip a repeatedly failing source for the next N rotations.

## Styling

- [ ] Add `_video.scss`; maintain safe-area sizing, header alignment, and aspect handling (`object-fit: cover` for `<video>` and a wrapper for iframes). No new fonts.

## Proxy / Server (optional)

- [ ] In server/proxy mode, optionally allow whitelisted video origins for CORS and cache of `.m3u8`/segments (no requirement in static mode).

## QA

- [ ] Validate in **Development** and **Production** modes, including **Static** vs **Server** deployments per README.
- [ ] Test YouTube, native-HLS (Safari), Hls.js path (Chrome/Firefox), and generic iframes.
- [ ] Verify kiosk/permalink behaviors still work (this repo exposes both and fixes display order with checkboxes).
- [ ] Confirm rotation timing and header consistency against the live reference.

---

# Scaffold Task Plan (branch: `feature/video-display`)

> The file/folder names below reflect the repo structure in **README** and tree (e.g., `src/`, `views/`, `server/`, `proxy/`, `gulp/`). Adjust only if you find newer paths while coding.

### Task 1 — Plumbing: data model & helpers

- **Add** `src/settings/videoSettings.mjs`

  - `getVideoSources()`, `setVideoSources()`, schema/defaults, validation.
  - Permalink encode/decode helpers for repeated `video` params (compact JSON; base64url).

- **Modify** `index.mjs` (or the central app bootstrap) to:

  - Parse `video=` params on load; hydrate into localStorage defaults.

- **Reason:** Establish a clean API for the rest of the feature, consistent with existing settings/permalink patterns.

### Task 2 — Settings UI (no visuals yet in rotation)

- **Add** view partials under `views/`:

  - `views/partials/settings-video.html` (or the equivalent form section the repo uses).

- **Add** `src/ui/settings/videoSettingsController.mjs`

  - Wire inputs ⇄ `videoSettings` helpers; live validation; add/remove/reorder list logic.

- **Modify** settings modal aggregator (same file that mounts other settings sections) to include the **Video** section.
- **Reason:** Full user-facing configuration, persistent via localStorage and (optionally) permalink.

### Task 3 — Display class (skeleton)

- **Add** `src/displays/VideoDisplay.mjs`

  - Implements display lifecycle; accepts one `source` from `videoSettings`.
  - Renders header markup using the **existing header DOM/classes** so clock/styles “just work.”
  - Body stub container for the player.

- **Add** `src/scss/displays/_video.scss`; import into the main SASS bundle.
- **Reason:** Establish the screen in the same architectural style as other displays.

### Task 4 — Modality helpers + autodetect

- **Add** `src/displays/video/detect.mjs` (host/extension logic; explicit `type` override).
- **Add** `src/displays/video/youtube.mjs` (iframe builder + Player API controller).
- **Add** `src/displays/video/hls.mjs` (native/Hls.js attach; poster/startAt/endAt; lazy load Hls.js).
- **Add** `src/displays/video/iframe.mjs` (generic iframe, best-effort autoplay).
- **Modify** `VideoDisplay.mjs` to bind to these helpers and choose modality at runtime.
- **Reason:** Encapsulate each modality for maintainability.

### Task 5 — Pre-warm pipeline

- **Add** `src/displays/video/prewarm.mjs`

  - Hidden build/show/hide lifecycle hooks; preconnect insertion; timing windows based on `preloadSec`.

- **Modify** the slideshow controller (where other screens are advanced) to call `display.prewarm(tMinus)` if the base class supports it (or add a guarded hook), without changing global timing semantics.
- **Reason:** Guarantee seamless start while preserving cadence.

### Task 6 — Rotation integration

- **Modify** the central **display registry** (where the fixed order is constructed) to:

  - Map `getVideoSources()` → create one `VideoDisplay` per source.
  - Insert at the **default end-adjacent** position; ensure enable/disable flags mirror other screens.

- **Reason:** Keep the project’s documented fixed ordering and checkbox semantics.

### Task 7 — Error states & skip logic

- **Add** transient failure accounting inside `VideoDisplay`:

  - Timeout if not ready by `preloadSec + 5s`; show “Video unavailable.”
  - Skip N rotations after consecutive failures.

- **Reason:** Robustness so video never stalls the loop.

### Task 8 — Optional proxy tuning (server mode)

- **Modify** `server/` and `proxy/` config to:

  - Whitelist configured video origins for CORS/cache if an admin opts in; keep **off** by default.

- **Reason:** Helpful for `.m3u8` CDN edge cases in **server** deployments, but not required.

### Task 9 — QA harness & docs

- **Add** `tests/manual/video-sources.json` with 3 samples (YouTube, m3u8, generic iframe).
- **Update** `README.md` with a new “Embedded Video” section:

  - How to add sources; autoplay/audio caveats; permalink packing; server-mode notes; kiosk considerations.
  - State that the feature works in **both static and server** modes; mention the build/run commands (already documented).

### Task 10 — Polish

- **Tweak** `_video.scss` for safe-area fit and scanline/texture parity if used elsewhere.
- **Add** iOS `playsinline` attributes and user-gesture note for optional audio.
- **Finalize** accessibility notes (focus not trapped in iframes; pause on Page Visibility change).

---

## “Definition of Done”

- The Video screen appears in rotation when at least one source is configured; title renders in the standard header; slot length matches `durationSec`.
- YouTube, HLS (native and Hls.js fallback), and iframe all function; videos start smoothly due to pre-warm.
- No regressions across **Development** vs **Production**, **Static** vs **Server** modes per repo’s documented modes; permalink and kiosk behaviors remain intact.
