// navigation handles progress, next/previous and initial load messages from the parent frame
import noSleep from './utils/nosleep.mjs';
import STATUS from './status.mjs';
import { wrap } from './utils/calc.mjs';
import { safeJson } from './utils/fetch.mjs';
import { getPoint } from './utils/weather.mjs';
import { debugFlag } from './utils/debug.mjs';
import settings from './settings.mjs';

document.addEventListener('DOMContentLoaded', () => {
	init();
});

const displays = [];

const resolveDisplayEnabledState = (display) => {
	if (!display || !display.elemId) return;
	const storageKey = `display-enabled: ${display.elemId}`;
	let resolved;
	try {
		if (typeof window !== 'undefined' && window.localStorage) {
			const stored = window.localStorage.getItem(storageKey);
			if (stored !== null) {
				resolved = stored === 'true';
			}
		}
	} catch (_error) {
		// ignore storage access errors
	}

	if (resolved === undefined) {
		if (typeof display.isEnabled === 'boolean') {
			resolved = display.isEnabled;
		} else if (display.defaultEnabled !== undefined) {
			resolved = !!display.defaultEnabled;
		} else {
			resolved = true;
		}
	}

	display.isEnabled = resolved;

	try {
		if (typeof window !== 'undefined' && window.localStorage) {
			window.localStorage.setItem(storageKey, resolved);
		}
	} catch (_error) {
		// ignore storage write failures
	}

	if (typeof display.setStatus === 'function') {
		const targetStatus = resolved ? STATUS.loading : STATUS.disabled;
		if (display.status !== targetStatus) {
			display.setStatus(targetStatus);
		}
	}
};

const trimDisplayTail = () => {
	while (displays.length > 0 && !displays[displays.length - 1]) {
		displays.pop();
	}
};
let playing = false;
let progress;
const weatherParameters = {};

const init = async () => {
	// set up the resize handler with debounce logic to prevent rapid-fire calls
	let resizeTimeout;

	// Handle fullscreen change events and trigger an immediate resize calculation
	const fullscreenEvents = [
		'fullscreenchange',
		'webkitfullscreenchange',
		'mozfullscreenchange',
		'MSFullscreenChange',
	];
	fullscreenEvents.forEach((eventName) => {
		document.addEventListener(eventName, () => {
			if (debugFlag('fullscreen')) {
				console.log(
					`🖥️ ${eventName} event fired. fullscreenElement=${!!document.fullscreenElement}`,
				);
			}
			resize(true);
		});
	});

	// De-bounced resize handler to prevent rapid-fire resize calls
	window.addEventListener('resize', () => {
		clearTimeout(resizeTimeout);
		resizeTimeout = setTimeout(() => resize(), 100);
	});

	// Handle orientation changes (Mobile Safari doesn't always fire resize events on orientation change)
	window.addEventListener('orientationchange', () => {
		if (debugFlag('resize')) {
			console.log(
				'📱 Orientation change detected, forcing resize after short delay',
			);
		}
		clearTimeout(resizeTimeout);
		// Use a slightly longer delay for orientation changes to allow the browser to settle
		resizeTimeout = setTimeout(() => resize(true), 200);
	});

	resize();

	generateCheckboxes();
};

const message = (data) => {
	// dispatch event
	if (!data.type) return false;
	if (data.type === 'navButton') return handleNavButton(data.message);
	return console.error(`Unknown event ${data.type}`);
};

