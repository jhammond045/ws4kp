# GitHub Pages Deployment Guide

This guide covers deploying WeatherStar 4000+ to GitHub Pages.

## Prerequisites

- GitHub account
- Repository pushed to GitHub
- Node.js 20 or newer and npm, to build and test locally (the workflow itself uses Node 22)

## Setup (One-time)

### 1. Enable GitHub Pages in Repository Settings

1. Go to your repository on GitHub
2. Click **Settings** → **Pages**
3. Under "Build and deployment", set **Source** to "GitHub Actions"

The site is deployed only by the workflow. Pages does not serve a `gh-pages` branch in this mode, so a leftover one from older manual deploys can be deleted.

## Deployment with GitHub Actions

The `.github/workflows/deploy.yml` file is already configured. Every push to `main` will:

1. Install dependencies with `npm ci` (Node 22)
2. Run `npm test` and `npm run lint`; a failure stops the deploy
3. Build the site with `npm run build:spa` (the same as `npm run build`: `gulp/build.mjs` bundles the JavaScript, compiles the SCSS and copies the assets into `dist/`; see [BUILD_SPA.md](BUILD_SPA.md))
4. Deploy `dist/` to GitHub Pages

Pull requests run a separate check (`.github/workflows/lint-build.yaml`, Node 24) that tests, lints and builds without deploying.

**Setup:**

```bash
# Commit your changes, then push; the workflow deploys
git push origin main
```

Your site will be live at: `https://jhammond045.github.io/ws4kp/`

You can also run the workflow by hand from the Actions tab (it has a `workflow_dispatch` trigger).

## Important Configuration Notes

### Base URL Configuration

The site is served from a subpath (`/ws4kp/`), so every asset and data URL in the app must be relative (`data/stations.json`, not `/data/stations.json`). A root-absolute path works locally and 404s on Pages.

### CORS and API Access

The app makes requests to:

- `api.weather.gov` - National Weather Service API
- YouTube embeds (if configured)
- HLS video streams (if configured)

GitHub Pages doesn't provide server-side proxy capabilities, so:

- ✅ NWS API should work (supports CORS)
- ⚠️ Some video sources may need CORS headers
- ⚠️ Geolocation requires HTTPS (GitHub Pages provides this)

### Custom Domain (Optional)

To use a custom domain:

1. Set the domain under **Settings** → **Pages** → **Custom domain**. With workflow deployments this setting is what counts; a `CNAME` file in the artifact is not required.
2. If you also want a `CNAME` file in the build, put it in `server/` (not `dist/`, which the build wipes) and add `'server/CNAME'` to `otherFiles` in `gulp/build.mjs`.
3. Configure DNS settings with your domain provider
4. Enable HTTPS in GitHub Pages settings

## Troubleshooting

### Site not updating?

- Check the Actions tab for build errors
- Clear browser cache (Cmd+Shift+R or Ctrl+Shift+F5)
- Wait 2-3 minutes for GitHub's CDN to update

### 404 errors?

- Ensure GitHub Pages is enabled in repository settings, with Source set to "GitHub Actions"
- Check that the latest "Deploy to GitHub Pages" run succeeded
- If only some files 404 (data, radar tiles), look for a root-absolute path; see Base URL Configuration above

### API errors?

- Check browser console for CORS errors
- Verify you're accessing via HTTPS
- Some APIs may not work from GitHub Pages due to CORS policies

## Alternative Hosting Options

If GitHub Pages doesn't meet your needs, consider:

- **Netlify**: Drag-and-drop the `dist` folder or connect to Git (supports redirects/proxies)
- **Vercel**: Better support for SPA routing and edge functions
- **Cloudflare Pages**: Fast global CDN with Workers for serverless functions
- **Self-hosted**: Use the Node.js server for full control (see README.md)

## Updating Your Site

Commit your changes and push to `main`. The workflow tests, lints, builds and deploys.

## Build Only (No Deploy)

To test the build locally without deploying:

```bash
npm run build
STATIC=1 DIST=1 npm start
# then open http://localhost:8080/
```

`STATIC=1` turns off the caching proxy, so the browser talks to the weather services directly, as it does on GitHub Pages. This serves the site from `/`; to check subpath hosting, copy `dist/` into a `ws4kp/` folder under any static file server and open `/ws4kp/`.
