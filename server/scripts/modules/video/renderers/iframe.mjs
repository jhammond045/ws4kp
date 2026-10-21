import { isAllowedMediaUrl } from '../sources.mjs';

// a page from this site (or about:blank, which takes this site's origin) could remove its own sandbox
// if it also had allow-same-origin, so only other http(s) sites get it
// known limit (WORK.md 2.2C): this only sees the URL as written, another site that redirects back to this
// origin keeps allow-same-origin
export const iframeSandbox = (src, origin) => {
	const tokens = ['allow-scripts', 'allow-presentation', 'allow-popups'];
	if (isAllowedMediaUrl(src) && new URL(src.trim()).origin !== origin) tokens.push('allow-same-origin');
	return tokens.join(' ');
};

class IframeRenderer {
	// waitForLoad: mount resolves on the frame's load event instead of right away, only for the plain YouTube embed fallback
	// a user's web page can keep a request open forever (a camera's MJPEG stream) and never fire load
	constructor(source, { waitForLoad = false } = {}) {
		this.source = { ...source };
		this.waitForLoad = waitForLoad;
		this.iframe = null;
		this.container = null;
		// paused iframes are emptied, there's no way to pause an unknown page
		this.blanked = false;
	}

	setSource() {
		this.iframe.sandbox = iframeSandbox(this.source.url, window.location.origin);
		this.iframe.src = this.source.url;
		this.blanked = false;
	}

	async mount(container) {
		this.container = container;
		this.container.innerHTML = '';
		// Throwing lets the display show its "Video unavailable" card.
		if (!isAllowedMediaUrl(this.source.url)) {
			throw new Error('Refusing to embed a non-http(s) URL');
		}

		this.iframe = document.createElement('iframe');
		this.iframe.className = 'video-renderer__iframe';
		this.iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
		this.iframe.allowFullscreen = true;
		this.iframe.title = this.source.title || 'Embedded video';
		// keyboard focus stays on the page, where the OSD's keys work
		this.iframe.tabIndex = -1;
		// the fallback resolves once the page has loaded, so a host that never answers runs into the display's load timeout
		// a page that refuses to be framed still fires load, the browser shows its error page in the frame
		const loaded = this.waitForLoad && new Promise((resolve) => {
			this.iframe.addEventListener('load', resolve, { once: true });
		});
		this.setSource();

		this.container.append(this.iframe);
		if (loaded) await loaded;
	}

	async prewarm() {
		if (this.iframe) {
			// No explicit prewarm support for generic iframes.
		}
	}

	play() {
		if (!this.iframe || !this.blanked || !isAllowedMediaUrl(this.source.url)) return;
		this.setSource();
	}

	pause() {
		if (!this.iframe || this.blanked) return;
		this.iframe.sandbox = iframeSandbox('about:blank', window.location.origin);
		this.iframe.src = 'about:blank';
		this.blanked = true;
	}

	dispose() {
		if (this.iframe) {
			this.iframe.remove();
			this.iframe = null;
		}
	}

	update(source) {
		this.source = { ...source };
		if (!this.iframe) return;
		if (!isAllowedMediaUrl(this.source.url)) {
			this.iframe.removeAttribute('src');
		} else if (!this.blanked) {
			this.setSource();
		}
	}
}

export default IframeRenderer;
