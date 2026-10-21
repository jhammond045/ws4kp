import elemForEach from './utils/elem-for-each.mjs';
import Setting from './utils/setting.mjs';
import { getVideoSources, encodeSourceForPermalink } from './video/sources.mjs';
import { openCopyResultModal } from './osd/osdModal.mjs';

document.addEventListener('DOMContentLoaded', () => init());

// array of settings that are not checkboxes or dropdowns (i.e. volume slider)
const hiddenSettings = [];

const init = () => {
	// add action to existing button
	const shareLink = document.querySelector('#share-link');
	shareLink.addEventListener('click', createLink);

	// if navigator.clipboard does not exist, change text
	if (!navigator?.clipboard) {
		shareLink.textContent = 'Get Permalink';
	}

	// refresh the displayed link each time the share tab is opened
	document.querySelector('#tab-panel-share')?.addEventListener('tab-shown', showLink);
};

const buildLink = () => {
	// list to receive checkbox statuses
	const queryStringElements = {};

	const captureField = (selector, getValue) => {
		elemForEach(selector, (elem) => {
			const key = elem?.name ?? elem?.id;
			if (key) queryStringElements[key] = getValue(elem);
		});
	};
	captureField('input[type=checkbox]', (elem) => elem?.checked ?? false);
	captureField('select', (elem) => elem?.value ?? '');

	// get any hidden settings
	hiddenSettings.forEach((setting) => {
		// determine type
		let value;
		if (setting.value instanceof Setting) {
			value = setting.value.value;
		} else if (typeof setting.value === 'function') {
			value = setting.value();
		}
		// nothing saved (such as no location when the page was opened from a link) would become the text "null"
		if (value !== null && value !== undefined) queryStringElements[setting.name] = value;
	});

	const params = new URLSearchParams(queryStringElements);
	// each video source is its own repeated video= parameter
	getVideoSources()
		.filter((source) => source?.url)
		.forEach((source) => params.append('video', encodeSourceForPermalink(source)));
	const queryString = params.toString();

	return new URL(`?${queryString}`, document.location.href);
};

// write the current link to the read-only box on the share tab
const showLink = () => {
	const url = buildLink();
	document.querySelector('#share-link-url').value = url;
	return url;
};

const createLink = (e) => {
	// cancel default event
	e.preventDefault();

	const url = showLink();

	// send to proper function based on availability of clipboard
	if (navigator?.clipboard) {
		copyToClipboard(url);
	} else {
		selectLink();
	}
};

const copyToClipboard = async (url) => {
	try {
		// write to clipboard
		await navigator.clipboard.writeText(url.toString());
		openCopyResultModal(true);
	} catch (error) {
		console.error(error);
		// select the link once the modal has closed and returned focus to the button
		openCopyResultModal(false, 'Copy failed. The link is selected below, copy it by hand.')
			.then(() => setTimeout(selectLink, 0));
	}
};

// highlight the link so it can be copied by hand
const selectLink = () => {
	const shareLinkUrl = document.querySelector('#share-link-url');
	shareLinkUrl.focus();
	shareLinkUrl.select();
};

const registerHiddenSetting = (name, value) => {
	// value can be a function that returns the current value of the setting
	// or an instance of Setting
	hiddenSettings.push({
		name,
		value,
	});
};

export {
	registerHiddenSetting,
	buildLink,
};
