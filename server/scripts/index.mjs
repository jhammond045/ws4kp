import { json } from './modules/utils/fetch.mjs';
import noSleep from './modules/utils/nosleep.mjs';
import {
	message as navMessage, isPlaying, resetStatuses, resetDisplays, getDisplays,
} from './modules/navigation.mjs';
import { latLonReceived, setLocationStatus, cancelWeather } from './modules/location.mjs';
import { round2 } from './modules/utils/units.mjs';
import { registerHiddenSetting, buildLink } from './modules/share.mjs';
import './modules/tabs.mjs';
import { clearLocationRows } from './modules/headend.mjs';
import settings from './modules/settings.mjs';
import AutoComplete from './modules/autocomplete.mjs';
import { StationInfo } from './modules/utils/data-loader.mjs';
import { debugFlag } from './modules/utils/debug.mjs';
import {
	parseQueryString, adoptParams, removeAdoptedParams, SETTINGS_KEY,
} from './modules/utils/setting.mjs';
import { Settings } from './vendor/auto/luxon.mjs';
import { resize, isIOS } from './modules/utils/scaling.mjs';
import createOsdMenu, { LAST_CATEGORY_KEY } from './modules/osd/osdMenu.mjs';
import { openOsdModal, closeOsdModal } from './modules/osd/osdModal.mjs';
import toggleMediaPlayback, { mediaPlaying, mediaVolume } from './modules/media.mjs';
import { customText, customTextEnable } from './modules/custom-scroll-text.mjs';
import { openVideoManager } from './modules/video/manager.mjs';
import {
	getVideoSources, subscribeVideoSources, STORAGE_KEY as VIDEO_SOURCES_KEY, PERMALINK_FLAG_KEY as VIDEO_PERMALINK_KEY,
} from './modules/video/sources.mjs';

// set luxon's default locale to en-US as the forecast text and other hard coded assets are only available in English
Settings.defaultLocale = 'en-US';

document.addEventListener('DOMContentLoaded', () => {
	init();
	getCustomCode();
});

const categories = [
	'Land Features',
	'Bay', 'Channel', 'Cove', 'Dam', 'Delta', 'Gulf', 'Lagoon', 'Lake', 'Ocean', 'Reef', 'Reservoir', 'Sea', 'Sound', 'Strait', 'Waterfall', 'Wharf', // Water Features
	'Amusement Park', 'Historical Monument', 'Landmark', 'Tourist Attraction', 'Zoo', // POI/Arts and Entertainment
	'College', // POI/Education
	'Beach', 'Campground', 'Golf Course', 'Harbor', 'Nature Reserve', 'Other Parks and Outdoors', 'Park', 'Racetrack',
	'Scenic Overlook', 'Ski Resort', 'Sports Center', 'Sports Field', 'Wildlife Reserve', // POI/Parks and Outdoors
	'Airport', 'Ferry', 'Marina', 'Pier', 'Port', 'Resort', // POI/Travel
	'Postal', 'Populated Place',
];
const category = categories.join(',');

// suggestions are ranked toward the saved location, which is rounded to about 10 km so that precise
// GPS coordinates are not sent to the geocoder with every keystroke
const locationBias = () => {
	try {
		const { lat, lon } = JSON.parse(localStorage.getItem('latLon'));
		return { location: `${lon.toFixed(1)},${lat.toFixed(1)}` };
	} catch {
		// nothing saved yet, so no bias
		return {};
	}
};
const TXT_ADDRESS_SELECTOR = '#txtLocation';
const TOGGLE_FULL_SCREEN_SELECTOR = '#ToggleFullScreen';
const BTN_GET_GPS_SELECTOR = '#btnGetGps';

