import { test } from 'node:test';
import assert from 'node:assert/strict';
import createOsdMenuModel from '../../server/scripts/modules/osd/osdMenu.model.mjs';

const fakeSetting = (value, values = []) => ({ value, values });

const itemIndex = (model, categoryId, itemId) => model
	.getItemsSnapshot(categoryId)
	.findIndex((item) => item.id === itemId);

const volumeModel = (initial) => {
	const media = {
		volume: initial,
		isAvailable: () => true,
		getPlaying: () => false,
		setPlaying: () => {},
		getVolume: () => media.volume,
		setVolume: (value) => { media.volume = value; },
	};
	const model = createOsdMenuModel({ settings: {}, media });
	return { model, media, index: itemIndex(model, 'audio', 'music-volume') };
};

test('volume row steps 0-100 by 10 from a value between steps', async () => {
	const { model, media, index } = volumeModel(0.75);
	assert.equal(model.getItemsSnapshot('audio')[index].displayValue, '75%');
	await model.adjustItem('audio', index, 'increment');
	assert.equal(media.volume, 0.8);
	media.volume = 0.75;
	await model.adjustItem('audio', index, 'decrement');
	assert.equal(media.volume, 0.7);
});

test('volume row stops at 0 and 100, and Enter wraps from 100 to 0', async () => {
	const { model, media, index } = volumeModel(1);
	await model.adjustItem('audio', index, 'increment');
	assert.equal(media.volume, 1);
	await model.activateItem('audio', index);
	assert.equal(media.volume, 0);
	await model.adjustItem('audio', index, 'decrement');
	assert.equal(media.volume, 0);
});

test('display mode row sets viewMode, not the individual wide setting', async () => {
	const settings = {
		viewMode: fakeSetting('standard', [['standard', 'Standard'], ['wide', 'Widescreen']]),
		wide: fakeSetting(false),
	};
	const model = createOsdMenuModel({ settings });
	const index = itemIndex(model, 'setup', 'view-mode');
	assert.equal(model.getItemsSnapshot('setup')[index].displayValue, 'STANDARD');
	await model.adjustItem('setup', index, 'increment');
	assert.equal(settings.viewMode.value, 'wide');
	assert.equal(settings.wide.value, false);
});

test('screen rows change the Displays tab checkbox and fire its change event', async () => {
	const events = [];
	const input = {
		checked: true,
		dispatchEvent: (event) => events.push(event),
	};
	const display = {
		elemId: 'almanac',
		name: 'Almanac',
		isEnabled: true,
		checkbox: { querySelector: () => input },
	};
	const model = createOsdMenuModel({ settings: {}, getDisplays: () => [display] });
	const index = itemIndex(model, 'screens', 'screen-almanac');
	await model.adjustItem('screens', index);
	assert.equal(input.checked, false);
	assert.equal(events.length, 1);
	assert.equal(events[0].type, 'change');
	assert.equal(events[0].bubbles, true);
});

test('no CRT row; scan lines and scan line style rows are bound', async () => {
	const settings = {
		scanLines: fakeSetting(false),
		scanLineMode: fakeSetting('auto', [['auto', 'Auto (Adaptive)'], ['thin', 'Thin (1x)']]),
	};
	const model = createOsdMenuModel({ settings });
	const items = model.getItemsSnapshot('style');
	assert.ok(!items.some((item) => /crt/i.test(item.id)));
	const mode = items.find((item) => item.id === 'scan-line-mode');
	assert.equal(mode.disabled, true);
	await model.adjustItem('style', itemIndex(model, 'style', 'scan-lines'));
	assert.equal(settings.scanLines.value, true);
	await model.adjustItem('style', itemIndex(model, 'style', 'scan-line-mode'), 'increment');
	assert.equal(settings.scanLineMode.value, 'thin');
});
