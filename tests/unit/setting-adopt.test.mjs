import { test } from 'node:test';
import assert from 'node:assert/strict';

// a shared link, as setting.mjs reads it from the address bar
const link = 'https://example.github.io/ws4kp/?units=si&settings-wide-checkbox=true&kiosk=true&refreshTime=30000&debug=all#top';
const store = new Map();
globalThis.window = { location: { search: new URL(link).search } };
globalThis.localStorage = {
	getItem: (key) => store.get(key) ?? null,
	setItem: (key, value) => store.set(key, String(value)),
	removeItem: (key) => store.delete(key),
};

const { default: Setting, adoptParams, withoutAdoptedParams } = await import('../../server/scripts/modules/utils/setting.mjs');

test('sticky url values are saved and adopted, others stay in the address', () => {
	const units = new Setting('units', { type: 'select', defaultValue: 'us' });
	const wide = new Setting('wide', { defaultValue: false });
	const kiosk = new Setting('kiosk', { defaultValue: false, sticky: false, stickyRead: true });
	const refreshTime = new Setting('refreshTime', { type: 'select', defaultValue: 600_000, sticky: false });
	adoptParams('latLon', 'latLonQuery');

	assert.equal(units.value, 'si');
	assert.equal(wide.value, true);
	assert.equal(kiosk.value, true);
	assert.equal(refreshTime.value, 30000);
	assert.deepEqual(JSON.parse(store.get('Settings')), { units: 'si', wide: true });

	assert.equal(withoutAdoptedParams(link), 'https://example.github.io/ws4kp/?kiosk=true&refreshTime=30000&debug=all#top');
});

test('an address with nothing adopted is returned unchanged', () => {
	const href = 'https://example.github.io/ws4kp/?debug=a,b';
	assert.equal(withoutAdoptedParams(href), href);
});