const init = async () => {
	document.querySelector(TXT_ADDRESS_SELECTOR).addEventListener('focus', (e) => {
		e.target.select();
	});

	document.querySelector('#NavigateSetup').addEventListener('click', btnNavigateSetupClick);
	document.querySelector('#NavigateMenu').addEventListener('click', btnNavigateMenuClick);
	document.querySelector('#NavigateRefresh').addEventListener('click', btnNavigateRefreshClick);
	document.querySelector('#NavigateNext').addEventListener('click', btnNavigateNextClick);
	document.querySelector('#NavigatePrevious').addEventListener('click', btnNavigatePreviousClick);
	document.querySelector('#NavigatePlay').addEventListener('click', btnNavigatePlayClick);
	document.querySelector('#ToggleScanlines').addEventListener('click', btnNavigateToggleScanlines);

	// a mouse click leaves focus on the toolbar button, which would stop the keyboard shortcuts from working
	// keyboard presses (detail 0) keep focus so keyboard users can keep tabbing through the toolbar
	document.querySelector('#divTwcBottom').addEventListener('click', (e) => {
		if (e.detail > 0) e.target.closest('button')?.blur();
	});

	// Hide fullscreen button on iOS since it doesn't support true fullscreen
	const fullscreenButton = document.querySelector(TOGGLE_FULL_SCREEN_SELECTOR);
	if (isIOS()) {
		fullscreenButton.style.display = 'none';
	} else {
		fullscreenButton.addEventListener('click', btnFullScreenClick);
	}
	document.addEventListener('fullscreenchange', fullscreenChanged);

	const btnGetGps = document.querySelector(BTN_GET_GPS_SELECTOR);
	btnGetGps.addEventListener('click', btnGetGpsClick);
	if (!navigator.geolocation) btnGetGps.style.display = 'none';

	document.querySelector('#divTwc').addEventListener('mousemove', () => {
		if (document.fullscreenElement || settings.kiosk?.value) updateFullScreenNavigate();
	});

	document.querySelector('#btnGetLatLng').addEventListener('click', () => autoComplete.directFormSubmit());

	document.addEventListener('keydown', documentKeydown);
	document.addEventListener('touchmove', (e) => {
		if (document.fullscreenElement) e.preventDefault();
	});

	const autoComplete = new AutoComplete(document.querySelector(TXT_ADDRESS_SELECTOR), {
		serviceUrl: 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest',
		deferRequestBy: 300,
		// the full width of .location-input, so the list follows the text box as the page resizes
		width: '100%',
		paramName: 'text',
		params: () => ({
			f: 'json',
			countryCode: 'USA',
			category,
			maxSuggestions: 10,
			...locationBias(),
		}),
		dataType: 'json',
		transformResult: (response) => ({
			suggestions: response.suggestions.map((i) => ({
				value: i.text,
				data: i.magicKey,
			})),
		}),
		minChars: 3,
		showNoSuggestionNotice: true,
		noSuggestionNotice: 'No results found. Please try a different search string.',
		onSelect(suggestion) {
			autocompleteOnSelect(suggestion);
		},
	});
	window.autoComplete = autoComplete;

	// attempt to parse the url parameters
	const parsedParameters = parseQueryString();
	const loadFromParsed = !!parsedParameters.latLon;

	// Auto load the parsed parameters and fall back to the previous query
	const query = parsedParameters.latLonQuery ?? localStorage.getItem('latLonQuery');
	const latLon = parsedParameters.latLon ?? localStorage.getItem('latLon');
	// a location from a link replaces the saved one, and GPS, the same as a location entered here
	// GPS is turned off only once the link's location is found, a link that can't be found leaves it on
	const linkHasLocation = loadFromParsed || !!parsedParameters.latLonQuery;
	// compared to the string, earlier versions could store 'false'
	let fromGPS = localStorage.getItem('latLonFromGPS') === 'true' && !linkHasLocation;

	if (parsedParameters.latLonQuery && !parsedParameters.latLon) {
		const txtAddress = document.querySelector(TXT_ADDRESS_SELECTOR);
		txtAddress.value = parsedParameters.latLonQuery;
		const geometry = await findLocation({ text: parsedParameters.latLonQuery });
		if (geometry) {
			localStorage.removeItem('latLonFromGPS');
			doRedirectToGeometry(geometry);
			adoptParams('latLonQuery');
		} else {
			fromGPS = localStorage.getItem('latLonFromGPS') === 'true';
		}
	} else if (latLon && !fromGPS) {
		// update in-page search box if using cached data, or parsed parameter
		if ((query && !loadFromParsed) || (parsedParameters.latLonQuery && loadFromParsed)) {
			const txtAddress = document.querySelector(TXT_ADDRESS_SELECTOR);
			txtAddress.value = query;
		}
		// use lat-long lookup if that's all that was provided in the query string
		if (loadFromParsed && parsedParameters.latLon && !parsedParameters.latLonQuery) {
			const { lat, lon } = JSON.parse(latLon);
			// the location is saved, and removed from the address, once the weather service knows it
			// a link that fails keeps it in the address, so a refresh tries again
			getForecastFromLatLon(lat, lon, false, () => {
				adoptParams('latLon');
				removeAdoptedParams();
			});
		} else {
			// otherwise use pre-stored data, or the link's location which is saved like one entered here
			const parsedLatLon = JSON.parse(latLon);
			const { lat, lon } = parsedLatLon ?? {};
			if (loadFromParsed && Number.isFinite(lat) && Number.isFinite(lon)) {
				localStorage.removeItem('latLonFromGPS');
				localStorage.setItem('latLonQuery', query);
				localStorage.setItem('latLon', JSON.stringify({ lat, lon }));
				adoptParams('latLon', 'latLonQuery');
			}
			loadData(parsedLatLon);
		}
	}
	if (fromGPS) {
		btnGetGpsClick();
	}

	// Handle kiosk mode initialization
	const urlKioskCheckbox = parsedParameters?.kiosk ?? parsedParameters['settings-kiosk-checkbox'];

	// If kiosk=false is specified, disable kiosk mode and clear any stored value
	if (urlKioskCheckbox === 'false') {
		settings.kiosk.value = false;
		// Clear stored value by using conditional storage with false
		settings.kiosk.conditionalStoreToLocalStorage(false, false);
		adoptParams('kiosk', 'settings-kiosk-checkbox');
	} else if (urlKioskCheckbox === 'true') {
		// if kiosk mode was set via the query string, enable it
		settings.kiosk.value = true;
		// only saved with sticky kiosk, otherwise the address keeps it so a refresh stays in kiosk mode
		if (settings.stickyKiosk.value) adoptParams('kiosk', 'settings-kiosk-checkbox');
	}

	// the link's saved settings, screens and location are now this browser's own, remove them from the address
	// so a refresh shows later changes instead of the link again
	removeAdoptedParams();

	// Auto-play logic: also play immediately if kiosk mode is enabled
	const play = settings.kiosk.value || urlKioskCheckbox === 'true' ? 'true' : localStorage.getItem('play');
	if (play === null || play === 'true') sendNavButtonMessage('navButton', 'play');

	document.querySelector('#btnClearQuery').addEventListener('click', () => {
		// stop any lookup still running, then go back to the title card
		cancelWeather();
		resetDisplays();
		currentLatLon = undefined;

		// the button is not inside a form, so it does not clear the location box by itself
		autoComplete.reset();
		clearLocationRows();

		// playing is the default, so the next location entered starts playing
		localStorage.removeItem('play');
		sendNavButtonMessage('navButton', 'play');

		localStorage.removeItem('latLonQuery');
		localStorage.removeItem('latLon');
		localStorage.removeItem('latLonFromGPS');
		// the next load is treated as a first visit, which lets custom code (such as a geoip lookup) run again
		localStorage.removeItem('firstRun');
		document.querySelector(BTN_GET_GPS_SELECTOR).classList.remove('active');
		setLocationStatus();

		// a location in the address would be loaded again on a refresh, other parameters (kiosk, settings) are kept
		const url = new URL(window.location.href);
		url.searchParams.delete('latLonQuery');
		url.searchParams.delete('latLon');
		window.history.replaceState(null, '', url);
	});

	// swipe functionality
	document.querySelector('#container').addEventListener('swiped-left', () => swipeCallBack('left'));
	document.querySelector('#container').addEventListener('swiped-right', () => swipeCallBack('right'));

	// register hidden settings for search and location query
	registerHiddenSetting('latLonQuery', () => localStorage.getItem('latLonQuery'));
	registerHiddenSetting('latLon', () => localStorage.getItem('latLon'));

	// Station info is required for location lookup,
	// Other static data missing is handled by the pages that use it
	try {
		await StationInfo;
	} catch (error) {
		console.error('Failed to load core application data:', error);
		// Show error message to user and halt initialization
		document.body.innerHTML = `
			<div>
				<h2>Unable to load Weather Data</h2>
				<p>The application cannot start because core data failed to load.</p>
				<p>Please check your connection and try refreshing.</p>
			</div>
		`;
	}
};

