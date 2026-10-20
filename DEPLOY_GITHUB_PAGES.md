# GitHub Pages Deployment Guide

This guide covers deploying WeatherStar 4000+ to GitHub Pages.

## Prerequisites

- GitHub account
- Repository pushed to GitHub
- Node.js and npm installed locally

## Setup (One-time)

### 1. Enable GitHub Pages in Repository Settings

1. Go to your repository on GitHub
2. Click **Settings** → **Pages**
3. Under "Build and deployment":
   - **Source**: Select "GitHub Actions" (recommended) OR "Deploy from a branch"
   - If using branch: Select `gh-pages` branch and `/ (root)` folder

### 2. Choose Deployment Method

You have two options:

## Option A: Automatic Deployment with GitHub Actions (Recommended)

The `.github/workflows/deploy.yml` file is already configured. Every push to `main` will automatically:

1. Build the SPA
2. Deploy to GitHub Pages

**Setup:**

```bash
# Just push your code - deployment happens automatically!
git add .
git commit -m "Enable GitHub Pages deployment"
git push origin main
```

Your site will be live at: `https://jhammond045.github.io/ws4kp/`

## Option B: Manual Deployment

Use the deployment script for manual control:

```bash
# Run the deployment script
./deploy-gh-pages.sh
```

This script will:

1. Build the SPA (`npm run build:spa`)
2. Create/update the `gh-pages` branch
3. Push to GitHub

## Important Configuration Notes

### Base URL Configuration

If deploying to `username.github.io/repository-name/`, you may need to update asset paths.

Check `gulpfile.mjs` and ensure paths are relative or properly configured for the subdirectory.

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

1. Add a `CNAME` file to the `dist` folder before building
2. Configure DNS settings with your domain provider
3. Enable HTTPS in GitHub Pages settings

## Troubleshooting

### Site not updating?

- Check the Actions tab for build errors
- Clear browser cache (Cmd+Shift+R or Ctrl+Shift+F5)
- Wait 2-3 minutes for GitHub's CDN to update

### 404 errors?

- Ensure GitHub Pages is enabled in repository settings
- Check that the `gh-pages` branch exists
- Verify the source is set correctly (GitHub Actions or gh-pages branch)

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

### With GitHub Actions:

```bash
# Make your changes
git add .
git commit -m "Update site"
git push origin main
# Deployment happens automatically
```

### With Manual Deployment:

```bash
# Make your changes, then:
./deploy-gh-pages.sh
```

## Build Only (No Deploy)

To test the build locally without deploying:

```bash
npm run preview
# Opens http://localhost:7654
```
