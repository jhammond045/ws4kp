import {
	getVideoSources,
	addVideoSource,
	updateVideoSource,
	removeVideoSource,
	moveVideoSource,
	subscribeVideoSources,
	defaults as defaultSource,
} from './sources.mjs';
import { detectSourceType, extractYouTubeId } from './detect.mjs';
import { openOsdModal } from '../osd/osdModal.mjs';

const updateTimers = new Map();
const pendingUpdates = new Map();

let currentSources = getVideoSources();

const clampIndex = (index, length) => {
	if (length <= 0) return 0;
	if (index < 0) return 0;
	if (index >= length) return length - 1;
	return index;
};

const cssEscape = (value) => {
	if (typeof value !== 'string') return value;
	if (window.CSS?.escape) return window.CSS.escape(value);
	return value;
};

const scheduleUpdate = (id, patch, { delay = 250, immediate = false } = {}) => {
	if (!pendingUpdates.has(id)) {
		pendingUpdates.set(id, {});
	}
	Object.assign(pendingUpdates.get(id), patch);

	if (immediate) {
		flushUpdate(id);
		return;
	}

	if (updateTimers.has(id)) {
		clearTimeout(updateTimers.get(id));
	}

	const timeout = setTimeout(() => flushUpdate(id), delay);
	updateTimers.set(id, timeout);
};

const flushUpdate = (id) => {
	if (updateTimers.has(id)) {
		clearTimeout(updateTimers.get(id));
		updateTimers.delete(id);
	}
	const patch = pendingUpdates.get(id);
	if (!patch) return;
	pendingUpdates.delete(id);
	updateVideoSource(id, patch);
};

const computeIssues = (source) => {
	const issues = [];
	const trimmedUrl = source.url.trim();
	if (!trimmedUrl) {
		issues.push('URL is required');
	}

	if (source.durationSec < 5) {
		issues.push('Duration must be at least 5 seconds');
	}

	if (source.endAt !== null && source.endAt <= source.startAt) {
		issues.push('End time must be after start time');
	}

	const detected = detectSourceType(source);
	if (
		source.type === 'youtube'
    || (source.type === 'auto' && detected === 'youtube')
	) {
		const id = extractYouTubeId(source.url);
		if (!id) {
			issues.push('Unable to parse YouTube video ID');
		}
	}

	if (source.type === 'hls' || (source.type === 'auto' && detected === 'hls')) {
		if (!trimmedUrl.toLowerCase().includes('.m3u8')) {
			issues.push('HLS streams should end with .m3u8');
		}
	}

	return issues;
};

const renderTextField = (
	state,
	source,
	label,
	key,
	type,
	{ placeholder = '', span: spanSize, maxlength } = {},
) => {
	const wrapper = document.createElement('label');
	wrapper.className = 'video-field';
	wrapper.dataset.fieldKey = key;
	if (spanSize) wrapper.dataset.span = spanSize;

	const labelElem = document.createElement('span');
	labelElem.className = 'video-field__label';
	labelElem.textContent = label;

	const input = document.createElement('input');
	input.className = 'video-field__input';
	input.type = type;
	input.value = source[key] ?? '';
	input.placeholder = placeholder;
	input.dataset.fieldKey = key;
	input.dataset.fieldType = type;
	input.dataset.sourceId = source.id;
	input.autocomplete = 'off';
	if (maxlength !== undefined) input.maxLength = maxlength;

	input.addEventListener('input', (event) => {
		scheduleUpdate(source.id, { [key]: event.target.value });
	});

	wrapper.append(labelElem, input);
	return wrapper;
};