// look up a search, or a chosen suggestion (text and magicKey), and return its geometry
// reports the problem to the user and returns null when the location can't be found
const findLocation = async (search) => {
	setLocationStatus();
	try {
		// Note: it's fine that this uses json instead of safeJson since it's infrequent and user-initiated
		const data = await json('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/find', {
			data: {
				...search,
				f: 'json',
			},
		}, {
			retryCount: 0,
		});
		// json() returns null when the request was aborted
		if (!data) throw new Error('no response');

		const geometry = data.locations?.[0]?.feature?.geometry;
		if (!geometry) setLocationStatus(`Couldn't find "${search.text}". Try a different search.`);
		return geometry ?? null;
	} catch (error) {
		console.error('Geocoding failed:', error);
		setLocationStatus('Location search isn\'t responding. Please try again.');
		return null;
	}
};

const autocompleteOnSelect = async (suggestion) => {
	const geometry = await findLocation({
		text: suggestion.value,
		magicKey: suggestion.data,
	});
	if (!geometry) return;

	localStorage.removeItem('latLonFromGPS');
	document.querySelector(BTN_GET_GPS_SELECTOR).classList.remove('active');
	doRedirectToGeometry(geometry);
};

const doRedirectToGeometry = (geom, haveDataCallback) => {
	const latLon = { lat: round2(geom.y, 4), lon: round2(geom.x, 4) };
	// Save the query
	localStorage.setItem('latLonQuery', document.querySelector(TXT_ADDRESS_SELECTOR).value);
	localStorage.setItem('latLon', JSON.stringify(latLon));

	// get the data
	loadData(latLon, haveDataCallback);
};

