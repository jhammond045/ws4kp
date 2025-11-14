import { subscribeVideoSources } from './sources.mjs';
import VideoDisplay from './display.mjs';
import {
	registerDisplay,
	unregisterDisplay,
	currentDisplay,
} from '../navigation.mjs';

const VIDEO_NAV_BASE = 12;
const VIDEO_CONTAINER_CLASS = 'video-display-container';

const displays = new Map();

const getAnchorElement = () => document.querySelector('#almanac-html');

const createContainer = (elemId) => {
	const container = document.createElement('div');
	container.className = `weather-display ${VIDEO_CONTAINER_CLASS}`;
	container.id = `${elemId}-html`;
	container.dataset.videoContainer = 'true';
	return container;
};

const clearExistingDisplays = () => {
	displays.forEach(({ display, container }) => {
		if (currentDisplay() === display) {
			display.hideCanvas();
		}
		display.dispose();
		unregisterDisplay(display);
		if (container?.parentElement) {
			container.parentElement.removeChild(container);
		}
	});
	displays.clear();
};

const buildDisplays = (sources) => {
	const anchor = getAnchorElement();
	if (!anchor) return;

	clearExistingDisplays();

	const parent = anchor.parentElement;
	if (!parent) return;

	sources.forEach((source, index) => {
		const elemId = `video-${source.id}`;
		const navId = VIDEO_NAV_BASE + index;
		const container = createContainer(elemId);
		parent.insertBefore(container, anchor);

		const display = new VideoDisplay(navId, elemId, source);
		displays.set(source.id, { display, container });
		registerDisplay(display);
		display.getData();
	});
};

document.addEventListener('DOMContentLoaded', () => {
	subscribeVideoSources((videoSources) => {
		buildDisplays(videoSources);
	});
});
