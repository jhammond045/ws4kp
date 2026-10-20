# Video Feature Task Notes

## TODO

- [x] Research external references for video feature requirements and architecture patterns (README, related repos, live site)
- [x] Audit existing code: settings persistence, display registration, rotation order, build system
- [x] Implement video settings storage helpers and defaults
- [x] Extend permalink/env parsing and generation for video sources
- [x] Build settings UI section for managing video sources
- [x] Create VideoDisplay class with modality helpers (YouTube, HLS, iframe)
- [x] Implement prewarm logic, error handling, skip management
- [x] Integrate video displays into rotation ordering
- [x] Add styling (`_video.scss`) and ensure assets are included in build
- [ ] Optionally update proxy/server for video origins (deferred)
- [x] Write documentation updates and sample configs/tests
- [ ] Run lint/tests and verify end-to-end

## Findings

- Project uses ES modules under `server/scripts/modules` for display logic and settings.
- Displays register through `registerDisplay` in `navigation.mjs` with navigation timings managed by `WeatherDisplay` base class.
- Settings UI is generated dynamically via `Setting` class; custom RSS feature shows how to add bespoke controls.
- Permalink generation currently serializes all checkbox/select/text inputs directly via query parameters.
- Video runtime hooks must be imported explicitly via `server/scripts/index.mjs` to participate in bundling.
