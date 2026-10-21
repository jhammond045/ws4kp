import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// just enough of a browser for display.mjs and the modules it pulls in to load
const store = {};
globalThis.localStorage = {
	getItem: (key) => (Object.hasOwn(store, key) ? store[key] : null),
	setItem: (key, value) => { store[key] = String(value); },
	removeItem: (key) => { delete store[key]; },
};
globalThis.window = {
	location: { search: '', href: 'https://e.test/ws4kp/', origin: 'https://e.test' },
	localStorage: globalThis.localStorage,
	history: { replaceState() {} },
	addEventListener() {},
	dispatchEvent() {},
};
globalThis.document = {
	readyState: 'loading',
	addEventListener() {},
	querySelector: () => null,
	querySelectorAll: () => [],
	getElementById: () => null,
	createElement: () => ({
		style: {}, classList: { add() {} }, setAttribute() {}, append() {},
	}),
	head: { append() {} },
};
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });

// count intervals that are started and not cleared, mock.timers replaces the globals so wrap after enabling it
const activeIntervals = new Set();
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
const mockedSetInterval = globalThis.setInterval;
const mockedClearInterval = globalThis.clearInterval;
globalThis.setInterval = (...args) => {
	const id = mockedSetInterval(...args);
	activeIntervals.add(id);
	return id;
};
globalThis.clearInterval = (id) => {
	activeIntervals.delete(id);
	mockedClearInterval(id);
};

const { default: VideoDisplay, RENDERERS } = await import('../../server/scripts/modules/video/display.mjs');
const { diffSources } = await import('../../server/scripts/modules/video/index.mjs');
const { default: IframeRenderer, iframeSandbox } = await import('../../server/scripts/modules/video/renderers/iframe.mjs');
const { default: STATUS } = await import('../../server/scripts/modules/status.mjs');

let constructed = 0;
let mountResult;
class StubRenderer {
	constructor(source) {
		constructed += 1;
		this.source = source;
		this.updates = 0;
	}

	mount() { return mountResult(); }

	update() { this.updates += 1; }

	// eslint-disable-next-line class-methods-use-this
	dispose() {}
}
RENDERERS.iframe = StubRenderer;

const makeDisplay = (source = {}) => {
	const display = new VideoDisplay(-1, 'video-test', {
		id: 'a', title: 'Cam', url: 'https://e.test/cam', type: 'iframe', preloadSec: 5, ...source,
	});
	display.playerContainer = { innerHTML: '' };
	display.statusContainer = { textContent: '', dataset: {} };
	return display;
};

beforeEach(() => {
	constructed = 0;
	mountResult = () => Promise.resolve();
});

test('a mount that never resolves fails after preloadSec + 5 seconds', async () => {
	mountResult = () => new Promise(() => {});
	const display = makeDisplay();
	const loading = display.getData();
	mock.timers.tick(9_999);
	await Promise.resolve();
	assert.equal(display.status, STATUS.loading);
	mock.timers.tick(1);
	await loading;
	assert.equal(display.status, STATUS.failed);
	assert.equal(display.statusContainer.textContent, 'VIDEO UNAVAILABLE');
	display.dispose();
});

test('two failures in a row sit out two turns, then the source loads again', async () => {
	mountResult = () => Promise.reject(new Error('404'));
	const display = makeDisplay();
	await display.getData();
	assert.equal(display.status, STATUS.failed);
	assert.equal(display.isEnabledForRotation(), true);
	await display.getData();
	assert.equal(display.isEnabledForRotation(), false);
	// a data refresh while sitting out doesn't load it early
	await display.getData(undefined, true);
	assert.equal(constructed, 2);
	assert.equal(display.status, STATUS.failed);
	display.skippedTurn();
	assert.equal(constructed, 2);
	assert.equal(display.isEnabledForRotation(), false);
	mountResult = () => Promise.resolve();
	display.skippedTurn();
	assert.equal(constructed, 3);
	await display.loading;
	assert.equal(display.status, STATUS.loaded);
	assert.equal(display.isEnabledForRotation(), true);
	display.dispose();
});