const btnFullScreenClick = () => {
	if (document.fullscreenElement) {
		// Note: Chrome can't leave a fullscreen the user entered with F11 this way
		document.exitFullscreen();
	} else {
		enterFullScreen();
	}

	if (isPlaying()) {
		noSleep(true);
	} else {
		noSleep(false);
	}

	return false;
};

// This is async because requestFullscreen returns a Promise
const enterFullScreen = async () => {
	const element = document.querySelector('#divTwc');

	if (!element.requestFullscreen) {
		// iPhone Safari has no fullscreen for page elements
		window.scrollTo(0, 0);
		resize(true); // Force resize for iOS
		updateFullScreenNavigate();
		return;
	}

	try {
		await element.requestFullscreen({ navigationUI: 'hide' });

		if (debugFlag('fullscreen')) {
			setTimeout(() => {
				console.log(`🖥️ Fullscreen engaged. window=${window.innerWidth}x${window.innerHeight} fullscreenElement=${!!document.fullscreenElement}`);
			}, 150);
		}
	} catch (error) {
		console.error('❌ Fullscreen request failed:', error);
	}
};

// the button and the control bar follow the fullscreen state however it changed:
// the button, the F key, Esc or the browser's own controls
// Note: resize is called by the fullscreenchange listener in scaling.mjs
const fullscreenChanged = () => {
	const isFullscreen = !!document.fullscreenElement;
	const label = isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
	const button = document.querySelector(TOGGLE_FULL_SCREEN_SELECTOR);
	button.querySelector('img').src = isFullscreen ? 'images/nav/ic_fullscreen_exit_white_24dp_2x.png' : 'images/nav/ic_fullscreen_white_24dp_2x.png';
	button.title = label;
	button.setAttribute('aria-label', label);

	// shows the control bar and cursor, and hides them again after a pause while fullscreen
	updateFullScreenNavigate();
};

