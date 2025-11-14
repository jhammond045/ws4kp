const HLS_LIBRARY_URL = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js';

let hlsLibraryPromise;

const supportsNativeHls = () => {
	const video = document.createElement('video');
	return (
		typeof video.canPlayType === 'function'
    && video.canPlayType('application/vnd.apple.mpegURL') !== ''
	);
};

const loadHlsLibrary = async () => {
	if (window.Hls) {
		return window.Hls;
	}

	if (hlsLibraryPromise) return hlsLibraryPromise;

	hlsLibraryPromise = new Promise((resolve, reject) => {
		const script = document.createElement('script');
		script.src = HLS_LIBRARY_URL;
		script.async = true;

		script.onload = () => {
			if (window.Hls) {
				resolve(window.Hls);
			} else {
				reject(new Error('Hls.js failed to load'));
			}
		};

		script.onerror = () => {
			script.remove();
			reject(new Error('Unable to load Hls.js library'));
		};

		document.head.append(script);
	}).catch((error) => {
		hlsLibraryPromise = null;
		throw error;
	});

	return hlsLibraryPromise;
};

const waitForMetadata = (video) => {
	if (video.readyState >= video.HAVE_METADATA) {
		return Promise.resolve();
	}

	return new Promise((resolve, reject) => {
		const cleanup = () => {
			video.removeEventListener('loadedmetadata', onLoadedMetadata);
			video.removeEventListener('error', onError);
		};

		const onLoadedMetadata = () => {
			cleanup();
			resolve();
		};

		const onError = () => {
			cleanup();
			reject(new Error('Failed to load video metadata'));
		};

		video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
		video.addEventListener('error', onError, { once: true });
	});
};

class HlsRenderer {
	constructor(source) {
		this.source = { ...source };
		this.container = null;
		this.video = null;
		this.hls = null;
		this.usingNative = false;
		this.timeUpdateHandler = null;
	}

	createVideoElement() {
		const video = document.createElement('video');
		video.className = 'video-renderer__hls';
		video.playsInline = true;
		video.muted = this.source.muted !== false;
		video.loop = Boolean(this.source.loop)
      && (!this.source.startAt || this.source.startAt === 0)
      && (this.source.endAt === null || this.source.endAt === undefined);
		video.controls = false;
		video.preload = 'auto';
		video.setAttribute('webkit-playsinline', '');
		video.setAttribute('playsinline', '');
		if (this.source.poster) {
			video.poster = this.source.poster;
		}
		if (this.source.crossOrigin) {
			video.crossOrigin = this.source.crossOrigin;
		}
		return video;
	}

	async mount(container) {
		this.container = container;
		this.container.innerHTML = '';

		this.video = this.createVideoElement();
		this.container.append(this.video);

		await this.attachSource();
		await waitForMetadata(this.video);
		this.applyStartAndEndBounds();
	}

	async attachSource() {
		if (!this.video) return;

		if (supportsNativeHls()) {
			this.usingNative = true;
			this.video.src = this.source.url;
			return;
		}

		const Hls = await loadHlsLibrary();
		if (!Hls.isSupported()) {
			throw new Error('Hls.js reports unsupported environment');
		}

		this.hls = new Hls({
			autoStartLoad: true,
		});

		await new Promise((resolve, reject) => {
			const cleanup = () => {
				this.hls.off(Hls.Events.MEDIA_ATTACHED, onAttached);
				this.hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
				this.hls.off(Hls.Events.ERROR, onError);
			};

			const onAttached = () => {
				this.hls.loadSource(this.source.url);
			};

			const onManifestParsed = () => {
				cleanup();
				resolve();
			};

			const onError = (event, data) => {
				cleanup();
				reject(new Error(data?.details || 'Unknown Hls.js error'));
			};

			this.hls.on(Hls.Events.MEDIA_ATTACHED, onAttached);
			this.hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
			this.hls.on(Hls.Events.ERROR, onError);
			this.hls.attachMedia(this.video);
		});
	}

	applyStartAndEndBounds() {
		if (!this.video) return;
		if (this.timeUpdateHandler) {
			this.video.removeEventListener('timeupdate', this.timeUpdateHandler);
			this.timeUpdateHandler = null;
		}

		if (typeof this.source.startAt === 'number' && this.source.startAt > 0) {
			this.video.currentTime = this.source.startAt;
		}

		if (typeof this.source.endAt === 'number' && this.source.endAt > 0) {
			this.timeUpdateHandler = () => {
				if (!this.video) return;
				if (this.video.currentTime >= this.source.endAt) {
					if (this.source.loop) {
						this.video.currentTime = this.source.startAt || 0;
						this.video.play().catch(() => {});
					} else {
						this.video.pause();
					}
				}
			};
			this.video.addEventListener('timeupdate', this.timeUpdateHandler);
		}
	}

	async prewarm() {
		if (!this.video) return;
		try {
			await waitForMetadata(this.video);
			const playResult = this.video.play();
			if (playResult && typeof playResult.then === 'function') {
				await playResult;
			}
			this.video.pause();
			if (typeof this.source.startAt === 'number') {
				this.video.currentTime = this.source.startAt;
			}
		} catch (_error) {
			// Autoplay or buffering issues during prewarm can be ignored
		}
	}

	play() {
		if (!this.video) return;
		if (typeof this.source.startAt === 'number') {
			this.video.currentTime = this.source.startAt;
		}
		const result = this.video.play();
		if (result && typeof result.catch === 'function') {
			result.catch(() => {});
		}
	}

	pause() {
		if (!this.video) return;
		this.video.pause();
		if (this.source.muted !== false) {
			this.video.muted = true;
		}
	}

	update(source) {
		const previousUrl = this.source.url;
		this.source = { ...source };

		if (!this.video) return;

		this.video.muted = this.source.muted !== false;
		this.video.loop = Boolean(this.source.loop)
      && (!this.source.startAt || this.source.startAt === 0)
      && (this.source.endAt === null || this.source.endAt === undefined);

		if (previousUrl !== this.source.url) {
			this.reloadSource()
				.then(() => {
					if (!this.video) return;
					this.applyStartAndEndBounds();
				})
				.catch(() => {});
			return;
		}
		this.applyStartAndEndBounds();
	}

	async reloadSource() {
		if (!this.video) return;

		if (this.timeUpdateHandler) {
			this.video.removeEventListener('timeupdate', this.timeUpdateHandler);
			this.timeUpdateHandler = null;
		}

		if (this.hls) {
			this.hls.destroy();
			this.hls = null;
		}
		this.usingNative = false;

		await this.attachSource();
		await waitForMetadata(this.video);
		this.applyStartAndEndBounds();
	}

	dispose() {
		if (this.timeUpdateHandler && this.video) {
			this.video.removeEventListener('timeupdate', this.timeUpdateHandler);
			this.timeUpdateHandler = null;
		}

		if (this.hls) {
			this.hls.destroy();
			this.hls = null;
		}
		this.usingNative = false;

		if (this.video) {
			this.video.pause();
			this.video.removeAttribute('src');
			this.video.load();
			this.video.remove();
			this.video = null;
		}

		this.container = null;
	}
}

export default HlsRenderer;
