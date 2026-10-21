# Agent Task: “OSD-Style In-Frame Control Menu” for `ws4kp` (WeatherStar 4000+)

## 0) Repository & Constraints

- **Repo:** [https://github.com/netbymatt/ws4kp](https://github.com/netbymatt/ws4kp)
- **Conventions:** ES modules, class-per-display, SASS, minimal deps, Webpack/Gulp build, localStorage + permalink settings, static and server (proxy) run modes.
- **Do not** add heavy libraries or fonts. Reuse existing app containers (header/clock, inner “safe area”), rotation timing, and settings persistence.
- We are **moving the controls UI inside** the WeatherStar frame and restyling it as a 90s **OSD** (on-screen display) setup menu.

**You must deliver:**

1. An **OSD** control menu **inside** the WeatherStar content frame.
2. Grouped categories; mouse & keyboard navigation.
3. Replace toasts with **OSD-style modals** (fullscreen takeover with centered content and a title line like `--------- CONFIRM ---------`).
4. Keep permalink + sticky settings behavior; work in both server and static modes.
5. Pause slideshow while OSD is open; resume on close.

---

## 1) UX / Visual Spec (OSD)

**Placement**

- Menu renders **within** the WeatherStar safe area (same inner container that screens use), centered, fixed width, overscan-friendly margins.

**OSD look**

- Colors (CSS vars you define in a new partial):

  - `--osd-blue: #0030c8;` (panel background)
  - `--osd-blue-dark: #001a80;` (borders/inset)
  - `--osd-white: #e6f0ff;` (text)
  - `--osd-gray: #9bb6ff;` (legend/help)
  - `--osd-focus-bg: #d0e0ff;` (focus bar)
  - `--osd-focus-fg: #001a80;`

- Font: reuse existing app font stack; fallback to a mono/system-mono for OSD feel. No new assets.
- Title: a centered line like `--------- MENU ---------`.
- Two-column layout:

  - **Left:** category list (vertical).
  - **Right:** items for the selected category (rows with label + value).

- Focus bar: a single sliding highlight (invert colors using `--osd-focus-*`).
- Footer legend (always visible):
  `SELECT: ▲ ▼   SET: ▶ ◀   ENTER: ACTION   BACK: ESC`

**Interaction**

- **Keyboard:**

  - `ArrowUp/Down`: move focus within a column.
  - `Tab`/`Shift+Tab`: swap column focus (Categories ↔ Items).
  - `ArrowLeft/Right`: change the value (toggle/enum/number).
  - `Enter`: action/confirm/open subpanel.
  - `Escape`: back or close; if a modal or subpanel is open, close that first.

- **Mouse:** hover previews focus; click activates/toggles; arrows in value cells are clickable.
- **Focus model:** roving tabindex; initial focus = first item of last-visited category.

**Categories & starter items**

1. **SET UP WEATHER**

   - Location (opens existing location picker as an OSD modal)
   - Units (`US`/`Metric`)
   - Widescreen (toggle)

2. **SCREENS**

   - Enable/disable per display (render as rows with ON/OFF; map to existing screen checkboxes)
   - Screen speed multiplier (`0.75x`, `1.00x`, `1.25x`, `1.50x`)

3. **AUDIO/VIDEO**

   - Music on/off (if present)
   - Music volume (0–100, if present; otherwise omit gracefully)

4. **STYLE**

   - Scan lines (toggle)
   - Kiosk mode (toggle) — warn via **OSD modal** about kiosk behavior on enable

5. **SYSTEM**

   - Copy Permalink → show **OSD modal**:
     `--------- PERMALINK ---------`
     [permalink in a readonly input; “OK” line; instructions]
   - Reset to Defaults → **OSD modal** confirm
   - About → **OSD modal** with version/credits

---

## 2) OSD-Style Modal Rules

**Definition:** A **modal** is a fullscreen takeover overlay **inside** the WeatherStar content frame (not the entire browser). It uses OSD colors, centers text, and includes a top banner line like `--------- TITLE ---------`.

**Behavior**

- Modal blocks interaction with the OSD menu beneath.
- Keyboard: `Enter` = confirm/primary action; `Escape` = cancel/back.
- Provide a simple selection row where appropriate (e.g., `[ OK ]` or `[ OK ]   [ CANCEL ]` rendered as OSD rows).
- Copy-permalink modal: focus the input and select content; provide `[ OK ]` closes.
- Replace any existing toasts/snackbars with such modals (e.g., after copy, show a brief OSD modal stating “Copied to clipboard” with an `[ OK ]` row).

---

## 3) Architecture & File Layout

Add new UI modules and styles; keep code small and cohesive.

```
src/ui/osd/
  osdMenu.mjs              // controller + state machine (open/close, pause/resume slideshow)
  osdMenu.model.mjs        // schema + adapters to existing settings & permalink keys
  osdMenu.view.mjs         // DOM factory for columns/rows/legend; render/update
  osdMenu.keyboard.mjs     // roving tabindex + key handlers
  osdMenu.mouse.mjs        // click/hover handlers
  osdModal.mjs             // reusable OSD-style modal (fullscreen takeover within safe area)
src/scss/ui/_osd.scss      // OSD palette, layout, menu + modal styles
views/partials/osd-menu.html    // static scaffolding (slots populated by view)
views/partials/osd-modal.html   // modal scaffolding (title + body slots)
```

**Integrations to edit**

- App bootstrap (e.g., `index.mjs` / central UI initializer):

  - Mount `osdMenu` inside the same container as content screens.
  - Wire existing Settings/Menu trigger to `osdMenu.toggle()`.
  - Ensure slideshow timers **pause** while the OSD is open and **resume** when closed.

- SASS entry: import `_osd.scss`.

---

## 4) Model & Settings Binding

Create a **menu schema** that maps directly to existing settings & permalink keys. Implement `get/set` adapters per item so the OSD simply calls into the same storage model the current UI uses.

Example (pseudocode):

```js
export const osdModel = {
  categories: [
    { id: 'setup', title: 'SET UP WEATHER', items: [
      { id: 'location',   type: 'action', onEnter: openLocationModal }, // wraps existing picker
      { id: 'units',      type: 'enum',   options: ['us','metric'], get, set },
      { id: 'widescreen', type: 'toggle', get, set }
    ]},
    { id: 'screens', title: 'SCREENS', items: mapExistingDisplaysToOnOffRows() },
    { id: 'av',      title: 'AUDIO/VIDEO', items: [...] },
    { id: 'style',   title: 'STYLE', items: [...] },
    { id: 'system',  title: 'SYSTEM', items: [
      { id: 'permalink', type:'action', onEnter: openPermalinkModal },
      { id: 'reset',     type:'action', onEnter: openResetConfirmModal },
      { id: 'about',     type:'action', onEnter: openAboutModal }
    ]}
  ]
};
```

**Permalink**

- Keep the current builder/keys. The **Copy Permalink** action opens an OSD modal showing the link in a readonly input (pre-selected), plus `[ OK ]`. Attempt clipboard copy; even if it fails, the user can copy manually.

**Kiosk**

- Enabling kiosk opens an OSD modal explaining behavior; on confirm, apply setting and close modal.

---

## 5) Rendering & Input

**View**

- Two columns grid. Rows are equal-height; label left, value right.
- Value cell types:

  - `toggle`: text `ON`/`OFF`; click or ◀/▶ flip state.
  - `enum`: cycle values with ◀/▶; optional mini-subselect (avoid if possible).
  - `number`: ◀/▶ step; optional limited direct number entry.
  - `action`: ENTER or click invokes its handler.

- Sliding focus bar implemented with `transform` for snappy OSD feel (50–100ms).

**Keyboard**

- Roving tabindex manager; prevent page scrolling while open.
- `Enter/Escape/Arrows/Tab` semantics as described.

**Mouse**

- Hover preview (visual only); click acts.

---

## 6) OSD Modal Component

**API (osdModal.mjs)**

```js
openOsdModal({
  title: '--------- TITLE ---------',
  body:  /* DOM or HTML string */,
  actions: [
    { id:'ok',    label:'OK',    primary:true,  onSelect: () => {...} },
    { id:'cancel',label:'CANCEL', primary:false, onSelect: close }
  ],
  autofocus: 'ok' // id of action to focus initially
});
```

**Behavior**

- Renders a **fullscreen takeover within the safe area** (absolute positioned over screens and the OSD menu).
- Keyboard: `Left/Right` moves between action buttons; `Enter` activates; `Escape` triggers cancel if present.
- On open, **pause** slideshow (if not already paused by menu). On close, resume if appropriate.
- Copy-permalink modal: include a readonly input; select text on open; try `navigator.clipboard.writeText()`; on success/failure, show an **OSD modal** acknowledgement (“Copied” / “Copy failed—please copy manually”) with `[ OK ]`.

---

## 7) Styling (`_osd.scss`)

- Scope under `.ws-osd` (menu) and `.ws-osd-modal` (modal).
- Menu panel:

  - `position:absolute; inset: 8% 12%; background: var(--osd-blue); color: var(--osd-white);`
  - `border: 2px solid var(--osd-blue-dark); box-shadow: 0 0 0 2px var(--osd-blue-dark) inset;`
  - Title centered; legend at bottom center in `--osd-gray`.

- Modal:

  - Same palette; a slightly darker backdrop overlay; title line at top; body centered; actions as OSD rows.

---

## 8) Integration Points

- Replace any toast/snackbar usage with **OSD modals**:

  - Copy permalink result → OSD modal “Copied”.
  - Reset confirm → OSD modal with OK/Cancel.
  - Kiosk warning → OSD modal with OK/Cancel.

- Ensure **opening OSD** pauses slideshow timers; **closing** resumes. Do not reorder displays.
- Respect existing kiosk behavior; if kiosk hides external chrome, OSD should still open (unless kiosk explicitly forbids settings—follow current behavior).

---

## 9) QA Checklist

- Works in **Development** and **Production** builds; **Static** and **Server** runs.
- Keyboard and mouse interactions as specified; focus never escapes while open.
- All mapped settings reflect immediately in the running app and persist to localStorage; permalink encodes them as before.
- OSD modals render correctly, block background input, and close on `Enter/Escape`.
- Rotation resumes at correct timing on close; no memory leaks.
- Kiosk: enabling via OSD modal behaves as documented in the project (locked-down mode).

---

## 10) Commit Plan (scaffold first)

1. **Scaffold & Styles**

   - Add `views/partials/osd-menu.html`, `views/partials/osd-modal.html`.
   - Add `src/scss/ui/_osd.scss` and import it.

2. **Model & Adapters**

   - Add `src/ui/osd/osdMenu.model.mjs` with schema and `get/set` adapters to existing settings/permalink keys.

3. **View**

   - Add `src/ui/osd/osdMenu.view.mjs` (columns, rows, focus bar, legend).

4. **Input**

   - Add `src/ui/osd/osdMenu.keyboard.mjs` and `src/ui/osd/osdMenu.mouse.mjs`.

5. **Modal Component**

   - Add `src/ui/osd/osdModal.mjs`; implement open/close, keyboard, action rows, copy-permalink body.

6. **Controller & Bootstrap**

   - Add `src/ui/osd/osdMenu.mjs` (open/close, pause/resume slideshow, subpanels via osdModal).
   - Wire the existing Settings/Menu trigger in the bootstrap to `osdMenu.toggle()`.

7. **Replace Toasts**

   - Search for any toast/snackbar usage; replace with osdModal calls.

8. **QA & Docs**

   - Verify modes, keyboard/mouse, kiosk, permalink.
   - Add README note: “OSD Menu,” with keys for shortcuts (`M` to open if applicable) and OSD modal behavior.

---

## 11) Definition of Done

- The **OSD** menu opens **inside** the WeatherStar frame, matches the retro OSD style, and supports mouse & keyboard per spec.
- All confirmations/alerts use **OSD-style modals** (fullscreen takeover with `--------- TITLE ---------`).
- Settings persist and encode into permalink as before.
- Slideshow pausing/resuming is correct; no regressions across build/run modes.