const renderNumberField = (
	state,
	source,
	label,
	key,
	{
		min = 0, max = 9999, allowNull = false, span: spanSize,
	} = {},
) => {
	const wrapper = document.createElement('label');
	wrapper.className = 'video-field';
	wrapper.dataset.fieldKey = key;
	if (spanSize) wrapper.dataset.span = spanSize;

	const labelElem = document.createElement('span');
	labelElem.className = 'video-field__label';
	labelElem.textContent = label;

	const input = document.createElement('input');
	input.className = 'video-field__input';
	input.type = 'number';
	if (!allowNull || source[key] !== null) input.value = source[key] ?? '';
	input.min = min;
	input.max = max;
	input.dataset.fieldKey = key;
	input.dataset.fieldType = 'number';
	input.dataset.sourceId = source.id;
	input.autocomplete = 'off';

	input.addEventListener('change', (event) => {
		const { value } = event.target;
		let parsed;
		if (allowNull && value === '') {
			parsed = null;
		} else {
			parsed = Number(value);
			if (Number.isNaN(parsed)) {
				parsed = source[key];
			}
		}
		scheduleUpdate(source.id, { [key]: parsed }, { immediate: true });
	});

	wrapper.append(labelElem, input);
	return wrapper;
};

const renderCheckboxField = (
	state,
	source,
	label,
	key,
	{ span: spanSize } = {},
) => {
	const wrapper = document.createElement('label');
	wrapper.className = 'video-field video-field--checkbox';
	wrapper.dataset.fieldKey = key;
	if (spanSize) wrapper.dataset.span = spanSize;

	const input = document.createElement('input');
	input.type = 'checkbox';
	input.checked = !!source[key];
	input.dataset.fieldKey = key;
	input.dataset.fieldType = 'checkbox';
	input.dataset.sourceId = source.id;

	input.addEventListener('change', (event) => {
		scheduleUpdate(
			source.id,
			{ [key]: event.target.checked },
			{ immediate: true },
		);
	});

	const labelElem = document.createElement('span');
	labelElem.textContent = label;

	wrapper.append(input, labelElem);
	return wrapper;
};

const captureActiveFieldState = (state) => {
	if (!state?.deckElement) return null;
	const active = document.activeElement;
	if (!active || !(active instanceof HTMLElement)) return null;
	if (!state.deckElement.contains(active)) return null;
	const card = active.closest('[data-id]');
	if (!card) return null;
	const selectionSupported = typeof active.selectionStart === 'number'
    && typeof active.selectionEnd === 'number';
	return {
		sourceId: card.dataset.id,
		fieldKey: active.dataset?.fieldKey ?? null,
		selectionStart: selectionSupported ? active.selectionStart : null,
		selectionEnd: selectionSupported ? active.selectionEnd : null,
	};
};

const restoreActiveFieldState = (state, saved) => {
	if (!state?.deckElement || !saved?.sourceId) return false;
	const card = state.deckElement.querySelector(
		`[data-id="${cssEscape(saved.sourceId)}"]`,
	);
	if (!card) return false;
	let target = null;
	if (saved.fieldKey) {
		target = card.querySelector(
			`[data-field-key="${cssEscape(saved.fieldKey)}"]`,
		);
	}
	if (!target) {
		target = card.querySelector('input, select, textarea, button');
	}
	if (!(target instanceof HTMLElement)) return false;
	requestAnimationFrame(() => {
		try {
			target.focus({ preventScroll: true });
			if (
				saved.selectionStart !== null
        && saved.selectionStart !== undefined
        && typeof target.setSelectionRange === 'function'
			) {
				target.setSelectionRange(
					saved.selectionStart,
					saved.selectionEnd ?? saved.selectionStart,
				);
			}
		} catch (_error) {
			// ignore focus errors
		}
	});
	return true;
};

const focusCard = (state, id) => {
	if (!state?.root || !id) return;
	const selector = `[data-id="${cssEscape(id)}"]`;
	const card = state.root.querySelector(selector);
	if (!card) return;
	card.scrollIntoView({ block: 'nearest' });
	const focusTarget = card.querySelector('input, select, textarea, button');
	if (focusTarget instanceof HTMLElement) {
		requestAnimationFrame(() => {
			try {
				focusTarget.focus({ preventScroll: true });
				if (
					focusTarget instanceof HTMLInputElement
          && ['text', 'url', 'number'].includes(focusTarget.type)
				) {
					focusTarget.select();
				}
			} catch (_error) {
				// ignore focus errors
			}
		});
	}
};

