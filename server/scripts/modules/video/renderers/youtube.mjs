import { extractYouTubeId } from '../detect.mjs';

const API_SRC = 'https://www.youtube.com/iframe_api';
let youtubeApiPromise;

const loadYouTubeAPI = () => {
	if (window.YT?.Player) {
		return Promise.resolve(window.YT);
	}

	if (youtubeApiPromise) return youtubeApiPromise;

	youtubeApiPromise = new Promise((resolve, reject) => {
		let resolved = false;
		const timeout = setTimeout(() => {
			if (!resolved) {
				reject(new Error('Timed out loading YouTube API'));
			}
		}, 10000);

		const previousHandler = window.onYouTubeIframeAPIReady;
		window.onYouTubeIframeAPIReady = () => {
			resolved = true;
			clearTimeout(timeout);
			if (typeof previousHandler === 'function') {
				previousHandler();
			}
			window.onYouTubeIframeAPIReady = previousHandler;
			if (window.YT?.Player) {
				resolve(window.YT);
			} else {
				reject(new Error('YouTube API failed to initialize'));
			}
		};

		const script = document.createElement('script');
		script.src = API_SRC;
		script.async = true;
		script.onerror = () => {
			clearTimeout(timeout);
			window.onYouTubeIframeAPIReady = previousHandler;
			script.remove();
			reject(new Error('Failed to load YouTube API script'));
		};
		document.head.append(script);
	}).catch((error) => {
		youtubeApiPromise = null;
		throw error;
	});

	return youtubeApiPromise;
};

class YouTubeRenderer {
	constructor(source) {
		this.source = { ...source };
		this.player = null;
		this.container = null;
		this.isReady = false;
		this.playerElement = null;
	}

	buildPlayerVars(videoId) {
		const vars = {
			autoplay: 0,
			mute: this.source.muted === false ? 0 : 1,
			playsinline: 1,
			controls: 0,
			rel: 0,
			modestbranding: 1,
			enablejsapi: 1,
			fs: 0,
			origin: window.location.origin,
		};

		if (typeof this.source.startAt === 'number' && this.source.startAt > 0) {
			vars.start = Math.floor(this.source.startAt);
		}
		if (typeof this.source.endAt === 'number' && this.source.endAt > 0) {
			vars.end = Math.floor(this.source.endAt);
		}
		if (this.source.loop) {
			vars.loop = 1;
			vars.playlist = videoId;
		}

		return vars;
	}

	async mount(container) {
		this.container = container;
		this.container.innerHTML = '';
		await this.createPlayer();
	}

	async createPlayer() {
		this.isReady = false;
		const videoId = extractYouTubeId(this.source.url);
		if (!videoId) throw new Error('Invalid YouTube URL');

		const YT = await loadYouTubeAPI();

		this.playerElement = document.createElement('div');
		this.playerElement.className = 'video-renderer__youtube';
		this.container.append(this.playerElement);

		await new Promise((resolve, reject) => {
			this.player = new YT.Player(this.playerElement, {
				videoId,
				width: '100%',
				height: '100%',
				playerVars: this.buildPlayerVars(videoId),
				events: {
					onReady: (event) => {
						this.isReady = true;
						if (this.source.muted !== false) {
							event.target.mute();
						} else {
							event.target.unMute();
						}
						if (
							typeof this.source.startAt === 'number'
              && this.source.startAt > 0
						) {
							event.target.seekTo(this.source.startAt, true);
						}
						event.target.pauseVideo();
						resolve();
					},
					onError: (error) => {
						reject(new Error(`YouTube player error: ${error.data}`));
					},
				},
			});
		});
	}

	async prewarm() {
		if (!this.player || !this.isReady) return;
		try {
			await this.player.playVideo();
			await new Promise((resolve) => {
				setTimeout(resolve, 150);
			});
			this.player.pauseVideo();
			if (typeof this.source.startAt === 'number' && this.source.startAt > 0) {
				this.player.seekTo(this.source.startAt, true);
			}
		} catch (_error) {
			// Ignore autoplay failures during prewarm
		}
	}

	play() {
		if (!this.player || typeof this.player.playVideo !== 'function') return;
		if (typeof this.source.startAt === 'number' && this.source.startAt > 0) {
			this.player.seekTo(this.source.startAt, true);
		}
		if (this.source.muted !== false) {
			this.player.mute();
		} else {
			this.player.unMute();
		}
		if (typeof this.player.setLoop === 'function') {
			this.player.setLoop(Boolean(this.source.loop));
		}
		this.player.playVideo();
	}

	pause() {
		if (!this.player || typeof this.player.pauseVideo !== 'function') return;
		this.player.pauseVideo();
		if (this.source.muted !== false) {
			this.player.mute();
		}
	}

	dispose() {
		if (this.player) {
			this.player.destroy();
			this.player = null;
		}
		if (this.playerElement) {
			this.playerElement.remove();
			this.playerElement = null;
		}
	}

	update(source) {
		const previousUrl = this.source.url;
		this.source = { ...source };
		if (!this.player) return;

		if (this.source.muted !== false) {
			this.player.mute();
		} else {
			this.player.unMute();
		}
		if (typeof this.player.setLoop === 'function') {
			this.player.setLoop(Boolean(this.source.loop));
		}

		if (previousUrl !== this.source.url) {
			const videoId = extractYouTubeId(this.source.url);
			if (!videoId) return;
			this.player.cueVideoById({
				videoId,
				startSeconds: this.source.startAt ?? 0,
				endSeconds:
          typeof this.source.endAt === 'number' ? this.source.endAt : undefined,
			});
		} else if (typeof this.source.startAt === 'number') {
			this.player.seekTo(this.source.startAt, true);
		}
	}
}

export default YouTubeRenderer;