const btnNavigateMenuClick = () => {
	sendNavButtonMessage('navButton', 'menu');
	return false;
};

// OSD menu actions, each opens an OSD modal
const attemptCopyToClipboard = async (text) => {
	if (!navigator?.clipboard?.writeText) return false;
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch (error) {
		console.warn('Unable to copy permalink to clipboard', error);
		return false;
	}
};

const openPermalinkModal = async () => {
	// the same link as the share tab, including video sources
	const url = buildLink().toString();
	const container = document.createElement('div');
	container.className = 'ws-osd-modal__permalink';

	const instructions = document.createElement('p');
	instructions.textContent = 'Copy this link to share your WeatherStar setup:';
	const input = document.createElement('input');
	input.type = 'text';
	input.value = url;
	input.readOnly = true;
	input.className = 'ws-osd-modal__permalink-input';
	input.setAttribute('aria-label', 'Permalink');

	const status = document.createElement('p');
	status.className = 'ws-osd-modal__permalink-status';

	container.append(instructions, input, status);

	const copied = await attemptCopyToClipboard(url);
	status.textContent = copied ? 'Copied to clipboard.' : 'Copy failed. Highlight the link and copy it by hand.';

	const modalPromise = openOsdModal({
		title: '--------- PERMALINK ---------',
		body: container,
		actions: [{ id: 'ok', label: '[ OK ]', primary: true }],
		autofocus: 'ok',
	});

	// focus is in the link, so Enter there is OK
	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') closeOsdModal('ok');
	});
	requestAnimationFrame(() => {
		input.focus();
		input.select();
	});

	return modalPromise;
};

const openAboutModal = () => {
	const wrapper = document.createElement('div');
	wrapper.className = 'ws-osd-modal__about';

	const versionText = document.getElementById('version')?.textContent?.trim?.() ?? '';
	const versionParagraph = document.createElement('p');
	versionParagraph.textContent = versionText ? `WeatherStar 4000+ v${versionText}` : 'WeatherStar 4000+';
	const creditsParagraph = document.createElement('p');
	creditsParagraph.textContent = 'A fan-made tribute to The Weather Channel\'s WeatherStar 4000 experience.';
	const linkParagraph = document.createElement('p');
	const repoLink = document.createElement('a');
	repoLink.href = 'https://github.com/netbymatt/ws4kp';
	repoLink.target = '_blank';
	repoLink.rel = 'noopener noreferrer';
	repoLink.textContent = 'GitHub Repository';
	linkParagraph.append('Source code and credits: ', repoLink);

	wrapper.append(versionParagraph, creditsParagraph, linkParagraph);

	return openOsdModal({
		title: '--------- ABOUT ---------',
		body: wrapper,
		actions: [{ id: 'ok', label: '[ OK ]', primary: true }],
		autofocus: 'ok',
	});
};

// clear everything this app saved and reload without any url parameters, which brings back every default
// only this app's own keys are removed by name, a static copy can share its origin (github.io) with other sites
const resetAllSettings = () => {
	[
		SETTINGS_KEY, 'latLon', 'latLonQuery', 'latLonFromGPS', 'play', 'firstRun',
		VIDEO_SOURCES_KEY, VIDEO_PERMALINK_KEY, LAST_CATEGORY_KEY,
		...getDisplays().map((display) => `display-enabled: ${display.elemId}`),
	].forEach((key) => localStorage.removeItem(key));
	window.location.assign(window.location.pathname);
};

const confirmResetDefaults = async () => {
	const body = document.createElement('div');
	body.className = 'ws-osd-modal__confirm';
	const message = document.createElement('p');
	message.textContent = 'Reset all settings, screens, location and video sources to their defaults? The page will reload.';
	body.append(message);

	const result = await openOsdModal({
		title: '--------- CONFIRM ---------',
		body,
		actions: [
			{ id: 'cancel', label: '[ CANCEL ]' },
			{ id: 'reset', label: '[ RESET ]', primary: true },
		],
		autofocus: 'cancel',
	});

	if (result?.action === 'reset') resetAllSettings();
};

