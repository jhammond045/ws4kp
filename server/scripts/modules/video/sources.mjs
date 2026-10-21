const STORAGE_KEY = 'ws.video.sources';
const PERMALINK_FLAG_KEY = 'ws.video.include';
const ALLOWED_TYPES = new Set(['auto', 'youtube', 'hls', 'iframe']);
const DEFAULT_DURATION = 20;
const DEFAULTS = {
	title: '',
	url: '',
	durationSec: DEFAULT_DURATION,
	muted: true,
	loop: true,
	preloadSec: 5,
	poster: '',
	startAt: 0,
	endAt: null,
	type: 'auto',
};

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// Only http(s) URLs may reach a player, iframe or poster. Anything else
// (javascript:, data:, relative paths, junk) is rejected.
export const isAllowedMediaUrl = (value) => {
	if (typeof value !== 'string' || value.trim() === '') return false;
	try {
		return ALLOWED_PROTOCOLS.has(new URL(value.trim()).protocol);
	} catch {
		return false;
	}
};

const listeners = new Set();
let sources = [];
let initialized = false;

const parseNumber = (
	value,
	fallback,
	{
		min = 0,
		max = Number.MAX_SAFE_INTEGER,
		allowNull = false,
		round = true,
	} = {},
) => {
	if (value === null || value === undefined) {
		return allowNull ? null : fallback;
	}
	const numeric = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
	if (!Number.isFinite(numeric)) {
		return allowNull ? null : fallback;
	}
	const clamped = Math.min(Math.max(numeric, min), max);
	return round ? Math.round(clamped) : clamped;
};

const parseBoolean = (value, fallback) => {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		const trimmed = value.trim().toLowerCase();
		if (
			trimmed === 'true'
      || trimmed === '1'
      || trimmed === 'yes'
      || trimmed === 'on'
		) return true;
		if (
			trimmed === 'false'
      || trimmed === '0'
      || trimmed === 'no'
      || trimmed === 'off'
		) return false;
	}
	if (typeof value === 'number') {
		if (value === 1) return true;
		if (value === 0) return false;
	}
	return fallback;
};

const parseString = (value, fallback = '') => {
	if (value === undefined || value === null) return fallback;
	return String(value).trim();
};