test('a retry that fails again sits out another two turns', async () => {
	mountResult = () => Promise.reject(new Error('404'));
	const display = makeDisplay();
	await display.getData();
	await display.getData();
	display.skippedTurn();
	display.skippedTurn();
	await display.loading;
	assert.equal(constructed, 3);
	assert.equal(display.status, STATUS.failed);
	assert.equal(display.isEnabledForRotation(), false);
	display.skippedTurn();
	assert.equal(constructed, 3);
	display.skippedTurn();
	assert.equal(constructed, 4);
	await display.loading;
	display.dispose();
});

test('dispose leaves no intervals running', async () => {
	activeIntervals.clear();
	const display = makeDisplay();
	await display.getData();
	assert.ok(activeIntervals.size > 0);
	display.dispose();
	assert.equal(activeIntervals.size, 0);
});

test('a refresh keeps the mounted player', async () => {
	const display = makeDisplay();
	await display.getData();
	await display.getData(undefined, true);
	assert.equal(constructed, 1);
	assert.equal(display.status, STATUS.loaded);
	display.dispose();
});

test('editing the title updates the display without a new renderer', async () => {
	const display = makeDisplay();
	await display.getData();
	const { player } = display;
	display.updateSource({ ...display.source, title: 'Lobby' });
	assert.equal(constructed, 1);
	assert.equal(display.player, player);
	assert.equal(player.updates, 0);
	assert.equal(display.displayTitle, 'Lobby');
	display.dispose();
});

test('diffSources only asks for a rebuild on add, remove or reorder', () => {
	assert.deepEqual(diffSources(['a', 'b'], ['a', 'b']), { removed: [], added: [], reordered: false });
	assert.deepEqual(diffSources(['a', 'b'], ['a', 'b', 'c']), { removed: [], added: ['c'], reordered: false });
	assert.deepEqual(diffSources(['a', 'b', 'c'], ['a', 'c']), { removed: ['b'], added: [], reordered: false });
	assert.deepEqual(diffSources(['a', 'b'], ['b', 'a']), { removed: [], added: [], reordered: true });
	// a source that gets its URL later joins in the middle of the list, so the order has to be fixed
	assert.deepEqual(diffSources(['a', 'c'], ['a', 'b', 'c']), { removed: [], added: ['b'], reordered: true });
});

test('iframes from this site lose allow-same-origin', () => {
	assert.ok(iframeSandbox('https://other.test/cam', 'https://e.test').includes('allow-same-origin'));
	assert.ok(!iframeSandbox('https://e.test/page', 'https://e.test').includes('allow-same-origin'));
	assert.ok(!iframeSandbox('not a url', 'https://e.test').includes('allow-same-origin'));
	assert.ok(!iframeSandbox('about:blank', 'https://e.test').includes('allow-same-origin'));
});

test('a new URL on a loaded display loads again with the load timeout', async () => {
	const display = makeDisplay();
	await display.getData();
	assert.equal(constructed, 1);
	mountResult = () => new Promise(() => {});
	display.updateSource({ ...display.source, url: 'https://e.test/dead' });
	assert.equal(constructed, 2);
	assert.equal(display.status, STATUS.loading);
	const { loading } = display;
	mock.timers.tick(10_000);
	await loading;
	assert.equal(display.status, STATUS.failed);
	assert.equal(display.statusContainer.textContent, 'VIDEO UNAVAILABLE');
	display.dispose();
});

const withYouTubeStub = (mount) => {
	const made = [];
	class YouTubeStub {
		constructor(source) {
			made.push(source);
		}

		// eslint-disable-next-line class-methods-use-this
		mount() { return mount(); }

		// eslint-disable-next-line class-methods-use-this
		dispose() {}
	}
	RENDERERS.youtube = YouTubeStub;
	return made;
};

const youtubeSource = { url: 'https://www.youtube.com/watch?v=M7lc1UVf-VE', type: 'auto' };