const getWeather = async (latLon, haveDataCallback) => {
	// get initial weather data
	const point = await getPoint(latLon.lat, latLon.lon);

	// check if point data was successfully retrieved
	if (!point) {
		return;
	}

	if (typeof haveDataCallback === 'function') haveDataCallback(point);

	try {
		// get stations using centralized safe handling
		const stations = await safeJson(point.properties.observationStations);

		if (!stations) {
			console.warn('Failed to get Observation Stations');
			return;
		}

		// check if stations data is valid
		if (!stations || !stations.features || stations.features.length === 0) {
			console.warn('No Observation Stations found for this location');
			return;
		}

		const StationId = stations.features[0].properties.stationIdentifier;

		let { city } = point.properties.relativeLocation.properties;
		const { state } = point.properties.relativeLocation.properties;

		if (StationId in StationInfo) {
			city = StationInfo[StationId].city;
			[city] = city.split('/');
			city = city.replace(/\s+$/, '');
		}

		// populate the weather parameters
		weatherParameters.latitude = latLon.lat;
		weatherParameters.longitude = latLon.lon;
		weatherParameters.zoneId = point.properties.forecastZone.substr(-6);
		weatherParameters.radarId = point.properties.radarStation.substr(-3);
		weatherParameters.stationId = StationId;
		weatherParameters.weatherOffice = point.properties.cwa;
		weatherParameters.city = city;
		weatherParameters.state = state;
		weatherParameters.timeZone = point.properties.timeZone;
		weatherParameters.forecast = point.properties.forecast;
		weatherParameters.forecastGridData = point.properties.forecastGridData;
		weatherParameters.stations = stations.features;

		// update the main process for display purposes
		populateWeatherParameters(weatherParameters, point.properties);

		// reset the scroll
		postMessage({ type: 'current-weather-scroll', method: 'reload' });

		// draw the progress canvas and hide others
		hideAllCanvases();
		if (!settings?.kiosk?.value) {
			// In normal mode, hide loading screen and show progress
			// (In kiosk mode, keep the loading screen visible until autoplay starts)
			document.querySelector('#loading').style.display = 'none';
			if (progress) {
				await progress.drawCanvas();
				progress.showCanvas();
			}
		}

		// call for new data on each display
		displays.forEach((display) => display?.getData?.(weatherParameters));
	} catch (error) {
		console.error(`Failed to get weather data: ${error.message}`);
	}
};

// receive a status update from a module {id, value}
const updateStatus = (value) => {
	if (value.id < 0) return;
	if (!progress && !settings?.kiosk?.value) return;

	if (progress) progress.drawCanvas(getDisplays(), countLoadedDisplays());

	// first display is hazards and it must load before evaluating the first display
	if (!displays[0] || displays[0].status === STATUS.loading) return;

	// calculate first enabled display
	const firstDisplayIndex = displays.findIndex(
		(display) => display?.enabled && display?.timing?.totalScreens > 0,
	);
	const firstDisplay = firstDisplayIndex >= 0 ? displays[firstDisplayIndex] : undefined;
	if (!firstDisplay) return;

	// value.id = 0 is hazards, if they fail to load hot-wire a new value.id to the current display to see if it needs to be loaded
	// typically this plays out as current conditions loads, then hazards fails.
	if (
		value.id === 0
    && (value.status === STATUS.failed || value.status === STATUS.retrying)
	) {
		value.id = firstDisplayIndex;
		value.status = firstDisplay.status;
	}

	// if hazards data arrives after the firstDisplayIndex loads, then we need to hot wire this to the first display
	if (
		value.id === 0
    && value.status === STATUS.loaded
    && displays[0]
    && displays[0].timing
    && displays[0].timing.totalScreens === 0
	) {
		value.id = firstDisplayIndex;
		value.status = firstDisplay.status;
	}

	// if this is the first display and we're playing, load it up so it starts playing
	if (
		isPlaying()
    && value.id === firstDisplayIndex
    && value.status === STATUS.loaded
	) {
		navTo(msg.command.firstFrame);
	}
};

// note: a display that is "still waiting"/"retrying" is considered loaded intentionally
// the weather.gov api has long load times for some products when you are the first
// requester for the product after the cache expires
const countLoadedDisplays = () => getDisplays().reduce((acc, display) => {
	if (display.status === STATUS.loading) return acc;
	return acc + 1;
}, 0);

const hideAllCanvases = () => {
	displays.forEach((display) => display?.hideCanvas?.());
};

// is playing interface
const isPlaying = () => playing;

// navigation message constants
const msg = {
	response: {
		// display to navigation
		previous: Symbol('previous'), // already at first frame, calling function should switch to previous canvas
		inProgress: Symbol('inProgress'), // have data to display, calling function should do nothing
		next: Symbol('next'), // end of frames reached, calling function should switch to next canvas
	},
	command: {
		// navigation to display
		firstFrame: Symbol('firstFrame'),
		previousFrame: Symbol('previousFrame'),
		nextFrame: Symbol('nextFrame'),
		lastFrame: Symbol('lastFrame'), // used when navigating backwards from the begining of the next canvas
	},
};

// receive navigation messages from displays
const displayNavMessage = (myMessage) => {
	if (myMessage.type === msg.response.previous) loadDisplay(-1);
	if (myMessage.type === msg.response.next) loadDisplay(1);
};