const renderSourceCard = (state, source, index) => {
	const container = document.createElement('article');
	container.className = 'settings-video__item';
	container.dataset.id = source.id;

	const header = document.createElement('div');
	header.className = 'settings-video__item-header';

	const title = document.createElement('div');
	title.className = 'settings-video__item-title';
	title.textContent = source.title || 'Untitled Video';

	const controls = document.createElement('div');
	controls.className = 'settings-video__item-controls';

	const upButton = document.createElement('button');
	upButton.type = 'button';
	upButton.className = 'settings-video__btn settings-video__btn--icon';
	upButton.title = 'Move up';
	upButton.disabled = index === 0;
	upButton.innerHTML = '↑';
	upButton.addEventListener('click', () => moveVideoSource(source.id, index - 1));

	const downButton = document.createElement('button');
	downButton.type = 'button';
	downButton.className = 'settings-video__btn settings-video__btn--icon';
	downButton.title = 'Move down';
	downButton.disabled = index === currentSources.length - 1;
	downButton.innerHTML = '↓';
	downButton.addEventListener('click', () => moveVideoSource(source.id, index + 1));

	controls.append(upButton, downButton);
	header.append(title, controls);

	const body = document.createElement('div');
	body.className = 'settings-video__item-body';

	body.append(
		renderTextField(state, source, 'Title', 'title', 'text', {
			placeholder: 'Display title',
			span: 'quarter',
			maxlength: 16,
		}),
		renderTextField(state, source, 'URL', 'url', 'url', {
			placeholder: 'https://…',
			span: 'three-quarters',
		}),
		renderNumberField(state, source, 'Duration (sec)', 'durationSec', {
			min: 5,
			max: 3600,
			span: 'half',
		}),
		renderCheckboxField(state, source, 'Muted', 'muted', {
			span: 'quarter',
		}),
		renderCheckboxField(state, source, 'Loop', 'loop', {
			span: 'quarter',
		}),
	);

	const issues = computeIssues(source);

	const footer = document.createElement('div');
	footer.className = 'settings-video__item-footer';

	if (issues.length > 0) {
		const issueList = document.createElement('ul');
		issueList.className = 'settings-video__issues';
		issues.forEach((message) => {
			const li = document.createElement('li');
			li.textContent = `• ${message}`;
			issueList.append(li);
		});
		footer.append(issueList);
	}

	container.append(header, body, footer);

	return container;
};

const updateControls = (state) => {
	if (!state) return;
	const count = currentSources.length;
	const hasVideos = count > 0;

	if (state.prevButton) {
		state.prevButton.disabled = !hasVideos || state.currentIndex <= 0;
	}

	if (state.nextButton) {
		state.nextButton.disabled = !hasVideos || state.currentIndex >= count - 1;
	}

	if (state.removeButton) {
		state.removeButton.disabled = !hasVideos;
		state.removeButton.textContent = '[ REMOVE ]';
	}

	if (state.addButton) {
		state.addButton.disabled = false;
	}

	if (state.counterElement) {
		state.counterElement.textContent = hasVideos
			? `VIDEO ${state.currentIndex + 1} OF ${count}`
			: 'NO VIDEOS';
	}

	if (state.deckElement) {
		state.deckElement.style.display = hasVideos ? 'block' : 'none';
	}

	if (state.emptyStateElement) {
		state.emptyStateElement.style.display = hasVideos ? 'none' : 'block';
	}
};

const renderDeck = (state) => {
	if (!state?.deckElement) return;
	const count = currentSources.length;
	if (count > 0) {
		state.currentIndex = clampIndex(state.currentIndex ?? 0, count);
		state.deckElement.innerHTML = '';
		const source = currentSources[state.currentIndex];
		state.deckElement.append(
			renderSourceCard(state, source, state.currentIndex),
		);
	} else {
		state.deckElement.innerHTML = '';
	}

	updateControls(state);

	const focusId = state.pendingFocusId || state.targetVideoId;
	if (focusId) {
		requestAnimationFrame(() => focusCard(state, focusId));
		state.pendingFocusId = null;
		state.targetVideoId = null;
	}
};

