// The javascript: URLs below are hostile inputs under test, not code.
/* eslint-disable no-script-url */
import { test } from 'node:test';
import assert from 'node:assert/strict';

let n = 0;
// The fake localStorage backing store from the most recent load() call.
let store = {};

// Sets up the browser globals sources.mjs reads at import time, then imports a
// fresh copy of the module (new query string) so hydration runs again.
const load = async (search = '', storage = {}, history = {}) => {
	store = { ...storage };
	globalThis.window = {
		location: { search, href: `https://e.test/ws4kp/${search}` },
		history: { replaceState() {}, ...history },
	};
	globalThis.localStorage = {
		getItem: (key) => (Object.hasOwn(store, key) ? store[key] : null),
		setItem: (key, value) => { store[key] = String(value); },
		removeItem: (key) => { delete store[key]; },
		clear: () => { Object.keys(store).forEach((key) => delete store[key]); },
	};
	globalThis.btoa ??= (value) => Buffer.from(value, 'latin1').toString('base64');
	globalThis.atob ??= (value) => Buffer.from(value, 'base64').toString('latin1');
	n += 1;
	return import(`../../server/scripts/modules/video/sources.mjs?${n}`);
};

test('drops javascript: and data: URLs from permalink', async () => {
	const { getVideoSources } = await load('?video_0_url=javascript:alert(1)&video_1_url=data:text/html,x&video_2_url=https://e.test/a.m3u8');
	assert.deepEqual(getVideoSources().map((s) => s.url), ['https://e.test/a.m3u8']);
});

test('drops unsafe URLs already in localStorage', async () => {
	const { getVideoSources } = await load('', { 'ws.video.sources': JSON.stringify([{ url: 'javascript:alert(1)' }]) });
	assert.equal(getVideoSources().length, 0);
});

test('does not persist a hostile permalink URL to localStorage', async () => {
	await load('?video_0_title=P&video_0_url=javascript:parent.window.__p%3D1&video_0_dur=10');
	assert.ok(!String(store['ws.video.sources'] ?? '').includes('javascript:'));
});

test('clears an unsafe poster URL', async () => {
	const { getVideoSources } = await load('?video_0_url=https://e.test/a.m3u8&video_0_poster=javascript:alert(1)');
	assert.equal(getVideoSources()[0].poster, '');
});

test('isAllowedMediaUrl', async () => {
	const { isAllowedMediaUrl } = await load('');
	assert.equal(isAllowedMediaUrl('https://youtu.be/x'), true);
	assert.equal(isAllowedMediaUrl('http://e.test/a.m3u8'), true);
	assert.equal(isAllowedMediaUrl('JavaScript:alert(1)'), false);
	assert.equal(isAllowedMediaUrl('data:text/html,x'), false);
	assert.equal(isAllowedMediaUrl('not a url'), false);
	assert.equal(isAllowedMediaUrl(''), false);
});

test('editor keeps a half-typed URL, but the next load drops it', async () => {
	const { addVideoSource, updateVideoSource, getVideoSources } = await load('');
	const { id } = addVideoSource({ url: 'https://e.test/a.m3u8' });
	updateVideoSource(id, { url: 'htt' });
	assert.equal(getVideoSources()[0].url, 'htt');
	const reloaded = await load('', store);
	assert.equal(reloaded.getVideoSources().length, 0);
});

test('permalink encoding never emits an unsafe URL', async () => {
	const { encodeSourceForPermalink, decodeSourceFromPermalink } = await load('');
	const encoded = encodeSourceForPermalink({ url: 'javascript:alert(1)' });
	assert.equal(decodeSourceFromPermalink(encoded).url, '');
});

test('decodes old Latin-1 permalinks', async () => {
	const { decodeSourceFromPermalink } = await load('');
	const old = btoa(JSON.stringify({ t: 'Café', u: 'https://e.test/a.m3u8', d: 20 })).replace(/=+$/, '');
	assert.equal(decodeSourceFromPermalink(old).title, 'Café');
});

test('permalink round-trips non-Latin-1 titles', async () => {
	const { encodeSourceForPermalink, decodeSourceFromPermalink } = await load('');
	const enc = encodeSourceForPermalink({ title: 'Traffic – Downtown 🚗', url: 'https://e.test/a.m3u8', durationSec: 20 });
	assert.equal(decodeSourceFromPermalink(enc).title, 'Traffic – Downtown 🚗');
});

test('hydrating from URL strips video params from the address bar', async () => {
	const calls = [];
	await load('?video_0_url=https://e.test/a.m3u8&units=us', {}, { replaceState: (...a) => calls.push(a[2]) });
	assert.equal(calls.length, 1);
	assert.ok(!String(calls[0]).includes('video_'));
	assert.ok(String(calls[0]).includes('units=us'));
});