// navigate to next or previous
const navTo = (direction) => {
	// test for a current display
	const current = currentDisplay();
	if (progress) progress.hideCanvas();
	if (!current) {
		// special case for no active displays (typically on progress screen)
		// find the first ready display
		let firstDisplay;
		let displayCount = 0;
		do {
			// Check if displayCount is within bounds and the display exists
			if (displayCount < displays.length && displays[displayCount]) {
				const display = displays[displayCount];
				if (
					display.status === STATUS.loaded
          && display.timing?.totalScreens > 0
				) {
					firstDisplay = display;
				}
			}
			displayCount += 1;
		} while (!firstDisplay && displayCount < displays.length);

		if (!firstDisplay) return;

		// In kiosk mode, hide the loading screen when we start showing the first display
		if (settings?.kiosk?.value) {
			document.querySelector('#loading').style.display = 'none';
		}

		firstDisplay.navNext(msg.command.firstFrame);
		firstDisplay.showCanvas();
		return;
	}
	if (direction === msg.command.nextFrame) currentDisplay().navNext();
	if (direction === msg.command.previousFrame) currentDisplay().navPrev();
};

// find the next or previous available display
const loadDisplay = (direction) => {
	const totalDisplays = displays.length;
	if (totalDisplays === 0) return;
	const curIdx = currentDisplayIndex();
	let idx;
	let foundSuitableDisplay = false;

	for (let i = 0; i < totalDisplays; i += 1) {
		// convert form simple 0-10 to start at current display index +/-1 and wrap
		idx = wrap(curIdx + (i + 1) * direction, totalDisplays);
		const candidate = displays[idx];
		if (
			candidate
      && candidate.status === STATUS.loaded
      && candidate.timing?.totalScreens > 0
		) {
			// Prevent infinite recursion by ensuring we don't select the same display
			if (idx !== curIdx) {
				foundSuitableDisplay = true;
				break;
			}
		}
	}

	// If no other suitable display was found, but current display is still suitable (e.g. user only enabled one display), stay on it
	const currentCandidate = curIdx >= 0 ? displays[curIdx] : undefined;
	if (
		!foundSuitableDisplay
    && currentCandidate
    && currentCandidate.status === STATUS.loaded
    && currentCandidate.timing?.totalScreens > 0
	) {
		idx = curIdx;
		foundSuitableDisplay = true;
	}

	// if no suitable display was found at all, do NOT proceed to avoid infinite recursion
	if (!foundSuitableDisplay) {
		console.warn('No suitable display found for navigation');
		return;
	}

	const newDisplay = displays[idx];
	if (!newDisplay) {
		console.warn('Attempted to navigate to an undefined display index', idx);
		return;
	}
	// hide all displays
	hideAllCanvases();
	// show the new display and navigate to an appropriate display
	if (direction < 0) newDisplay.showCanvas(msg.command.lastFrame);
	if (direction > 0) newDisplay.showCanvas(msg.command.firstFrame);
};

// get the current display index or value
const currentDisplayIndex = () => displays.findIndex((display) => display?.active);
const currentDisplay = () => {
	const index = currentDisplayIndex();
	return index === -1 ? undefined : displays[index];
};

const setPlaying = (newValue) => {
	playing = newValue;
	const playButton = document.querySelector('#NavigatePlay');
	localStorage.setItem('play', playing);

	if (playing) {
		noSleep(true).catch(() => {
			// Wake lock failed, but continue normally
		});
		playButton.title = 'Pause';
		playButton.src = 'images/nav/ic_pause_white_24dp_2x.png';
	} else {
		noSleep(false).catch(() => {
			// Wake lock disable failed, but continue normally
		});
		playButton.title = 'Play';
		playButton.src = 'images/nav/ic_play_arrow_white_24dp_2x.png';
	}
	// if we're playing and on the progress screen (or in kiosk mode), jump to the next screen
	if (playing && !currentDisplay()) {
		if (progress || settings?.kiosk?.value) {
			navTo(msg.command.firstFrame);
		}
	}
};