test('YouTube refusing the embed tries a plain embed once before the card', async () => {
	const made = withYouTubeStub(() => Promise.reject(Object.assign(new Error('YouTube player error: 150'), { fallback: true })));
	const iframeSources = [];
	mountResult = () => new Promise(() => {});
	RENDERERS.iframe = class extends StubRenderer {
		constructor(source) {
			super(source);
			iframeSources.push(source);
		}
	};
	const display = makeDisplay(youtubeSource);
	const loading = display.getData();
	// let the YouTube rejection reach the display, setImmediate isn't faked
	await new Promise((resolve) => { setImmediate(resolve); });
	assert.equal(made.length, 1);
	assert.equal(display.fallback, true);
	// the fallback page never loads, so it runs into its own timeout
	mock.timers.tick(10_000);
	await loading;
	assert.equal(iframeSources.length, 1);
	assert.match(iframeSources[0].url, /^https:\/\/www\.youtube-nocookie\.com\/embed\/M7lc1UVf-VE\?/);
	assert.equal(display.status, STATUS.failed);
	assert.equal(display.failureCount, 1);
	assert.equal(made.length, 1);
	display.dispose();
	RENDERERS.iframe = StubRenderer;
});

test('a working plain embed fallback is shown, and the next edit tries YouTube again', async () => {
	const made = withYouTubeStub(() => Promise.reject(Object.assign(new Error('Failed to load YouTube API script'), { fallback: true })));
	let paused = 0;
	RENDERERS.iframe = class extends StubRenderer {
		// eslint-disable-next-line class-methods-use-this
		pause() { paused += 1; }
	};
	const display = makeDisplay(youtubeSource);
	await display.getData();
	assert.equal(display.status, STATUS.loaded);
	assert.equal(display.fallback, true);
	assert.equal(constructed, 1);
	// off screen the autoplaying embed is blanked until its turn
	assert.equal(paused, 1);
	RENDERERS.iframe = StubRenderer;
	display.updateSource({ ...display.source, muted: false });
	await display.loading;
	assert.equal(made.length, 2);
	display.dispose();
});

test('a removed YouTube video (error 100) shows the card without a fallback', async () => {
	withYouTubeStub(() => Promise.reject(Object.assign(new Error('YouTube player error: 100'), { fallback: false })));
	const display = makeDisplay(youtubeSource);
	await display.getData();
	assert.equal(display.status, STATUS.failed);
	assert.equal(constructed, 0);
	display.dispose();
});

// the real iframe renderer with a frame whose load event never fires, like a page holding an MJPEG stream open
const withHangingIframe = (run) => async () => {
	const { createElement } = document;
	document.createElement = () => ({ addEventListener() {}, remove() {} });
	RENDERERS.iframe = IframeRenderer;
	try {
		await run();
	} finally {
		document.createElement = createElement;
		RENDERERS.iframe = StubRenderer;
	}
};

test('a web page that never fires load still loads', withHangingIframe(async () => {
	const display = makeDisplay();
	display.playerContainer.append = () => {};
	await display.getData();
	assert.equal(display.status, STATUS.loaded);
	display.dispose();
}));

test('a plain YouTube embed fallback that never fires load times out to the card', withHangingIframe(async () => {
	withYouTubeStub(() => Promise.reject(Object.assign(new Error('YouTube player error: 150'), { fallback: true })));
	const display = makeDisplay(youtubeSource);
	display.playerContainer.append = () => {};
	const loading = display.getData();
	await new Promise((resolve) => { setImmediate(resolve); });
	assert.equal(display.fallback, true);
	assert.equal(display.status, STATUS.loading);
	mock.timers.tick(10_000);
	await loading;
	assert.equal(display.status, STATUS.failed);
	assert.equal(display.statusContainer.textContent, 'VIDEO UNAVAILABLE');
	display.dispose();
}));

test('a title from a link is escaped in the name the progress screen writes as HTML', () => {
	// 18 characters, short enough to pass through untruncated
	const display = makeDisplay({ title: '<base href=//x.co>' });
	assert.equal(display.name, '&lt;base href=//x.co&gt;');
	assert.equal(display.displayTitle, '<base href=//x.co>');
	display.updateSource({ ...display.source, title: '<img src=x id=p>' });
	assert.equal(display.name, '&lt;img src=x id=p&gt;');
	assert.equal(display.displayTitle, '<img src=x id=p>');
	display.dispose();
});