// the location box is moved into the modal while it is open, and back to its place on the page after
const openLocationModal = async () => {
	const queryContainer = document.querySelector('#divQuery');
	if (!queryContainer) return;

	const placeholder = document.createElement('div');
	placeholder.hidden = true;
	queryContainer.before(placeholder);
	queryContainer.classList.add('ws-osd-location__content');

	const wrapper = document.createElement('div');
	wrapper.className = 'ws-osd-location';
	const instructions = document.createElement('div');
	instructions.className = 'ws-osd-location__instructions';
	instructions.textContent = 'Enter your ZIP code or city and state';
	wrapper.append(instructions, queryContainer);

	const result = openOsdModal({
		title: '--------- LOCATION ---------',
		body: wrapper,
		actions: [{ id: 'close', label: '[ CLOSE ]', primary: true }],
		autofocus: 'close',
	});

	const input = queryContainer.querySelector(TXT_ADDRESS_SELECTOR);
	requestAnimationFrame(() => input?.focus());

	await result;

	queryContainer.classList.remove('ws-osd-location__content');
	placeholder.replaceWith(queryContainer);
};

const confirmUnitsChange = async (currentValue, nextValue) => {
	if (currentValue === nextValue) return true;
	const label = settings.units.values.find(([value]) => value === nextValue)?.[1] ?? nextValue;
	const body = document.createElement('div');
	body.className = 'ws-osd-modal__confirm';
	const message = document.createElement('p');
	message.textContent = `Switch units to ${String(label).toUpperCase()}? The page will reload.`;
	body.append(message);

	const result = await openOsdModal({
		title: '--------- CONFIRM ---------',
		body,
		actions: [
			{ id: 'cancel', label: '[ CANCEL ]' },
			{ id: 'confirm', label: '[ SWITCH ]', primary: true },
		],
		autofocus: 'cancel',
	});

	return result?.action === 'confirm';
};

// asked before kiosk mode turns on, the kiosk row sets the value when this returns true
const requestKioskEnable = async () => {
	const body = document.createElement('div');
	body.className = 'ws-osd-modal__confirm';
	const message = document.createElement('p');
	message.textContent = 'Kiosk mode fills the window with the weather display and hides the toolbar and the rest of the page. There is no on-screen way back: press Ctrl-K to leave kiosk mode.';
	body.append(message);

	const result = await openOsdModal({
		title: '--------- KIOSK MODE ---------',
		body,
		actions: [
			{ id: 'cancel', label: '[ CANCEL ]' },
			{ id: 'enable', label: '[ ENABLE ]', primary: true },
		],
		autofocus: 'cancel',
	});

	return result?.action === 'enable';
};

// custom-scroll-text.mjs, pipe characters separate messages that are picked at random
const editCustomText = async () => {
	const body = document.createElement('div');
	body.className = 'ws-osd-modal__permalink';
	const instructions = document.createElement('p');
	instructions.textContent = 'Text to scroll. Separate several messages with |';
	const input = document.createElement('input');
	input.type = 'text';
	input.value = customText.value ?? '';
	input.placeholder = 'Text to scroll';
	input.className = 'ws-osd-modal__permalink-input';
	input.setAttribute('aria-label', 'Custom text');
	body.append(instructions, input);

	const result = openOsdModal({
		title: '--------- CUSTOM TEXT ---------',
		body,
		actions: [
			{ id: 'cancel', label: '[ CANCEL ]' },
			{ id: 'set', label: '[ SET ]', primary: true },
		],
		autofocus: 'set',
	});
	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') closeOsdModal('set');
	});
	requestAnimationFrame(() => input.focus());

	if ((await result)?.action === 'set') customText.value = input.value;
};