// handle all navigation buttons
const handleNavButton = (button) => {
	switch (button) {
		case 'play':
			setPlaying(true);
			break;
		case 'playToggle':
			setPlaying(!playing);
			break;
		case 'stop':
			setPlaying(false);
			break;
		case 'next':
			setPlaying(false);
			navTo(msg.command.nextFrame);
			break;
		case 'previous':
			setPlaying(false);
			navTo(msg.command.previousFrame);
			break;
		case 'menu':
			setPlaying(false);
			postMessage({ type: 'current-weather-scroll', method: 'hide' });
			if (progress) {
				progress.showCanvas();
			} else if (settings?.kiosk?.value) {
				// In kiosk mode without progress, show the loading screen
				document.querySelector('#loading').style.display = 'flex';
			}
			hideAllCanvases();
			break;
		default:
			console.error(`Unknown navButton ${button}`);
	}
};

// return the specificed display
const getDisplay = (index) => displays[index];

// Helper function to detect iOS (using technique from nosleep.js)
const isIOS = () => {
	const { userAgent } = navigator;
	const iOSRegex = /CPU.*OS ([0-9_]{1,})[0-9_]{0,}|(CPU like).*AppleWebKit.*Mobile/i;
	return iOSRegex.test(userAgent) && !window.MSStream;
};

// Track the last applied scale to avoid redundant operations
let lastAppliedScale = null;
let lastAppliedKioskMode = null;

// Helper function to clear CSS properties from elements
const clearElementStyles = (element, properties) => {
	properties.forEach((prop) => element.style.removeProperty(prop));
};

// Define property groups for different scaling modes
const SCALING_PROPERTIES = {
	wrapper: ['width', 'height', 'transform', 'transform-origin'],
	positioning: [
		'transform',
		'transform-origin',
		'width',
		'height',
		'position',
		'left',
		'top',
		'margin-left',
		'margin-top',
	],
};

