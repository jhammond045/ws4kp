import WeatherDisplay from '../weatherdisplay.mjs';
import STATUS from '../status.mjs';
import { escapeHtml } from '../utils/string.mjs';
import { detectSourceType, getPreconnectOrigins, buildYouTubeEmbedUrl } from './detect.mjs';
import IframeRenderer from './renderers/iframe.mjs';
import YouTubeRenderer from './renderers/youtube.mjs';
import HlsRenderer from './renderers/hls.mjs';

const MIN_DURATION = 5;
const DEFAULT_TITLE = 'Video';
const MAX_TITLE_LENGTH = 18;
// a source that hasn't loaded within its preload lead time plus this many seconds is shown as unavailable
const LOAD_TIMEOUT_EXTRA_SEC = 5;
// after this many failed loads in a row the source sits out SKIP_TURNS turns, then loads again
const MAX_FAILURES = 2;
const SKIP_TURNS = 2;
const UNAVAILABLE_MESSAGE = 'VIDEO UNAVAILABLE';
const preconnectedOrigins = new Set();

// exported so tests can swap in stub renderers
export const RENDERERS = {
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

// the editor keeps an end time that isn't after the start so the manager can flag it, players never get it
const playableSource = (source) => (source.endAt !== null && source.endAt !== undefined && source.endAt <= (source.startAt ?? 0)
	? { ...source, endAt: null }
	: source);

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
		// the progress screen writes name with innerHTML, and the title can come from a link
		super(navId, elemId, escapeHtml(initialTitle), true);
		this.source = { ...source };
		this.mode = detectSourceType(source);
		this.player = null;
		this.ready = false;
		this.failed = false;
		this.failureCount = 0;
		// turns left to sit out after repeated failures, see skippedTurn
		this.skipTurns = 0;
		this.lastError = null;
		this.loading = null;
		this.loadToken = null;
		// a player is mounted just before the source's turn, at most once per turn, see prewarm
		this.prewarmed = false;
		// true while a YouTube source plays as a plain embed, see fallBackOrFail
		this.fallback = false;
		this.disposed = false;
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
		// video displays are built during or after DOMContentLoaded, so the base
		// class listener never fires; load templates now (idempotent via dataset.initialized)
		if (document.readyState !== 'loading') this.loadTemplates();
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

		const header = document.createElement('div');
		header.className = 'header';

		const logo = document.createElement('div');
		logo.className = 'logo';
		const logoImg = document.createElement('img');
		logoImg.src = 'images/logos/logo-corner.svg';
		logoImg.width = 85;
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

		// header must be a direct child of .weather-display for upstream's >.header rules
		this.elem.append(header, body);

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
		this.name = escapeHtml(nextTitle);
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

	// nothing is mounted here: a player is mounted shortly before the source's turn (prewarm) or when it's shown,
	// so a long playlist doesn't hold a player for every source
	// a data refresh leaves a mounted player alone, so the video on screen isn't torn down
	getData(weatherParameters, refresh) {
		const superResult = super.getData(weatherParameters, refresh);
		if (!superResult) return;
		this.setStatus(this.failed ? STATUS.failed : STATUS.loaded);
	}

	// how long before its turn navigation should call prewarm
	get prewarmLeadMs() {
		return Math.max(0, Number(this.source?.preloadSec) || 0) * 1000;
	}

	// navigation calls this, repeatedly, when this source's turn is close (WORK.md 5.1)
	// once per turn, so a source that fails while getting ready counts one failure
	prewarm() {
		if (this.disposed || this.prewarmed || this.player || this.loading || this.skipTurns > 0) return;
		this.prewarmed = true;
		this.load();
	}

	// navigation calls this for every video that is neither on screen nor next
	releasePlayer() {
		if (this.active || (!this.player && !this.loading)) return;
		this.loadToken = null;
		this.loading = null;
		this.ready = false;
		this.fallback = false;
		this.prewarmed = false;
		this.disposePlayer();
		if (!this.failed) this.updateStatusMessage('Preparing video…');
	}

	load({ fallback = false } = {}) {
		const token = {};
		this.loadToken = token;
		this.fallback = fallback;
		this.ready = false;
		this.failed = false;
		this.lastError = null;
		// a source trying again after its card was shown rotates as usual while it loads
		if (this.status === STATUS.failed) this.setStatus(STATUS.loaded);

		let timeout;
		const timeoutSec = Math.max(0, Number(this.source.preloadSec) || 0) + LOAD_TIMEOUT_EXTRA_SEC;
		this.loading = Promise.race([
			this.preparePlayer(),
			new Promise((resolve, reject) => {
				timeout = setTimeout(() => {
					const error = new Error(`Timed out after ${timeoutSec}s`);
					error.timedOut = true;
					reject(error);
				}, timeoutSec * 1000);
			}),
		]).then(() => {
			if (this.loadToken !== token) return;
			this.ready = true;
			this.failureCount = 0;
			this.skipTurns = 0;
			if (this.status !== STATUS.loaded) this.setStatus(STATUS.loaded);
			this.updateStatusMessage('');
			// reloaded after an edit while on screen
			if (this.active) {
				this.startPlayback();
			} else if (this.fallback) {
				// the plain YouTube embed autoplays, blank it until its turn so it's never heard off screen
				this.pausePlayback();
			}
		}, (error) => {
			if (this.loadToken !== token) return undefined;
			return this.fallBackOrFail(error);
		}).finally(() => {
			clearTimeout(timeout);
			if (this.loadToken === token) this.loading = null;
		});
		return this.loading;
	}

	// WORK.md 7: when YouTube refuses the embed (101/150), its API doesn't load or the player doesn't get ready in time,
	// try a plain embed once before showing the card
	// the plain embed can't report errors, so for 101/150 it shows YouTube's own error page instead of the card
	fallBackOrFail(error) {
		if (this.mode === 'youtube' && !this.fallback && (error?.fallback || error?.timedOut)) {
			console.warn(`Video "${this.source.title}": ${error.message}, trying a plain embed`);
			return this.load({ fallback: true });
		}
		this.fail(error);
		return undefined;
	}

	// show the unavailable card, rotation shows it for the source's duration and then moves on
	fail(error) {
		this.loadToken = null;
		this.loading = null;
		this.ready = false;
		this.failed = true;
		this.lastError = error;
		this.failureCount += 1;
		if (this.failureCount >= MAX_FAILURES) this.skipTurns = SKIP_TURNS;
		console.error(`Video "${this.source.title}" unavailable: ${error?.message}`);
		this.disposePlayer();
		this.setStatus(STATUS.failed);
		this.updateStatusMessage(UNAVAILABLE_MESSAGE, { error: true });
	}

	// a failed source is still shown, so the card appears, until it fails twice in a row
	isEnabledForRotation() {
		return this.skipTurns === 0;
	}

	// navigation calls this when rotation moves past this display without showing it
	// a source sitting out after failures is prewarmed again before its next turn once it has missed its turns
	skippedTurn() {
		if (this.skipTurns === 0 || !this.failed) return;
		this.skipTurns -= 1;
		this.prewarmed = false;
	}

	async preparePlayer() {
		if (!this.playerContainer) return;
		this.disposePlayer();
		this.updateStatusMessage('Preparing video…');
		let type = this.mode || detectSourceType(this.source);
		ensurePreconnect(type, this.source.url);
		let source = playableSource(this.source);
		if (this.fallback) {
			type = 'iframe';
			source = {
				...source,
				url: buildYouTubeEmbedUrl(source.url, {
					mute: source.muted === false ? 0 : 1,
					loop: source.loop ? 1 : 0,
					startAt: source.startAt,
					endAt: source.endAt ?? undefined,
				}),
			};
		}
		const Renderer = RENDERERS[type] || RENDERERS.iframe;
		const player = new Renderer(source, { waitForLoad: this.fallback });
		this.player = player;
		// errors after the player is up (a removed YouTube video, a dead stream) also show the card
		player.onFail = (error) => {
			if (this.player === player) this.fallBackOrFail(error);
		};
		await player.mount(this.playerContainer);
		// a timeout, newer load or dispose replaced this player while it was mounting
		if (this.player !== player) return;
		if (player.prewarm) {
			try {
				await player.prewarm();
			} catch {
				// Ignore failures during prewarm; renderer will attempt playback later.
			}
		}
	}

	drawCanvas() {
		super.drawCanvas();
		this.updateHeader();
		this.finishDraw();
	}

	showCanvas(navCmd) {
		this.clearPrewarmTimer();
		super.showCanvas(navCmd);
		// the turn starts, the next one may prewarm again
		this.prewarmed = false;
		// not prewarmed (the first display, a click in the display list, preloadSec 0): load now,
		// a source that failed while getting ready shows its card for this turn
		if (!this.player && !this.loading && !this.failed && !this.disposed) {
			this.load();
			return;
		}
		this.startPlayback();
	}

	hideCanvas() {
		// navigation hides every display on each change, only act on the one that was showing
		const wasShowing = this.elem?.classList.contains('show');
		super.hideCanvas();
		if (!wasShowing || this.disposed) return;
		this.pausePlayback();
		// navigation shows the next display straight after, which can be this one again when it's the only one
		// otherwise (the menu, the reset button) the player is let go
		setTimeout(() => {
			if (!this.active) this.releasePlayer();
		}, 0);
	}

	generateCheckbox() {
		this.isEnabled = true;
		return false;
	}

	startPlayback() {
		this.clearPrewarmTimer();
		if (!this.ready || this.failed || !this.player?.play) return;
		// rotation continues in a hidden tab, playback starts when the tab is shown again
		if (document.visibilityState === 'hidden') return;
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
	}

	dispose() {
		this.disposed = true;
		this.loadToken = null;
		this.pausePlayback();
		this.disposePlayer();
		this.clearAutoReload();
		clearInterval(this.navInterval);
		this.navInterval = undefined;
	}

	updateSource(source) {
		const nextMode = detectSourceType(source);
		const modeChanged = nextMode !== this.mode;
		// the title, duration and preload time don't touch the player, so the video on screen keeps playing
		const inPlace = ['title', 'durationSec', 'preloadSec'];
		const playerChanged = Object.keys({ ...source, ...this.source })
			.some((key) => !inPlace.includes(key) && source[key] !== this.source[key]);
		const urlChanged = source.url !== this.source.url;
		this.source = { ...source };
		this.mode = nextMode;
		this.buildTiming();
		this.updateHeader();
		if (!playerChanged) return;
		if (!this.ready) {
			// retry a failed or loading source with the new settings
			if (this.failed || this.loading) this.load();
			return;
		}
		// a new URL loads like the first time, with the same timeout and unavailable card
		// a YouTube source on its plain embed fallback tries the player API again
		if (modeChanged || urlChanged || this.fallback || !this.player || !this.player.update) {
			this.load();
			return;
		}
		this.player.update(playableSource(this.source));
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
		// once per hide, so the next show starts from the beginning
		this.prewarmTimeout = setTimeout(() => {
			this.prewarmTimeout = null;
			if (!this.player || !this.player.prewarm || this.active) return;
			const result = this.player.prewarm();
			if (result?.catch) {
				result.catch(() => {});
			}
		}, leadSeconds * 1000);
	}

	clearPrewarmTimer() {
		if (!this.prewarmTimeout) return;
		clearTimeout(this.prewarmTimeout);
		this.prewarmTimeout = null;
	}
}

export default VideoDisplay;