const buildModalBody = (state) => {
	const wrapper = document.createElement('div');
	wrapper.className = 'ws-osd-video-modal';

	const emptyStateElement = document.createElement('p');
	emptyStateElement.className = 'settings-video__empty';
	emptyStateElement.textContent = 'No videos configured yet. Use ADD to begin.';

	const deckElement = document.createElement('div');
	deckElement.className = 'settings-video__deck';

	const controls = document.createElement('div');
	controls.className = 'settings-video__controls';

	const navGroup = document.createElement('div');
	navGroup.className = 'settings-video__controls-group';

	const manageGroup = document.createElement('div');
	manageGroup.className = 'settings-video__controls-group';

	const prevButton = document.createElement('button');
	prevButton.type = 'button';
	prevButton.className = 'settings-video__btn settings-video__btn--deck';
	prevButton.textContent = '[ PREV ]';

	const nextButton = document.createElement('button');
	nextButton.type = 'button';
	nextButton.className = 'settings-video__btn settings-video__btn--deck';
	nextButton.textContent = '[ NEXT ]';

	const counterElement = document.createElement('span');
	counterElement.className = 'settings-video__counter';
	counterElement.textContent = 'NO VIDEOS';

	const addButton = document.createElement('button');
	addButton.type = 'button';
	addButton.className = 'settings-video__btn settings-video__btn--deck';
	addButton.textContent = '[ ADD ]';

	const removeButton = document.createElement('button');
	removeButton.type = 'button';
	removeButton.className = 'settings-video__btn settings-video__btn--deck settings-video__btn--danger';
	removeButton.textContent = '[ REMOVE ]';

	navGroup.append(prevButton, nextButton);
	manageGroup.append(addButton, removeButton);
	controls.append(navGroup, counterElement, manageGroup);
	wrapper.append(emptyStateElement, deckElement, controls);

	state.root = wrapper;
	state.emptyStateElement = emptyStateElement;
	state.deckElement = deckElement;
	state.controlsElement = controls;
	state.prevButton = prevButton;
	state.nextButton = nextButton;
	state.addButton = addButton;
	state.removeButton = removeButton;
	state.counterElement = counterElement;

	return wrapper;
};

const handleAddClick = (state) => {
	const baseTitle = 'Untitled Video';
	const existing = getVideoSources();
	let suffix = existing.length + 1;
	let candidateTitle = `${baseTitle} ${suffix}`;
	const existingTitles = new Set(existing.map((source) => source.title));
	while (existingTitles.has(candidateTitle)) {
		suffix += 1;
		candidateTitle = `${baseTitle} ${suffix}`;
	}

	const newSource = addVideoSource({
		title: candidateTitle,
		url: '',
		durationSec: defaultSource.durationSec,
	});

	if (state) {
		state.pendingFocusId = newSource.id;
		state.targetVideoId = newSource.id;
		state.currentIndex = existing.length; // new item will appear at the end
		renderDeck(state);
	}
};

const handlePrevClick = (state) => {
	if (!state || currentSources.length === 0) return;
	const targetIndex = clampIndex(state.currentIndex - 1, currentSources.length);
	if (targetIndex === state.currentIndex) return;
	state.currentIndex = targetIndex;
	state.pendingFocusId = currentSources[targetIndex]?.id;
	renderDeck(state);
};

const handleNextClick = (state) => {
	if (!state || currentSources.length === 0) return;
	const targetIndex = clampIndex(state.currentIndex + 1, currentSources.length);
	if (targetIndex === state.currentIndex) return;
	state.currentIndex = targetIndex;
	state.pendingFocusId = currentSources[targetIndex]?.id;
	renderDeck(state);
};