// resize the container on a page resize
const resize = (force = false) => {
	// Ignore resize events caused by pinch-to-zoom on mobile
	if (
		window.visualViewport
    && Math.abs(window.visualViewport.scale - 1) > 0.01
	) {
		return;
	}

	const isFullscreen = !!document.fullscreenElement;
	const isKioskMode = settings.kiosk?.value || false;
	const isMobileSafariKiosk = isIOS() && isKioskMode; // Detect Mobile Safari in kiosk mode (regardless of standalone status)
	const targetWidth = settings.wide.value ? 640 + 107 + 107 : 640;

	// Use window width instead of bottom container width to avoid zero-dimension issues
	const widthZoomPercent = window.innerWidth / targetWidth;
	const heightZoomPercent = window.innerHeight / 480;

	// Standard scaling: fit within both dimensions
	const scale = Math.min(widthZoomPercent, heightZoomPercent);

	// Use centering behavior for fullscreen, kiosk mode, or Mobile Safari kiosk mode
	const isKioskLike = isFullscreen || isKioskMode || isMobileSafariKiosk;

	if (debugFlag('resize') || debugFlag('fullscreen')) {
		console.log(
			`🖥️ Resize: force=${force} isKioskLike=${isKioskLike} window=${
				window.innerWidth
			}x${
				window.innerHeight
			} targetWidth=${targetWidth} widthZoom=${widthZoomPercent.toFixed(
				3,
			)} heightZoom=${heightZoomPercent.toFixed(3)} finalScale=${scale.toFixed(
				3,
			)} fullscreenElement=${!!document.fullscreenElement} isIOS=${isIOS()} standalone=${
				window.navigator.standalone
			} isMobileSafariKiosk=${isMobileSafariKiosk} kioskMode=${
				settings.kiosk?.value
			} wideMode=${settings.wide.value}`,
		);
	}

	// Prevent zero or negative scale values
	if (scale <= 0) {
		console.warn('Invalid scale calculated, skipping resize');
		return;
	}

	// Skip redundant resize operations if scale and mode haven't changed (unless forced)
	const scaleChanged = Math.abs((lastAppliedScale || 0) - scale) > 0.001;
	const modeChanged = lastAppliedKioskMode !== isKioskLike;

	if (!force && !scaleChanged && !modeChanged) {
		return; // No meaningful change, skip resize operation
	}

	// Update tracking variables
	lastAppliedScale = scale;
	lastAppliedKioskMode = isKioskLike;
	window.currentScale = scale; // Make scale available to settings module

	const wrapper = document.querySelector('#divTwc');
	const mainContainer = document.querySelector('#divTwcMain');

	// BASELINE: content fits naturally, no scaling needed
	if (!isKioskLike && scale >= 1.0 && !isKioskMode) {
		if (debugFlag('fullscreen')) {
			console.log('🖥️ Resetting fullscreen/kiosk styles to normal');
		}

		// Reset all scaling-related styles
		const container = document.querySelector('#container');
		clearElementStyles(wrapper, SCALING_PROPERTIES.wrapper);
		clearElementStyles(container, SCALING_PROPERTIES.positioning);
		clearElementStyles(mainContainer, SCALING_PROPERTIES.positioning);

		applyCrtEffect();
		return;
	}

	// MOBILE SCALING: Use wrapper scaling for mobile devices (but not when in fullscreen/kiosk mode)
	if (
		(scale < 1.0 || (isKioskMode && !isKioskLike))
    && !isMobileSafariKiosk
    && !isKioskLike
	) {
		/*
     * MOBILE SCALING (Wrapper Scaling)
     *
     * This path is used for regular mobile browsing (NOT fullscreen/kiosk modes).
     * Why scale the wrapper instead of mainContainer?
     * - For mobile devices where content is larger than viewport, we need to scale the entire layout
     * - The wrapper (#divTwc) contains both the main content AND the bottom navigation bar
     * - Scaling the wrapper ensures both elements are scaled together as a unit
     * - Content aligns to top-left for typical mobile web browsing behavior (no centering)
     * - Uses explicit dimensions to prevent layout issues and eliminate gaps after scaling
     */

		// Reset any container/mainContainer styles that might have been set during fullscreen/kiosk mode
		const container = document.querySelector('#container');
		clearElementStyles(container, SCALING_PROPERTIES.positioning);
		clearElementStyles(mainContainer, SCALING_PROPERTIES.positioning);

		wrapper.style.setProperty('transform', `scale(${scale})`);
		wrapper.style.setProperty('transform-origin', 'top left'); // Scale from top-left corner

		// Set explicit dimensions to prevent layout issues on mobile
		const wrapperWidth = settings.wide.value ? 854 : 640;
		// Calculate total height: main content (480px) + bottom navigation bar
		const bottomBar = document.querySelector('#divTwcBottom');
		const bottomBarHeight = bottomBar ? bottomBar.offsetHeight : 40; // fallback to ~40px
		const totalHeight = 480 + bottomBarHeight;
		const scaledHeight = totalHeight * scale; // Height after scaling

		wrapper.style.setProperty('width', `${wrapperWidth}px`);
		wrapper.style.setProperty('height', `${scaledHeight}px`); // Use scaled height to eliminate gap under #divTwc on index page
		applyCrtEffect();
		return;
	}

	// KIOSK/FULLSCREEN SCALING: Two different positioning approaches for different platforms
	const wrapperWidth = settings.wide.value ? 854 : 640;
	const wrapperHeight = 480;

	// Reset wrapper styles to avoid double scaling (wrapper remains unstyled)
	clearElementStyles(wrapper, SCALING_PROPERTIES.wrapper);

	// Platform-specific positioning logic
	let transformOrigin;
	let leftPosition;
	let topPosition;
	let marginLeft;
	let marginTop;

	if (isMobileSafariKiosk) {
		/*
     * MOBILE SAFARI KIOSK MODE (Manual offset calculation)
     *
     * Why this approach?
     * - Mobile Safari in kiosk mode has unique viewport behaviors that don't work well with standard CSS centering
     * - We want orientation-specific centering: vertical in portrait, horizontal in landscape
     * - The standard CSS centering method can cause layout issues in Mobile Safari's constrained environment
     */
		const scaledWidth = wrapperWidth * scale;
		const scaledHeight = wrapperHeight * scale;

		// Determine if we're in portrait or landscape
		const isPortrait = window.innerHeight > window.innerWidth;

		let offsetX = 0;
		let offsetY = 0;

		if (isPortrait) {
			offsetY = (window.innerHeight - scaledHeight) / 2; // center vertically, align to left edge
		} else {
			offsetX = (window.innerWidth - scaledWidth) / 2; // center horizontally, align to top edge
		}

		if (debugFlag('fullscreen')) {
			console.log(
				`📱 Mobile Safari kiosk centering: ${
					isPortrait ? 'portrait' : 'landscape'
				} wrapper=${wrapperWidth}x${wrapperHeight} scale=${scale.toFixed(
					3,
				)} offset=${offsetX.toFixed(1)},${offsetY.toFixed(1)}`,
			);
		}

		// Set positioning values for manual offset calculation
		transformOrigin = 'top left'; // Scale from top-left corner
		leftPosition = `${offsetX}px`; // Exact pixel positioning
		topPosition = `${offsetY}px`; // Exact pixel positioning
		marginLeft = null; // Clear any previous centering margins
		marginTop = null; // Clear any previous centering margins
	} else {
		/*
     * STANDARD FULLSCREEN/KIOSK MODE (CSS-based Centering)
     *
     * Why this approach?
     * - Should work reliably across all other browsers and scenarios (desktop, non-Safari mobile, etc.)
     * - Uses standard CSS centering techniques that browsers handle efficiently
     * - Always centers both horizontally and vertically
     */
		const scaledWidth = wrapperWidth * scale;
		const scaledHeight = wrapperHeight * scale;
		const offsetX = (window.innerWidth - scaledWidth) / 2;
		const offsetY = (window.innerHeight - scaledHeight) / 2;

		if (debugFlag('fullscreen')) {
			console.log(
				`🖥️ Applying fullscreen/kiosk scaling: wrapper=${wrapperWidth}x${wrapperHeight} scale=${scale.toFixed(
					3,
				)} offset=${offsetX.toFixed(1)},${offsetY.toFixed(1)} target=${
					isFullscreen ? '#container' : '#divTwcMain'
				}`,
			);
		}

		// Set positioning values for CSS-based centering
		transformOrigin = 'center center'; // Scale from center point
		leftPosition = '50%'; // Position at 50% from left
		topPosition = '50%'; // Position at 50% from top
		marginLeft = `-${wrapperWidth / 2}px`; // Pull back by half width
		marginTop = `-${wrapperHeight / 2}px`; // Pull back by half height
	}

	// Chrome fullscreen compatibility: apply transform to #container instead of #divTwcMain
	// This works around Chrome's restriction on styling fullscreen elements directly
	const container = document.querySelector('#container');
	const targetElement = isFullscreen ? container : mainContainer;

	// Reset the other element's styles to avoid conflicts
	if (isFullscreen) {
		// Reset mainContainer styles when using container for fullscreen
		clearElementStyles(mainContainer, SCALING_PROPERTIES.positioning);
	} else {
		// Reset container styles when using mainContainer for kiosk mode
		clearElementStyles(container, SCALING_PROPERTIES.positioning);
	}

	// Apply shared properties to the target element
	targetElement.style.setProperty('transform', `scale(${scale})`, 'important');
	targetElement.style.setProperty(
		'transform-origin',
		transformOrigin,
		'important',
	);
	// the width of the target element does not change it is the fixed width of the 4:3 display which is then scaled
	// the wrapper adds margins and padding to achieve widescreen
	// targetElement.style.setProperty('width', `${wrapperWidth}px`, 'important');
	targetElement.style.setProperty('height', `${wrapperHeight}px`, 'important');
	targetElement.style.setProperty('position', 'absolute', 'important');
	targetElement.style.setProperty('left', leftPosition, 'important');
	targetElement.style.setProperty('top', topPosition, 'important');

	// Apply or clear margin properties based on positioning method
	if (marginLeft !== null) {
		targetElement.style.setProperty('margin-left', marginLeft, 'important');
	} else {
		targetElement.style.removeProperty('margin-left');
	}
	if (marginTop !== null) {
		targetElement.style.setProperty('margin-top', marginTop, 'important');
	} else {
		targetElement.style.removeProperty('margin-top');
	}

	applyCrtEffect();
};

