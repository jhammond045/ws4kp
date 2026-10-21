import { subscribeVideoSources, isAllowedMediaUrl } from './sources.mjs';
import VideoDisplay from './display.mjs';
import STATUS from '../status.mjs';
import {
	registerDisplay,
	unregisterDisplay,
	currentDisplay,
	getDisplays,
	showDisplay,
	isLocationActive,
} from '../navigation.mjs';

const VIDEO_CONTAINER_CLASS = 'video-display-container';

// source id -> { display, container, source }, in rotation order
let displays = new Map();

const getAnchorElement = () => document.querySelector('#almanac-html');

const createContainer = (elemId) => {
	const container = document.createElement('div');
	container.className = `weather-display ${VIDEO_CONTAINER_CLASS}`;
	container.id = `${elemId}-html`;
	container.dataset.videoContainer = 'true';
	return container;
};

// compare the displays that exist with the sources that should, by id
// reordered is true when the displays that stay, plus the new ones added at the end, aren't in the new order
// exported for tests
// eslint-disable-next-line import-x/prefer-default-export
export const diffSources = (currentIds, nextIds) => {
	const current = new Set(currentIds);
	const next = new Set(nextIds);
	const removed = currentIds.filter((id) => !next.has(id));
	const added = nextIds.filter((id) => !current.has(id));
	const resulting = [...currentIds.filter((id) => next.has(id)), ...added];
	const reordered = resulting.some((id, i) => id !== nextIds[i]);
	return { removed, added, reordered };
};

// after the display on screen was removed, show the next one that can be shown instead of a blank screen
const showNextDisplay = (fromIndex) => {
	const list = getDisplays();
	for (let i = 0; i < list.length; i += 1) {
		const display = list[(fromIndex + i) % list.length];
		if (display.status === STATUS.loaded && display.canShowOnRequest()) {
			showDisplay(display);
			return;
		}
	}
};

const removeDisplay = ({ display, container }) => {
	const showing = currentDisplay() === display;
	display.dispose();
	if (showing) display.hideCanvas();
	unregisterDisplay(display);
	container?.remove();
};

const buildDisplays = (allSources) => {
	const anchor = getAnchorElement();
	const parent = anchor?.parentElement;
	if (!parent) return;

	// a source without a usable URL (such as one just added in the manager) isn't rotated
	const sources = allSources.filter((source) => isAllowedMediaUrl(source.url));
	const { removed, added, reordered } = diffSources([...displays.keys()], sources.map((source) => source.id));

	const current = currentDisplay();
	const currentIndex = getDisplays().indexOf(current);
	const removingCurrent = removed.some((id) => displays.get(id).display === current);

	removed.forEach((id) => {
		removeDisplay(displays.get(id));
		displays.delete(id);
	});

	// title and duration edits update the display in place, other edits reload only that player
	sources.forEach((source) => {
		const entry = displays.get(source.id);
		if (!entry || JSON.stringify(entry.source) === JSON.stringify(source)) return;
		entry.source = source;
		entry.display.updateSource(source);
	});

	added.forEach((id) => {
		const source = sources.find((item) => item.id === id);
		const elemId = `video-${source.id}`;
		const container = createContainer(elemId);
		parent.insertBefore(container, anchor);

		// -1: navigation adds it after the static displays and assigns its nav ID
		const display = new VideoDisplay(-1, elemId, source);
		displays.set(source.id, { display, container, source });
		registerDisplay(display);
		// before a location is entered, startDisplays loads every display, loading here too would count a failure twice
		if (isLocationActive()) display.getData();
	});

	// register again in the new order, the players are kept
	// rotation follows navigation's list, so the containers stay where they are: moving an iframe in the page reloads it
	if (reordered) {
		const ordered = new Map(sources.map((source) => [source.id, displays.get(source.id)]));
		ordered.forEach(({ display }) => {
			unregisterDisplay(display);
			registerDisplay(display);
		});
		displays = ordered;
	}

	if (removingCurrent && !currentDisplay()) showNextDisplay(Math.max(currentIndex, 0));
};

// media pauses while the tab is hidden, and the video on screen resumes when it's shown again
document.addEventListener('visibilitychange', () => {
	displays.forEach(({ display }) => {
		if (document.visibilityState === 'hidden') {
			display.pausePlayback();
		} else if (display.active) {
			display.startPlayback();
		}
	});
});

document.addEventListener('DOMContentLoaded', () => {
	subscribeVideoSources((videoSources) => {
		buildDisplays(videoSources);
	});
});
