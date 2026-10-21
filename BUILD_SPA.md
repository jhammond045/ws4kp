# Building WeatherStar 4000+ as a Standalone SPA

This document explains how to build and deploy WeatherStar 4000+ as a standalone Single Page Application (SPA) that can be hosted on any static file server.

## Overview

The application can be built into a fully static SPA that runs entirely in the browser. This build includes:

- Minified and bundled JavaScript
- Compiled and minified CSS
- Optimized HTML
- All required assets (fonts, images, music)
- Data files (stations, cities, etc.)

## Prerequisites

- Node.js 20 or newer (CI uses 22)
- npm

## Installation

First, install all dependencies:

```bash
npm install
```

## Build Commands

### Build the SPA

To build the complete standalone SPA:

```bash
npm run build:spa
```

This command will:

1. Compile SCSS to CSS (`npm run build:css`)
2. Bundle and minify JavaScript
3. Minify HTML
4. Copy all assets
5. Generate playlist and data files

Output directory: `./dist/`

### Individual Build Steps

You can also run individual build steps:

```bash
# Build CSS only
npm run build:css

# Build everything (same as build:spa but without CSS)
npm run build
```

## Preview the SPA Locally

To build and preview the SPA on a local development server:

```bash
npm run preview
```

This will:

1. Build the complete SPA
2. Start an HTTP server on `http://localhost:7654`
3. Disable caching for easy development
4. Enable CORS for API requests

Or, to just serve an already-built SPA:

```bash
npm run serve:spa
```

## Deployment

After running `npm run build:spa`, the `./dist/` directory contains a complete standalone application that can be deployed to any static hosting service:

### Static Hosting Options

- **Netlify**: Drop the `dist` folder or connect to Git
- **Vercel**: Deploy via CLI or Git integration
- **GitHub Pages**: Use the included workflow; see [DEPLOY_GITHUB_PAGES.md](DEPLOY_GITHUB_PAGES.md)
- **AWS S3**: Upload to S3 bucket with static website hosting
- **Cloudflare Pages**: Connect to Git repository
- **Any web server**: Copy `dist` contents to web root

### Important Notes for Deployment

1. **CORS Configuration**: The app makes requests to external weather APIs (api.weather.gov). Ensure your hosting platform allows CORS requests or use a proxy.

2. **HTTPS Required**: Many browser features (like geolocation and fullscreen) require HTTPS.

3. **Cache Headers**: Recommended cache settings:

   - `index.html`: 5-10 minutes (`max-age=300`)
   - `resources/*.js`, `resources/*.css`: 1 month (`max-age=2592000`)
   - Images, fonts: 1 year (`max-age=31536000`)
   - Music files: 1 year (`max-age=31536000`)

4. **Subpath hosting**: The build works from a subpath such as `/ws4kp/` as long as asset and data URLs stay relative. The app has a single page and no client-side routes, so no fallback route is needed.

## Directory Structure (after build)

```
dist/
├── index.html              # Main application entry point
├── manifest.json           # PWA manifest
├── robots.txt              # SEO robots file
├── data/                   # Weather station and city data
│   ├── stations.json
│   ├── regionalcities.json
│   └── travelcities.json
├── resources/              # Bundled and minified code
│   ├── ws.min.js          # Application JavaScript bundle
│   ├── vendor.min.js      # Third-party libraries
│   └── ws.min.css         # Compiled styles
├── fonts/                  # Star4000 font family
├── images/                 # All UI assets, icons, backgrounds
├── music/                  # Background music files
└── playlist.json          # Music playlist configuration
```

## Environment Variables

The build process supports the following environment variables (optional):

- `BUCKET`: S3 bucket for AWS deployment
- `BUCKET_PREVIEW`: S3 bucket for preview/staging
- `DISTRIBUTION_ID`: CloudFront distribution ID
- `DISTRIBUTION_ID_PREVIEW`: CloudFront preview distribution ID

These are only needed for AWS S3/CloudFront deployment.

## Development Workflow

1. **Make changes** to source files in `server/scripts/`, `server/styles/`, etc.
2. **Test locally** with the Node.js server: `npm run dev`
3. **Build SPA**: `npm run build:spa`
4. **Preview SPA**: `npm run serve:spa`
5. **Deploy** the `dist/` directory to your hosting platform

## Troubleshooting

### Build fails with "Module not found"

Run `npm install` to ensure all dependencies are installed.

### CSS not updating

Delete `server/styles/main.css` and run `npm run build:css` again.

### Changes not appearing in preview

- Clear browser cache
- Ensure you ran `npm run build:spa` after making changes
- Check that `http-server` is serving the `dist` directory

### CORS errors in production

Configure your hosting platform to allow CORS requests or set up a proxy for API calls.

## Advanced: Custom Build Configuration

The build process is configured in:

- `gulpfile.mjs` - Main build orchestration
- `gulp/publish-frontend.mjs` - Build tasks and AWS deployment
- `package.json` - Build scripts

To customize the build:

1. Edit `gulp/publish-frontend.mjs` to modify build tasks
2. Update `webpackOptions` for JavaScript bundling configuration
3. Modify `htmlmin` options in `compressHtml` for HTML minification settings

## Support

For issues or questions:

- This fork (OSD menu, embedded video, static build): https://github.com/jhammond045/ws4kp/issues
- Upstream WeatherStar 4000+: https://github.com/netbymatt/ws4kp/issues
- Upstream documentation: https://github.com/netbymatt/ws4kp#readme