// reset all statuses to loading on all displays, used to keep the progress bar accurate during refresh
const resetStatuses = () => {
	displays.forEach((display) => {
		if (!display) return;
		display.status = STATUS.loading;
	});
};

// Apply CRT barrel distortion effect based on strength setting
const applyCrtEffect = () => {
	const strength = parseInt(settings?.crtStrength?.value || '50', 10);
	const mainContainer = document.querySelector('#divTwcMain');
	const container = document.querySelector('#container');

	if (!mainContainer || !container) {
		return;
	}

	// Determine if we're in fullscreen mode
	const isFullscreen = !!document.fullscreenElement;

	// Set CSS custom property for barrel distortion strength
	// 0% = no distortion, 100% = maximum distortion
	const distortionScale = strength / 100;

	// Apply CRT effect to the element that's being scaled/transformed
	// In fullscreen mode, apply to #container (which gets the transform)
	// In normal mode, apply to #divTwcMain
	if (isFullscreen) {
		// Apply to container in fullscreen
		container.style.setProperty('--crt-distortion', distortionScale);
		container.setAttribute('data-crt-strength', strength);
		// Remove from mainContainer to avoid double filtering
		mainContainer.style.removeProperty('--crt-distortion');
		mainContainer.removeAttribute('data-crt-strength');
	} else {
		// Apply to mainContainer in normal mode
		mainContainer.style.setProperty('--crt-distortion', distortionScale);
		mainContainer.setAttribute('data-crt-strength', strength);
		// Remove from container to avoid double filtering
		container.style.removeProperty('--crt-distortion');
		container.removeAttribute('data-crt-strength');
	}

	// Integrate scanlines: enable when CRT effect is active (strength > 0)
	if (strength > 0) {
		container.classList.add('scanlines');
	} else {
		container.classList.remove('scanlines');
	}

	if (debugFlag('crt')) {
		console.log(
			`📺 CRT Effect: ${strength}% strength (distortion scale: ${distortionScale.toFixed(
				2,
			)}), scanlines: ${strength > 0 ? 'ON' : 'OFF'}`,
		);
	}
};

