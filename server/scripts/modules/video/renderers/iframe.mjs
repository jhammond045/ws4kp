class IframeRenderer {
	constructor(source) {
		this.source = { ...source };
		this.iframe = null;
		this.container = null;
	}

	async mount(container) {
		this.container = container;
		this.container.innerHTML = '';

		this.iframe = document.createElement('iframe');
		this.iframe.className = 'video-renderer__iframe';
		this.iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
		this.iframe.allowFullscreen = true;
		this.iframe.setAttribute('loading', 'lazy');
		this.iframe.title = this.source.title || 'Embedded video';
		this.iframe.src = this.source.url;

		this.container.append(this.iframe);
	}

	async prewarm() {
		if (this.iframe) {
			// No explicit prewarm support for generic iframes.
		}
	}

	play() {
		if (this.iframe) {
			// Generic iframes cannot be controlled programmatically.
		}
	}

	pause() {
		if (this.iframe) {
			// If playback needs to stop, reload the iframe to reset state.
		}
	}

	dispose() {
		if (this.iframe) {
			this.iframe.remove();
			this.iframe = null;
		}
	}

	update(source) {
		this.source = { ...source };
		if (this.iframe) {
			this.iframe.src = this.source.url;
		}
	}
}

export default IframeRenderer;