// the OSD menu is created on first use
let osdMenuController = null;
const toggleOsdMenu = () => {
	if (!osdMenuController) {
		try {
			osdMenuController = createOsdMenu({
				// the scroll text settings live in their own module
				settings: { ...settings, customText, customTextEnable },
				getDisplays,
				media: {
					isAvailable: () => document.querySelector('#ToggleMediaContainer')?.classList.contains('available') ?? false,
					getPlaying: () => mediaPlaying.value === true,
					setPlaying: (value) => {
						if (!!value !== (mediaPlaying.value === true)) toggleMediaPlayback();
					},
					getVolume: () => mediaVolume.value,
					setVolume: (value) => {
						mediaVolume.value = value;
					},
				},
				video: {
					getSources: getVideoSources,
					subscribe: subscribeVideoSources,
					openManager: openVideoManager,
				},
				actions: {
					openLocation: openLocationModal,
					openVideoManager,
					openPermalinkModal,
					confirmResetDefaults,
					openAboutModal,
					confirmUnitsChange,
					editCustomText,
					requestKioskEnable,
				},
				navigation: {
					isPlaying,
					sendCommand: (command) => sendNavButtonMessage('navButton', command),
				},
			});
		} catch (error) {
			console.error('Failed to initialize OSD menu', error);
			return;
		}
	}
	if (osdMenuController.isOpen?.()) {
		osdMenuController.close();
	} else {
		osdMenuController.open();
	}
};

const btnNavigateSetupClick = () => {
	toggleOsdMenu();
	return false;
};

let currentLatLon;

const loadData = (_latLon, haveDataCallback) => {
	// if latlon is provided store it locally
	if (_latLon) currentLatLon = _latLon;
	// get the data
	// if there's no data stop
	if (!currentLatLon) return;

	document.querySelector(TXT_ADDRESS_SELECTOR).blur();
	latLonReceived(currentLatLon, haveDataCallback);
};

const swipeCallBack = (direction) => {
	switch (direction) {
		case 'left':
			btnNavigateNextClick();
			break;

		case 'right':
		default:
			btnNavigatePreviousClick();
			break;
	}
};

const btnNavigateRefreshClick = () => {
	resetStatuses();
	loadData();

	return false;
};

const btnNavigateNextClick = () => {
	sendNavButtonMessage('navButton', 'next');

	return false;
};

const btnNavigatePreviousClick = () => {
	sendNavButtonMessage('navButton', 'previous');

	return false;
};

let navigateFadeIntervalId = null;

const updateFullScreenNavigate = () => {
	document.activeElement.blur();
	const divTwcBottom = document.querySelector('#divTwcBottom');
	divTwcBottom.classList.remove('hidden');
	divTwcBottom.classList.add('visible');
	document.querySelector('#divTwc').classList.remove('no-cursor');

	if (navigateFadeIntervalId) {
		clearTimeout(navigateFadeIntervalId);
		navigateFadeIntervalId = null;
	}

	navigateFadeIntervalId = setTimeout(() => {
		if (document.fullscreenElement || settings.kiosk?.value) {
			divTwcBottom.classList.remove('visible');
			divTwcBottom.classList.add('hidden');
			document.querySelector('#divTwc').classList.add('no-cursor');
		}
	}, 2000);
};

const documentKeydown = (e) => {
	const { key } = e;

	// Handle Ctrl+K to exit kiosk mode (even when other modifiers would normally be ignored)
	// before the menu check, so it also works with the OSD menu open
	if (e.ctrlKey && (key === 'k' || key === 'K')) {
		if (settings.kiosk?.value) {
			e.preventDefault();
			settings.kiosk.value = false;
			// the open menu's kiosk row shows the new value
			osdMenuController?.refresh();
		}
		return false;
	}

	// the OSD menu and its modals handle their own keys
	if (osdMenuController?.isOpen?.()) return false;

	// don't trigger on ctrl/alt/shift modified key for other shortcuts
	if (e.altKey || e.ctrlKey || e.shiftKey) return false;

	// these shortcuts are listed in the README under "Keyboard shortcuts"
	if (document.fullscreenElement || document.activeElement === document.body) {
		switch (key) {
			case ' ': // Space
				// don't scroll
				e.preventDefault();
				btnNavigatePlayClick();
				return false;

			case 'ArrowRight':
			case 'PageDown':
				// don't scroll
				e.preventDefault();
				btnNavigateNextClick();
				return false;

			case 'ArrowLeft':
			case 'PageUp':
				// don't scroll
				e.preventDefault();
				btnNavigatePreviousClick();
				return false;

			case 'ArrowUp': // open the OSD setup menu, which takes over the arrow keys while open (Esc closes it)
				e.preventDefault();
				toggleOsdMenu();
				return false;

			case '0': // zero: reload the forecast data
				btnNavigateRefreshClick();
				return false;

			case 'F':
			case 'f':
				btnFullScreenClick();
				return false;

			default:
		}
	}
	return false;
};

