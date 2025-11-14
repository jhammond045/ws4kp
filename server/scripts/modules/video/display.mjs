import WeatherDisplay from '../weatherdisplay.mjs';
import STATUS from '../status.mjs';
import { detectSourceType, getPreconnectOrigins } from './detect.mjs';
import IframeRenderer from './renderers/iframe.mjs';
import YouTubeRenderer from './renderers/youtube.mjs';
import HlsRenderer from './renderers/hls.mjs';

const MIN_DURATION = 5;
const DEFAULT_TITLE = 'Video';
const MAX_TITLE_LENGTH = 18;
const preconnectedOrigins = new Set();

const RENDERERS = {
	youtube: YouTubeRenderer,
	hls: HlsRenderer,
	iframe: IframeRenderer,
};

const ensurePreconnect = (type, url) => {
	getPreconnectOrigins(type, url).forEach((origin) => {
		if (!origin || preconnectedOrigins.has(origin)) return;
		const link = document.createElement('link');
		link.rel = 'preconnect';
		link.href = origin;
		link.crossOrigin = 'anonymous';
		document.head.append(link);
		preconnectedOrigins.add(origin);
	});
};

const formatDisplayTitle = (title) => {
	if (typeof title !== 'string') return DEFAULT_TITLE;
	const trimmed = title.trim();
	if (!trimmed) return DEFAULT_TITLE;
	if (trimmed.length <= MAX_TITLE_LENGTH) return trimmed;
	return `${trimmed.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
};

class VideoDisplay extends WeatherDisplay {
	constructor(navId, elemId, source) {
		const initialTitle = formatDisplayTitle(source?.title);
		super(navId, elemId, initialTitle, true);
		this.source = { ...source };
		this.mode = detectSourceType(source);
		this.player = null;
		this.ready = false;
		this.failed = false;
		this.failureCount = 0;
		this.lastError = null;
		this.buildTiming();
		this.prewarmTimeout = null;
		this.displayTitle = initialTitle;
		this.showOnProgress = false;
		this.includeInScreensCategory = false;
		this.isEnabled = true;
		// Enable time display for video screens
		this.okToDrawCurrentDateTime = true;
		if (typeof window !== 'undefined' && window?.localStorage) {
			window.localStorage.removeItem(`display-enabled: ${this.elemId}`);
		}
	}

	buildTiming() {
		const duration = Math.max(
			MIN_DURATION,
			Number(this.source.durationSec) || MIN_DURATION,
		);
		this.timing = {
			totalScreens: 1,
			baseDelay: 1000,
			delay: duration,
		};
		this.calcNavTiming();
	}

	loadTemplates() {
		this.elem = document.querySelector(`#${this.elemId}-html`);
		if (!this.elem) return;

		if (this.elem.dataset.initialized === 'true') {
			this.updateHeader();
			return;
		}

		this.elem.dataset.initialized = 'true';
		this.elem.classList.add('video-display-root');
		this.elem.innerHTML = '';

		const display = document.createElement('div');
		display.className = 'display display--video';
		display.dataset.display = 'video';

		const header = document.createElement('div');
		header.className = 'header';

		const logo = document.createElement('div');
		logo.className = 'logo';
		const logoImg = document.createElement('img');
		logoImg.src = 'images/logos/logo-corner.png';
		logo.append(logoImg);

		this.titleElem = document.createElement('div');
		this.titleElem.className = 'title single';

		const dateElem = document.createElement('div');
		dateElem.className = 'date-time date';

		const timeElem = document.createElement('div');
		timeElem.className = 'date-time time';

		const noaaLogo = document.createElement('div');
		noaaLogo.className = 'noaa-logo';
		const noaaImg = document.createElement('img');
		noaaImg.src = 'images/logos/noaa.gif';
		noaaLogo.append(noaaImg);

		header.append(logo, this.titleElem, dateElem, timeElem, noaaLogo);

		const body = document.createElement('div');
		body.className = 'ws-body ws-body--video';
		const frame = document.createElement('div');
		frame.className = 'video-display__frame';
		this.playerContainer = document.createElement('div');
		this.playerContainer.className = 'video-display__player';
		frame.append(this.playerContainer);
		this.statusContainer = document.createElement('div');
		this.statusContainer.className = 'video-display__status';
		frame.append(this.statusContainer);
		body.append(frame);

		display.append(header, body);
		this.elem.append(display);

		this.updateHeader();
		this.updateStatusMessage('Preparing video…');
	}

	updateHeader() {
		const nextTitle = formatDisplayTitle(this.source?.title);
		if (nextTitle === this.displayTitle) {
			if (this.titleElem) {
				this.titleElem.textContent = nextTitle;
			}
			return;
		}
		this.displayTitle = nextTitle;
		if (this.titleElem) {
			this.titleElem.textContent = nextTitle;
		}
		this.name = nextTitle;
		if (this.checkbox) {
			const label = this.checkbox.querySelector('span:not(.alert)');
			if (label) label.textContent = nextTitle;
		}
		this.setStatus(this.status);
	}

	updateStatusMessage(message, { error = false } = {}) {
		if (!this.statusContainer) return;
		this.statusContainer.textContent = message ?? '';
		this.statusContainer.dataset.state = error ? 'error' : 'info';
	}

	async getData() {
		const superResult = super.getData(undefined, false);
		if (!superResult) return;

		this.ready = false;
		this.failed = false;
		this.lastError = null;
		this.setStatus(STATUS.loading);

		try {
			await this.preparePlayer();
			this.ready = true;
			this.setStatus(STATUS.loaded);
			this.updateStatusMessage('');
		} catch (error) {
			this.failed = true;
			this.lastError = error;
			this.failureCount += 1;
			console.error('Video prewarm failed', error);
			this.setStatus(STATUS.failed);
			this.updateStatusMessage('Video unavailable', { error: true });
			this.disposePlayer();
		}
	}

	async preparePlayer() {
		if (!this.playerContainer) return;
		this.disposePlayer();
		this.updateStatusMessage('Preparing video…');
		const type = this.mode || detectSourceType(this.source);
		ensurePreconnect(type, this.source.url);
		const Renderer = RENDERERS[type] || RENDERERS.iframe;
		this.player = new Renderer(this.source);
		await this.player.mount(this.playerContainer);
		if (this.player.prewarm) {
			try {
				await this.player.prewarm();
			} catch (_error) {
				// Ignore failures during prewarm; renderer will attempt playback later.
			}
		}
		this.updateStatusMessage('');
		this.scheduleStandbyPrewarm();
	}

	drawCanvas() {
		super.drawCanvas();
		this.updateHeader();
		this.finishDraw();
	}

	showCanvas(navCmd) {
		this.clearPrewarmTimer();
		super.showCanvas(navCmd);
		this.startPlayback();
	}

	hideCanvas() {
		this.pausePlayback();
		super.hideCanvas();
		this.scheduleStandbyPrewarm();
	}

	generateCheckbox() {
		this.isEnabled = true;
		return false;
	}

	startPlayback() {
		this.clearPrewarmTimer();
		if (!this.ready || this.failed || !this.player?.play) return;
		const playResult = this.player.play();
		if (playResult?.catch) {
			playResult.catch(() => {});
		}
	}

	pausePlayback() {
		if (!this.player?.pause) return;
		const pauseResult = this.player.pause();
		if (pauseResult?.catch) {
			pauseResult.catch(() => {});
		}
		this.scheduleStandbyPrewarm();
	}

	dispose() {
		this.pausePlayback();
		this.disposePlayer();
	}

	updateSource(source) {
		const nextMode = detectSourceType(source);
		const modeChanged = nextMode !== this.mode;
		this.source = { ...source };
		this.mode = nextMode;
		this.buildTiming();
		this.updateHeader();
		if (!this.ready) return;
		if (modeChanged || !this.player || !this.player.update) {
			this.ready = false;
			this.getData();
			return;
		}
		this.player.update(this.source);
		if (this.player.prewarm) {
			const result = this.player.prewarm();
			if (result?.catch) {
				result.catch(() => {});
			}
		}
		this.scheduleStandbyPrewarm();
	}

	disposePlayer() {
		this.clearPrewarmTimer();
		if (this.player?.dispose) {
			this.player.dispose();
		}
		this.player = null;
		if (this.playerContainer) {
			this.playerContainer.innerHTML = '';
		}
	}

	scheduleStandbyPrewarm() {
		this.clearPrewarmTimer();
		const leadSeconds = Number(this.source?.preloadSec ?? 0);
		if (!Number.isFinite(leadSeconds) || leadSeconds <= 0) return;
		if (this.active) return;
		this.prewarmTimeout = setTimeout(() => {
			this.prewarmTimeout = null;
			if (!this.player || !this.player.prewarm) return;
			const result = this.player.prewarm();
			if (result?.catch) {
				result.catch(() => {});
			}
			this.scheduleStandbyPrewarm();
		}, leadSeconds * 1000);
	}

	clearPrewarmTimer() {
		if (!this.prewarmTimeout) return;
		clearTimeout(this.prewarmTimeout);
		this.prewarmTimeout = null;
	}
}

export default VideoDisplay;
