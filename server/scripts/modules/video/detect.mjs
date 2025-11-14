const YOUTUBE_HOSTS = new Set([
	'youtube.com',
	'www.youtube.com',
	'youtu.be',
	'youtube-nocookie.com',
	'www.youtube-nocookie.com',
]);

const extractHostname = (rawUrl) => {
	try {
		return new URL(rawUrl).hostname.toLowerCase();
	} catch (_error) {
		return '';
	}
};

const isYouTubeUrl = (rawUrl) => YOUTUBE_HOSTS.has(extractHostname(rawUrl));

const isHlsUrl = (rawUrl) => {
	if (!rawUrl) return false;
	const lowered = rawUrl.toLowerCase();
	return (
		lowered.includes('.m3u8')
    || (lowered.startsWith('http') && lowered.endsWith('.m3u8'))
	);
};

export const detectSourceType = (source) => {
	if (!source) return 'iframe';
	const explicitType = source.type?.toLowerCase?.();
	if (explicitType && explicitType !== 'auto') {
		return ['youtube', 'hls', 'iframe'].includes(explicitType)
			? explicitType
			: 'iframe';
	}
	if (isYouTubeUrl(source.url)) return 'youtube';
	if (isHlsUrl(source.url)) return 'hls';
	return 'iframe';
};

export const extractYouTubeId = (rawUrl) => {
	try {
		const url = new URL(rawUrl);
		const host = url.hostname.toLowerCase();

		if (host === 'youtu.be') {
			return url.pathname.slice(1);
		}

		if (host.includes('youtube')) {
			if (url.pathname.startsWith('/embed/')) {
				return url.pathname.split('/')[2];
			}

			if (url.searchParams.has('v')) {
				return url.searchParams.get('v');
			}

			const shortsMatch = url.pathname.match(/^\/shorts\/([\w-]{8,})/i);
			if (shortsMatch) return shortsMatch[1];
		}
		return null;
	} catch (_error) {
		return null;
	}
};

export const buildYouTubeEmbedUrl = (
	rawUrl,
	{
		autoplay = 1,
		mute = 1,
		loop = 0,
		playsinline = 1,
		controls = 0,
		rel = 0,
		modestbranding = 1,
		origin,
		startAt,
		endAt,
		playlist,
	} = {},
) => {
	const videoId = extractYouTubeId(rawUrl);
	if (!videoId) return null;
	const base = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
	base.searchParams.set('autoplay', autoplay);
	base.searchParams.set('mute', mute);
	base.searchParams.set('playsinline', playsinline);
	base.searchParams.set('controls', controls);
	base.searchParams.set('rel', rel);
	base.searchParams.set('modestbranding', modestbranding);
	base.searchParams.set('enablejsapi', 1);
	if (origin) base.searchParams.set('origin', origin);
	if (typeof startAt === 'number' && startAt > 0) base.searchParams.set('start', Math.floor(startAt));
	if (typeof endAt === 'number' && endAt > 0) base.searchParams.set('end', Math.floor(endAt));
	if (loop && playlist) {
		base.searchParams.set('playlist', playlist);
		base.searchParams.set('loop', 1);
	} else if (loop) {
		base.searchParams.set('loop', 1);
		base.searchParams.set('playlist', videoId);
	}
	return base.toString();
};

export const getPreconnectOrigins = (type, rawUrl) => {
	if (type === 'youtube') {
		return [
			'https://www.youtube-nocookie.com',
			'https://i.ytimg.com',
			'https://www.google.com',
		];
	}
	if (type === 'hls') {
		try {
			const url = new URL(rawUrl);
			return [`${url.protocol}//${url.hostname}`];
		} catch (_error) {
			return [];
		}
	}
	return [];
};

export const isNativeHlsSupported = () => {
	const video = document.createElement('video');
	return (
		typeof video.canPlayType === 'function'
    && video.canPlayType('application/vnd.apple.mpegURL') !== ''
	);
};

export default {
	detectSourceType,
	extractYouTubeId,
	buildYouTubeEmbedUrl,
	getPreconnectOrigins,
	isNativeHlsSupported,
};