const btnNavigatePlayClick = () => {
	sendNavButtonMessage('navButton', 'playToggle');

	return false;
};

const btnNavigateToggleScanlines = () => {
	settings.scanLines.value = !settings.scanLines.value;
	return false;
};

// post a message to the iframe
const sendNavButtonMessage = (type, myMessage = {}) => {
	navMessage({ type, message: myMessage });
};

const getPosition = async () => new Promise((resolve, reject) => {
	navigator.geolocation.getCurrentPosition(resolve, reject);
});

const btnGetGpsClick = async () => {
	if (!navigator.geolocation) return;
	const btn = document.querySelector(BTN_GET_GPS_SELECTOR);

	// toggle first
	if (btn.classList.contains('active')) {
		btn.classList.remove('active');
		localStorage.removeItem('latLonFromGPS');
		return;
	}

	// set gps active
	btn.classList.add('active');
	setLocationStatus();

	// get position
	try {
		const position = await getPosition();
		const { latitude, longitude } = position.coords;
		getForecastFromLatLon(latitude, longitude, true);
	} catch (error) {
		btn.classList.remove('active');
		console.error('Unable to get GPS location:', error.message);
		setLocationStatus(gpsErrorText(error));
	}
};

// explain a failed geolocation request, error.code is from GeolocationPositionError
const gpsErrorText = (error) => {
	switch (error.code) {
		case 1: // PERMISSION_DENIED
			return 'Location access was blocked. Allow location access for this site, or enter a location.';
		case 3: // TIMEOUT
			return 'Finding your location took too long. Try again, or enter a location.';
		case 2: // POSITION_UNAVAILABLE
		default:
			return 'Your location couldn\'t be determined. Try again, or enter a location.';
	}
};

// onSaved runs once the weather service has the location and it has been saved
const getForecastFromLatLon = (latitude, longitude, fromGps = false, onSaved = undefined) => {
	const txtAddress = document.querySelector(TXT_ADDRESS_SELECTOR);
	txtAddress.value = `${round2(latitude, 4)}, ${round2(longitude, 4)}`;

	doRedirectToGeometry({ y: latitude, x: longitude }, (point) => {
		const location = point.properties.relativeLocation.properties;
		// Save the query
		const query = `${location.city}, ${location.state}`;
		localStorage.setItem('latLon', JSON.stringify({ lat: latitude, lon: longitude }));
		localStorage.setItem('latLonQuery', query);
		if (fromGps) {
			localStorage.setItem('latLonFromGPS', 'true');
		} else {
			localStorage.removeItem('latLonFromGPS');
			document.querySelector(BTN_GET_GPS_SELECTOR).classList.remove('active');
		}
		txtAddress.value = `${location.city}, ${location.state}`;
		onSaved?.();
	});
};

const getCustomCode = async () => {
	console.log('A 404 error for custom.js or custom.mjs is expected below for most applications');
	// fetch the custom file and see if it returns a 200 status
	const response = await fetch('scripts/custom.js', { method: 'HEAD' });
	if (response.ok) {
		// add the script element to the page
		const customElem = document.createElement('script');
		customElem.src = 'scripts/custom.js';
		customElem.type = 'text/javascript';
		document.body.append(customElem);
	}

	// fetch the custom file and see if it returns a 200 status
	const responseMjs = await fetch('scripts/custom.mjs', { method: 'HEAD' });
	if (responseMjs.ok) {
		// add the script element to the page
		const customElem = document.createElement('script');
		customElem.src = 'scripts/custom.mjs';
		customElem.type = 'module';
		document.body.append(customElem);
	}
};

// expose functions for external use
window.getForecastFromLatLon = getForecastFromLatLon;