const ensureId = (existingId) => {
	if (existingId && typeof existingId === 'string') return existingId;
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	return `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const normalizeType = (value) => {
	const candidate = parseString(value, DEFAULTS.type).toLowerCase();
	return ALLOWED_TYPES.has(candidate) ? candidate : DEFAULTS.type;
};

// strict (the default) clears any URL that isAllowedMediaUrl rejects. It applies
// to everything arriving from outside: permalinks, localStorage and permalink
// output. updateVideoSource passes strict: false so the OSD editor keeps a
// half-typed URL (the card shows an issue for it); the renderers refuse to play
// it and the next load from storage drops it.
const normalizeSource = (raw = {}, { strict = true } = {}) => {
	const normalized = {
		...DEFAULTS,
		...raw,
	};

	normalized.id = ensureId(raw.id);
	normalized.title = parseString(raw.title, DEFAULTS.title);
	normalized.url = parseString(raw.url, DEFAULTS.url);
	// Unsafe URLs become '' so the callers' empty-URL filters drop them.
	if (strict && !isAllowedMediaUrl(normalized.url)) normalized.url = '';
	normalized.durationSec = parseNumber(raw.durationSec, DEFAULTS.durationSec, {
		min: 5,
		max: 3600,
	});
	normalized.muted = parseBoolean(raw.muted, DEFAULTS.muted);
	normalized.loop = parseBoolean(raw.loop, DEFAULTS.loop);
	normalized.preloadSec = parseNumber(raw.preloadSec, DEFAULTS.preloadSec, {
		min: 0,
		max: 120,
	});
	normalized.poster = parseString(raw.poster, DEFAULTS.poster);
	if (strict && !isAllowedMediaUrl(normalized.poster)) normalized.poster = '';
	normalized.startAt = parseNumber(raw.startAt, DEFAULTS.startAt, {
		min: 0,
		max: 86400,
	});

	if (raw.endAt === null || raw.endAt === undefined || raw.endAt === '') {
		normalized.endAt = null;
	} else {
		normalized.endAt = parseNumber(raw.endAt, DEFAULTS.endAt ?? null, {
			min: 0,
			max: 86400,
			allowNull: true,
		});
		if (
			normalized.endAt !== null
      && normalized.startAt !== null
      && normalized.endAt <= normalized.startAt
		) {
			normalized.endAt = null;
		}
	}

	normalized.type = normalizeType(raw.type);

	return normalized;
};

const cloneSources = () => sources.map((src) => ({ ...src }));

const emitChange = () => {
	const snapshot = cloneSources();
	listeners.forEach((listener) => {
		try {
			listener(snapshot);
		} catch (error) {
			console.error('Video sources listener failed', error);
		}
	});
};

const persist = () => {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(sources));
	} catch (error) {
		console.warn('Failed to persist video sources', error);
	}
};

const loadFromStorage = () => {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((item) => normalizeSource(item))
			.filter((item) => item.url !== '');
	} catch (error) {
		console.warn('Failed to read stored video sources', error);
		return [];
	}
};

// btoa/atob only handle Latin-1, so go through UTF-8 bytes to support any title.
const base64UrlEncode = (value) => {
	const json = typeof value === 'string' ? value : JSON.stringify(value);
	const bytes = new TextEncoder().encode(json);
	let binary = '';
	bytes.forEach((byte) => {
		binary += String.fromCharCode(byte);
	});
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const base64UrlDecode = (value) => {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/');
	const paddingLength = (4 - (padded.length % 4)) % 4;
	const paddedValue = `${padded}${'='.repeat(paddingLength)}`;
	const binary = atob(paddedValue);
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		// links made before UTF-8 encoding used raw btoa (Latin-1)
		return binary;
	}
};

const decodeCompactValue = (value) => {
	try {
		const json = JSON.parse(base64UrlDecode(value));
		if (!json) return null;
		const mapped = {
			title: json.t ?? json.title,
			url: json.u ?? json.url,
			durationSec: json.d ?? json.duration,
			type: json.type,
			muted: json.muted,
			loop: json.loop,
			preloadSec: json.preloadSec ?? json.preload,
			poster: json.poster,
			startAt: json.startAt ?? json.start,
			endAt: json.endAt ?? json.end,
		};
		return normalizeSource(mapped);
	} catch (error) {
		console.warn('Failed to decode video source from permalink value', error);
		return null;
	}
};

const collectExpandedQuerySources = (params) => {
	const entries = {};
	params.forEach((value, key) => {
		const match = key.match(/^video[-_](\d+)[-_](.+)$/i);
		if (!match) return;
		const index = parseInt(match[1], 10);
		if (Number.isNaN(index)) return;
		const field = match[2].toLowerCase();
		if (!entries[index]) entries[index] = {};
		switch (field) {
			case 'title':
			case 'name':
			case 't':
				entries[index].title = value;
				break;
			case 'url':
			case 'u':
				entries[index].url = value;
				break;
			case 'dur':
			case 'duration':
			case 'durationsec':
			case 'd':
				entries[index].durationSec = value;
				break;
			case 'type':
				entries[index].type = value;
				break;
			case 'muted':
				entries[index].muted = value;
				break;
			case 'loop':
				entries[index].loop = value;
				break;
			case 'preload':
			case 'preloadsec':
				entries[index].preloadSec = value;
				break;
			case 'poster':
				entries[index].poster = value;
				break;
			case 'start':
			case 'startat':
				entries[index].startAt = value;
				break;
			case 'end':
			case 'endat':
				entries[index].endAt = value;
				break;
			default:
		}
	});

	return Object.keys(entries)
		.sort((a, b) => Number(a) - Number(b))
		.map((key) => normalizeSource(entries[key]))
		.filter((item) => item.url !== '');
};

const loadFromQueryString = () => {
	const params = new URLSearchParams(window.location.search);
	const compact = params
		.getAll('video')
		.map((value) => decodeCompactValue(value))
		.filter((value) => value && value.url !== '');

	const expanded = collectExpandedQuerySources(params);

	const combined = [...compact, ...expanded];

	// Optional legacy integration: if parseQueryString captured any video data
	return combined;
};

// Once a shared link's videos are imported, drop the video params so a refresh
// reads the (possibly edited) stored list instead of importing the link again.
const stripVideoParamsFromAddressBar = () => {
	if (typeof window === 'undefined' || !window.history?.replaceState) return;
	try {
		const url = new URL(window.location.href);
		const videoKeys = [...url.searchParams.keys()]
			.filter((key) => key === 'video' || /^video[-_]\d+[-_]/i.test(key));
		if (videoKeys.length === 0) return;
		videoKeys.forEach((key) => url.searchParams.delete(key));
		window.history.replaceState(null, '', url.toString());
	} catch (error) {
		console.warn('Failed to remove video params from the address bar', error);
	}
};

const hydrateInitialSources = () => {
	if (initialized) return;
	initialized = true;

	const querySources = loadFromQueryString();
	stripVideoParamsFromAddressBar();
	if (querySources.length > 0) {
		sources = querySources;
		persist();
		return;
	}

	sources = loadFromStorage();
};

hydrateInitialSources();

export const getVideoSources = () => cloneSources();

export const addVideoSource = (partial = {}) => {
	const newSource = normalizeSource(partial);
	sources.push(newSource);
	persist();
	emitChange();
	return { ...newSource };
};

export const updateVideoSource = (id, changes = {}) => {
	const index = sources.findIndex(
		(source) => source.id === id || source.id === String(id),
	);
	if (index === -1) return null;
	const merged = normalizeSource({
		...sources[index],
		...changes,
		id: sources[index].id,
	}, { strict: false });
	sources[index] = merged;
	persist();
	emitChange();
	return { ...merged };
};

export const removeVideoSource = (id) => {
	const index = sources.findIndex(
		(source) => source.id === id || source.id === String(id),
	);
	if (index === -1) return false;
	sources.splice(index, 1);
	persist();
	emitChange();
	return true;
};

export const moveVideoSource = (id, toIndex) => {
	const currentIndex = sources.findIndex(
		(source) => source.id === id || source.id === String(id),
	);
	if (currentIndex === -1) return false;
	const target = Math.max(0, Math.min(toIndex, sources.length - 1));
	if (target === currentIndex) return true;
	const [item] = sources.splice(currentIndex, 1);
	sources.splice(target, 0, item);
	persist();
	emitChange();
	return true;
};

export const subscribeVideoSources = (listener) => {
	if (typeof listener !== 'function') return () => {};
	listeners.add(listener);
	listener(cloneSources());
	return () => listeners.delete(listener);
};

export const clearVideoSources = () => {
	sources = [];
	persist();
	emitChange();
};

export const encodeSourceForPermalink = (source) => {
	const normalized = normalizeSource(source);
	return base64UrlEncode({
		t: normalized.title,
		u: normalized.url,
		d: normalized.durationSec,
		type: normalized.type !== DEFAULTS.type ? normalized.type : undefined,
		muted: normalized.muted === DEFAULTS.muted ? undefined : normalized.muted,
		loop: normalized.loop === DEFAULTS.loop ? undefined : normalized.loop,
		preloadSec:
			normalized.preloadSec === DEFAULTS.preloadSec
				? undefined
				: normalized.preloadSec,
		poster: normalized.poster || undefined,
		startAt: normalized.startAt || undefined,
		endAt: normalized.endAt ?? undefined,
	});
};
// Always include videos in permalink
export const getIncludeVideosInPermalink = () => true;

// Videos are always included - this function is a no-op for compatibility
export const setIncludeVideosInPermalink = (_value) => {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(PERMALINK_FLAG_KEY, 'true');
};

export const decodeSourceFromPermalink = decodeCompactValue;

export const defaults = { ...DEFAULTS };

export default {
	getVideoSources,
	addVideoSource,
	updateVideoSource,
	removeVideoSource,
	moveVideoSource,
	subscribeVideoSources,
	clearVideoSources,
	encodeSourceForPermalink,
	decodeSourceFromPermalink,
	isAllowedMediaUrl,
	getIncludeVideosInPermalink,
	setIncludeVideosInPermalink,
	defaults,
};
