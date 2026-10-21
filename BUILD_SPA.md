# Building WeatherStar 4000+ as a Static Site

WeatherStar 4000+ can be built into a set of static files that run entirely in the browser and can be hosted on any static file server, including from a subpath such as `https://example.github.io/ws4kp/`.

The build produces:

- One bundled, minified JavaScript file (with a source map)
- The compiled, minified CSS (with a source map)
- Minified HTML
- Fonts, images, music and the music playlist
- The station and city data files

## Prerequisites

- Node.js 20 or newer (`engines.node` in `package.json`). The GitHub Pages workflow uses Node 22; the pull request check and the Dockerfiles use Node 24.
- npm

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

`npm run build:spa` is the same command under another name; the GitHub Pages workflow uses it.

Both run `npx gulp buildDist`, defined in `gulp/build.mjs`. It empties `dist/` (keeping `dist/readme.txt`) and then, in parallel:

1. Bundles `server/scripts/ws.mjs` and everything it imports with webpack into `dist/resources/ws.min.js`
2. Compiles `server/styles/scss/ws.scss` into `dist/resources/ws.min.css`
3. Renders `views/index.ejs` to `dist/index.html` and minifies it
4. Copies the fonts, images, music, `manifest.json`, `robots.txt`, icons, `.well-known/security.txt` and any custom scripts (`server/scripts/custom*.*`)
5. Copies the data files from `datagenerators/output/` to `dist/data/`
6. Writes `dist/playlist.json` from the music folder

The build compiles the CSS itself, so you don't need to run `npm run build:css` first.

### CSS for development mode

`npm start` (development mode) serves `server/styles/ws.min.css`, which is committed to the repository. After changing any SCSS file, update it with:

```bash
npm run build:css      # once
npm run watch:css      # rebuild on every change
```

Commit the updated `ws.min.css` and `ws.min.css.map` along with the SCSS change.

## Preview the build locally

Serve `dist/` with the bundled Express server. `STATIC=1` turns off the caching proxy, so the browser calls the weather services directly, the same as on a static host:

```bash
npm run build
STATIC=1 DIST=1 npm start
```

Then open `http://localhost:8080/`. Set `WS4KP_PORT` to use another port, for example `WS4KP_PORT=3000 STATIC=1 DIST=1 npm start`.

## Deploying

After `npm run build`, the `dist/` directory is the whole site. Upload its contents to any static host:

- **GitHub Pages:** use the included workflow; see [DEPLOY_GITHUB_PAGES.md](DEPLOY_GITHUB_PAGES.md)
- **Netlify, Vercel, Cloudflare Pages:** upload `dist/`, or connect the repository with `npm run build` as the build command and `dist` as the output directory
- **AWS S3, nginx, Apache or any web server:** copy the contents of `dist/` to the web root

### Notes

1. **Weather services:** The browser calls `api.weather.gov`, the SPC outlooks, the radar image archive and the HRRR model data directly. These allow cross-origin requests, so no proxy is needed.
2. **HTTPS:** GPS location and fullscreen need `https://` (or `localhost`).
3. **Subpath hosting:** The build works from a subpath such as `/ws4kp/` because every asset and data URL is relative. The app is a single page with no client-side routes, so no fallback route is needed.
4. **Cache headers (optional):**
   - `index.html`: a few minutes (`max-age=300`)
   - `resources/*.js`, `resources/*.css`: these keep the same name from one version to the next, so keep this short too, or purge the cache after a deploy
   - Images, fonts, music: long (`max-age=31536000`)

## Directory structure (after build)

```
dist/
├── index.html
├── manifest.json
├── robots.txt
├── playlist.json          # music playlist
├── data/                  # stations.json, regionalcities.json, travelcities.json
├── resources/
│   ├── ws.min.js          # the whole app, one bundle
│   ├── ws.min.js.map
│   ├── ws.min.css
│   └── ws.min.css.map
├── fonts/                 # Star4000 fonts
├── images/
├── music/
└── scripts/               # custom scripts, when there are any
```

## Troubleshooting

### Build fails with "Cannot find module"

Run `npm install`.

### Style changes don't show up

- In development mode (`npm start`), run `npm run build:css`; that mode serves the committed `server/styles/ws.min.css`.
- For the static build, run `npm run build` again and reload without the cache.

### Data files or radar tiles 404 on the host

Something is using a root-absolute path (`/data/...`). Every path in the app must be relative; see [Base URL Configuration](DEPLOY_GITHUB_PAGES.md#base-url-configuration).

## Changing the build

- `gulpfile.mjs` exports the gulp tasks
- `gulp/build.mjs` defines the build: `webpackOptions` for the JavaScript bundle, `otherFiles` for extra files to copy, and the `htmlmin` options in `compressHtml`
- `package.json` holds the npm scripts

## Support

- This fork (OSD menu, embedded video, static build): https://github.com/jhammond045/ws4kp/issues
- Upstream WeatherStar 4000+: https://github.com/netbymatt/ws4kp/issues
- Upstream documentation: https://github.com/netbymatt/ws4kp#readme