// Make applyCrtEffect available for direct calls from Settings
window.applyCrtEffect = applyCrtEffect;

// allow displays to register themselves
const registerDisplay = (display) => {
	if (displays[display.navId]) console.warn(`Display nav ID ${display.navId} already in use`);
	resolveDisplayEnabledState(display);
	displays[display.navId] = display;

	// generate checkboxes
	generateCheckboxes();
};

const unregisterDisplay = (display) => {
	if (!display) return;
	if (displays[display.navId] && displays[display.navId] !== display) {
		console.warn(`Display nav ID ${display.navId} mismatch on unregister`);
	}
	delete displays[display.navId];
	trimDisplayTail();
	generateCheckboxes();
};

const getDisplays = () => displays.filter((display) => display);

const generateCheckboxes = () => {
	const availableDisplays = document.querySelector('#enabledDisplays');

	if (!availableDisplays) return;
	// generate checkboxes
	const checkboxes = getDisplays()
		.map((display) => display.generateCheckbox(display.defaultEnabled))
		.filter((checkbox) => checkbox);

	// write to page
	availableDisplays.innerHTML = '';
	availableDisplays.append(...checkboxes);
	try {
		document.dispatchEvent(
			new CustomEvent('ws4kp:displays-changed', {
				detail: { count: checkboxes.length },
			}),
		);
	} catch (error) {
		console.error('Failed to dispatch displays-changed event', error);
	}
};

// special registration method for progress display
const registerProgress = (_progress) => {
	progress = _progress;
};

const setTextContent = (selector, value) => {
	const element = document.querySelector(selector);
	if (!element) return;
	// Using textContent avoids injecting markup and handles undefined values gracefully
	element.textContent = value ?? '';
};

const populateWeatherParameters = (params, point) => {
	setTextContent('#spanCity', params.city ? `${params.city}, ` : '');
	setTextContent('#spanState', params.state);
	setTextContent('#spanStationId', params.stationId);
	setTextContent('#spanRadarId', params.radarId);
	setTextContent('#spanZoneId', params.zoneId);
	setTextContent('#spanOfficeId', point?.cwa);
	if (Number.isFinite(point?.gridX) && Number.isFinite(point?.gridY)) {
		setTextContent('#spanGridPoint', `${point.gridX},${point.gridY}`);
	} else {
		setTextContent('#spanGridPoint', '');
	}
};

const latLonReceived = (data, haveDataCallback) => {
	getWeather(data, haveDataCallback);
};

const timeZone = () => weatherParameters.timeZone;

export {
	updateStatus,
	displayNavMessage,
	resetStatuses,
	hideAllCanvases,
	isPlaying,
	resize,
	registerDisplay,
	unregisterDisplay,
	registerProgress,
	currentDisplay,
	getDisplay,
	getDisplays,
	msg,
	message,
	latLonReceived,
	timeZone,
	isIOS,
};
