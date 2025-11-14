import { elemForEach } from './utils/elem.mjs';
import {
	getVideoSources,
	encodeSourceForPermalink,
	getIncludeVideosInPermalink,
} from './video/sources.mjs';

document.addEventListener('DOMContentLoaded', () => init());

// shorthand mappings for frequently used values
const specialMappings = {
	kiosk: 'settings-kiosk-checkbox',
};

const init = () => {
	// add action to existing link
	const shareLink = document.querySelector('#share-link');
	if (!shareLink) {
		console.warn('Share link element not found; skipping share module init.');
		return;
	}
	shareLink.addEventListener('click', createLink);

	// if navigator.clipboard does not exist, change text
	if (!navigator?.clipboard) {
		shareLink.textContent = 'Get Permalink';
	}
};

const createLink = async (e) => {
	// cancel default event (click on hyperlink)
	e.preventDefault();

	// list to receive checkbox statuses
	const queryStringElements = {};

	elemForEach('input[type=checkbox]', (elem) => {
		if (elem?.id) {
			queryStringElements[elem.id] = elem?.checked ?? false;
		}
	});

	// get all select boxes
	elemForEach('select', (elem) => {
		if (elem?.id) {
			queryStringElements[elem.id] = encodeURIComponent(elem?.value ?? '');
		}
	});

	// get all text boxes
	elemForEach('input[type=text]', (elem) => {
		if (elem?.id) {
			queryStringElements[elem.id] = elem?.value ?? 0;
		}
	});

	// add the location string
	queryStringElements.latLonQuery = localStorage.getItem('latLonQuery');
	queryStringElements.latLon = localStorage.getItem('latLon');

	const params = new URLSearchParams(queryStringElements);

	if (getIncludeVideosInPermalink()) {
		const videoSources = getVideoSources().filter((source) => source.url);
		videoSources.forEach((source) => {
			params.append('video', encodeSourceForPermalink(source));
		});
	}

	const url = new URL(`?${params.toString()}`, document.location.href);

	// send to proper function based on availability of clipboard
	if (navigator?.clipboard) {
		copyToClipboard(url);
	} else {
		writeLinkToPage(url);
	}
};

const copyToClipboard = async (url) => {
	try {
		// write to clipboard
		await navigator.clipboard.writeText(url.toString());
		// alert user
		const confirmSpan = document.querySelector('#share-link-copied');
		if (!confirmSpan) return;
		confirmSpan.style.display = 'inline';

		// hide confirm text after 5 seconds
		setTimeout(() => {
			confirmSpan.style.display = 'none';
		}, 5000);
	} catch (error) {
		console.error(error);
	}
};

const writeLinkToPage = (url) => {
	// get elements
	const shareLinkInstructions = document.querySelector(
		'#share-link-instructions',
	);
	if (!shareLinkInstructions) {
		console.warn('Share link instructions container not found.');
		return;
	}
	const shareLinkUrl = shareLinkInstructions.querySelector('#share-link-url');
	if (!shareLinkUrl) {
		console.warn('Share link URL input not found.');
		return;
	}
	// populate url and display
	shareLinkUrl.value = url;
	shareLinkInstructions.style.display = 'inline';
	// highlight for convenience
	shareLinkUrl.focus();
	shareLinkUrl.select();
};

const parseQueryString = () => {
	// return memoized result
	if (parseQueryString.params) return parseQueryString.params;
	const urlSearchParams = new URLSearchParams(window.location.search);

	// turn into an array of key-value pairs
	const paramsArray = [...urlSearchParams];

	// add additional expanded keys
	paramsArray.forEach((paramPair) => {
		const expandedKey = specialMappings[paramPair[0]];
		if (expandedKey) {
			paramsArray.push([expandedKey, paramPair[1]]);
		}
	});

	// memoize result
	parseQueryString.params = Object.fromEntries(paramsArray);

	return parseQueryString.params;
};

export { createLink, parseQueryString };