const handleRemoveClick = async (state) => {
	if (!state || currentSources.length === 0) return;
	const source = currentSources[state.currentIndex];
	if (!source) return;

	const message = document.createElement('p');
	message.textContent = `Remove "${source.title || 'Untitled Video'}"?`;

	const result = await openOsdModal({
		title: '-------- REMOVE VIDEO --------',
		body: message,
		actions: [
			{ id: 'cancel', label: '[ CANCEL ]', cancel: true },
			{ id: 'confirm', label: '[ REMOVE ]', primary: true },
		],
		autofocus: 'cancel',
	});

	if (result?.action === 'confirm') {
		const removedIndex = state.currentIndex;
		removeVideoSource(source.id);

		// After removal, navigate to previous video or close modal if none remain
		const remainingCount = currentSources.length - 1; // Count after removal

		if (remainingCount === 0) {
			// No videos left - close the modal by importing and calling the close function
			const { closeOsdModal } = await import('../osd/osdModal.mjs');
			closeOsdModal('removed-last');
		} else {
			// Navigate to previous video, or stay at same index if we removed the first one
			const targetIndex = removedIndex > 0 ? removedIndex - 1 : 0;
			state.currentIndex = targetIndex;
			// The subscription handler will re-render the deck
		}
	}
};

const createVideoManager = () => {
	const open = async (targetVideoId = null) => {
		const state = {
			root: null,
			deckElement: null,
			emptyStateElement: null,
			controlsElement: null,
			prevButton: null,
			nextButton: null,
			addButton: null,
			removeButton: null,
			counterElement: null,
			targetVideoId,
			pendingFocusId: null,
			currentIndex: 0,
		};

		currentSources = getVideoSources();
		if (targetVideoId) {
			const initialIndex = currentSources.findIndex(
				(source) => source.id === targetVideoId,
			);
			if (initialIndex >= 0) {
				state.currentIndex = initialIndex;
			}
		}
		state.currentIndex = clampIndex(state.currentIndex, currentSources.length);
		const body = buildModalBody(state);

		if (state.addButton) {
			state.addButton.addEventListener('click', () => handleAddClick(state));
		}
		if (state.prevButton) {
			state.prevButton.addEventListener('click', () => handlePrevClick(state));
		}
		if (state.nextButton) {
			state.nextButton.addEventListener('click', () => handleNextClick(state));
		}
		if (state.removeButton) {
			state.removeButton.addEventListener('click', () => handleRemoveClick(state));
		}

		const unsubscribe = subscribeVideoSources((sources) => {
			const previousSources = currentSources;
			let previousActiveId = null;
			if (previousSources && previousSources.length > 0) {
				previousActiveId = previousSources[state.currentIndex]?.id ?? null;
			}
			const hadExplicitFocusRequest = Boolean(
				state.pendingFocusId || state.targetVideoId,
			);
			let preservedFocus = null;
			if (!hadExplicitFocusRequest) {
				preservedFocus = captureActiveFieldState(state);
			}

			currentSources = sources;

			if (state.pendingFocusId) {
				const focusIndex = sources.findIndex(
					(source) => source.id === state.pendingFocusId,
				);
				if (focusIndex >= 0) {
					state.currentIndex = focusIndex;
				}
			} else if (state.targetVideoId) {
				const targetIndex = sources.findIndex(
					(source) => source.id === state.targetVideoId,
				);
				if (targetIndex >= 0) {
					state.currentIndex = targetIndex;
				}
			} else if (previousActiveId) {
				const maintainedIndex = sources.findIndex(
					(source) => source.id === previousActiveId,
				);
				if (maintainedIndex >= 0) {
					state.currentIndex = maintainedIndex;
				} else {
					state.currentIndex = clampIndex(state.currentIndex, sources.length);
				}
			} else {
				state.currentIndex = clampIndex(state.currentIndex, sources.length);
			}

			renderDeck(state);
			if (!hadExplicitFocusRequest && preservedFocus) {
				const restored = restoreActiveFieldState(state, preservedFocus);
				if (!restored && preservedFocus.sourceId) {
					focusCard(state, preservedFocus.sourceId);
				}
			}
		});

		renderDeck(state);

		const modalResult = await openOsdModal({
			title: '--------- VIDEO SOURCES ---------',
			body,
			actions: [],
		});

		unsubscribe?.();
		return modalResult;
	};

	return { open };
};

const manager = createVideoManager();

export const openVideoManager = (targetVideoId) => manager.open(targetVideoId);

export default manager;
