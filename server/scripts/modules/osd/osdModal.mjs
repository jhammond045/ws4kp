let modalRoot;
let modalPanel;
let modalTitle;
let modalBodySlot;
let modalActionsSlot;
let backdrop;
let closeButton;
let currentConfig = null;
let currentResolve;
let focusedActionIndex = 0;
let actionElements = [];
let previousFocus = null;
let onOpenCallback = () => {};
let onCloseCallback = () => {};
let keydownHandlerBound = false;
let closeHandlerBound = false;
const actionHandlerMap = new WeakMap();

const ensureElements = () => {
	if (modalRoot) return;
	modalRoot = document.getElementById('ws-osd-modal-root');
	if (!modalRoot) {
		throw new Error('OSD modal root element not found.');
	}
	modalPanel = modalRoot.querySelector('.ws-osd-modal__panel');
	modalTitle = modalRoot.querySelector('.ws-osd-modal__title');
	modalBodySlot = modalRoot.querySelector('[data-osd-modal-slot="body"]');
	modalActionsSlot = modalRoot.querySelector('[data-osd-modal-slot="actions"]');
	backdrop = modalRoot.querySelector('.ws-osd-modal__backdrop');
	closeButton = modalRoot.querySelector('.ws-osd-modal__close-btn');
	if (
		!modalPanel
    || !modalTitle
    || !modalBodySlot
    || !modalActionsSlot
    || !backdrop
    || !closeButton
	) {
		throw new Error('OSD modal markup is incomplete.');
	}
};

const clearActions = () => {
	actionElements.forEach((element) => {
		const handler = actionHandlerMap.get(element);
		if (handler) {
			element.removeEventListener('click', handler);
			actionHandlerMap.delete(element);
		}
	});
	modalActionsSlot.innerHTML = '';
	actionElements = [];
};

// a press outside the panel (the backdrop, the menu behind it) would move focus out of the modal (OSD.md 9)
const handleMousedownOutside = (event) => {
	if (modalPanel.contains(event.target)) return;
	event.preventDefault();
};

const detachKeydown = () => {
	if (!keydownHandlerBound) return;
	document.removeEventListener('keydown', handleKeydown, true);
	document.removeEventListener('mousedown', handleMousedownOutside, true);
	keydownHandlerBound = false;
};

const attachKeydown = () => {
	if (keydownHandlerBound) return;
	document.addEventListener('keydown', handleKeydown, true);
	document.addEventListener('mousedown', handleMousedownOutside, true);
	keydownHandlerBound = true;
};

const handleCloseClick = () => {
	const cancelAction = currentConfig?.actions?.find((action) => action.cancel)
    || currentConfig?.actions?.find((action) => action.id === 'cancel');
	if (cancelAction) {
		selectAction(cancelAction.id);
	} else {
		closeOsdModal('cancel');
	}
};

const detachCloseButton = () => {
	if (!closeHandlerBound) return;
	closeButton?.removeEventListener('click', handleCloseClick);
	closeHandlerBound = false;
};

const attachCloseButton = () => {
	if (closeHandlerBound) return;
	closeButton?.addEventListener('click', handleCloseClick);
	closeHandlerBound = true;
};

const handleKeydown = (event) => {
	if (!currentConfig) return;

	const { key } = event;
	if (key === 'Escape') {
		// an open suggestion list (the location box) closes first, the next Escape closes the modal
		if (event.target instanceof HTMLElement && event.target.getAttribute('aria-expanded') === 'true') return;
		event.stopPropagation();
		event.preventDefault();
		const cancelAction = currentConfig.actions?.find((action) => action.cancel)
      || currentConfig.actions?.find((action) => action.id === 'cancel');
		if (cancelAction) {
			selectAction(cancelAction.id);
		} else {
			closeOsdModal('cancel');
		}
		return;
	}

	if (key === 'Tab') {
		event.stopPropagation();
		event.preventDefault();
		moveFocusWithin(event.shiftKey ? -1 : 1);
		return;
	}

	// text boxes keep their own arrow keys and Enter (the location box searches on Enter)
	const inTextBox = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;

	if (['ArrowLeft', 'ArrowRight'].includes(key) && actionElements.length > 1 && !inTextBox) {
		event.stopPropagation();
		event.preventDefault();
		if (key === 'ArrowLeft') {
			focusedActionIndex = (focusedActionIndex - 1 + actionElements.length)
        % actionElements.length;
		} else {
			focusedActionIndex = (focusedActionIndex + 1) % actionElements.length;
		}
		focusActionByIndex(focusedActionIndex);
		return;
	}

	// Enter chooses an action button, or the highlighted one when nothing else has focus
	// other buttons and links get Enter as a click, and text boxes handle it themselves
	if (key === 'Enter') {
		const target = event.target instanceof HTMLElement ? event.target : null;
		const action = actionElements.includes(target)
			? target
			: actionElements[focusedActionIndex];
		const passThrough = !actionElements.includes(target)
			&& target?.closest('button, a[href], input, textarea, select');
		if (passThrough || !action) return;
		event.stopPropagation();
		event.preventDefault();
		selectAction(action.dataset.actionId);
	}
};

// Tab and Shift+Tab cycle through the controls in the open modal and never leave it
const moveFocusWithin = (direction) => {
	const focusable = [...modalPanel.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
		.filter((element) => !element.disabled && element.getClientRects().length > 0);
	if (focusable.length === 0) return;
	const current = focusable.indexOf(document.activeElement);
	let next;
	if (current === -1) {
		next = direction > 0 ? 0 : focusable.length - 1;
	} else {
		next = (current + direction + focusable.length) % focusable.length;
	}
	const element = focusable[next];
	element.focus();
	// only one thing looks focused: an action button loses its highlight while the close button or a field has focus
	// focusedActionIndex is kept, so the arrow keys carry on from the same button
	const actionIndex = actionElements.indexOf(element);
	if (actionIndex >= 0) focusedActionIndex = actionIndex;
	actionElements.forEach((action, i) => action.setAttribute('data-focused', i === actionIndex ? 'true' : 'false'));
};

const focusActionByIndex = (index) => {
	actionElements.forEach((element, i) => {
		const focused = i === index;
		element.setAttribute('data-focused', focused ? 'true' : 'false');
		if (focused) {
			requestAnimationFrame(() => {
				element.focus();
			});
		}
	});
};

const renderBody = (body) => {
	modalBodySlot.innerHTML = '';
	if (body instanceof Node) {
		modalBodySlot.append(body);
		return;
	}

	if (typeof body === 'string') {
		modalBodySlot.innerHTML = body;
		return;
	}

	if (Array.isArray(body)) {
		body.forEach((fragment) => {
			if (fragment instanceof Node) {
				modalBodySlot.append(fragment);
			} else if (typeof fragment === 'string') {
				modalBodySlot.insertAdjacentHTML('beforeend', fragment);
			}
		});
	}
};

const renderActions = (actions = []) => {
	clearActions();
	if (!actions.length) return;
	actions.forEach((action, index) => {
		const element = document.createElement('button');
		element.type = 'button';
		element.className = 'ws-osd-modal__action';
		element.dataset.actionId = action.id ?? `action-${index}`;
		element.textContent = action.label ?? 'OK';
		element.setAttribute('data-primary', action.primary ? 'true' : 'false');
		element.setAttribute('tabindex', '0');
		const handler = () => selectAction(element.dataset.actionId);
		element.addEventListener('click', handler);
		actionHandlerMap.set(element, handler);
		modalActionsSlot.append(element);
		actionElements.push(element);
	});
};

const resolveAndReset = (result) => {
	const resolver = currentResolve;
	currentResolve = undefined;
	if (typeof resolver === 'function') {
		resolver(result);
	}
};

const selectAction = async (actionId) => {
	if (!currentConfig) return;
	const action = currentConfig.actions?.find(
		(item) => (item.id ?? '') === actionId,
	);
	if (!action) {
		closeOsdModal(actionId);
		return;
	}

	let shouldClose = true;
	if (typeof action.onSelect === 'function') {
		try {
			const result = action.onSelect(actionId);
			if (result instanceof Promise) {
				const awaited = await result;
				if (awaited === false) {
					shouldClose = false;
				}
			} else if (result === false) {
				shouldClose = false;
			}
		} catch (error) {
			console.error('OSD modal action handler failed', error);
		}
	}

	if (shouldClose) {
		closeOsdModal(actionId);
	}
};

const openOsdModal = (config) => {
	ensureElements();
	if (!config || typeof config !== 'object') {
		throw new Error('OSD modal requires a configuration object.');
	}

	if (currentConfig) {
		closeOsdModal('replace');
	}

	currentConfig = config;
	modalTitle.textContent = config.title ?? '--------- MODAL ---------';
	renderBody(config.body ?? '');
	renderActions(config.actions ?? []);

	// before the panel takes focus, so closing returns focus to what opened the modal
	// a modal replacing another keeps the first one's
	if (!previousFocus && document.activeElement !== document.body) {
		previousFocus = document.activeElement instanceof HTMLElement
			? document.activeElement
			: null;
	}

	modalRoot.setAttribute('aria-hidden', 'false');
	modalRoot.dataset.osdModalState = 'open';
	modalRoot.style.display = 'flex';
	modalPanel.setAttribute('tabindex', '-1');
	modalPanel.focus({ preventScroll: true });

	onOpenCallback(config);

	if (actionElements.length > 0) {
		const initialIndex = Math.max(
			0,
			actionElements.findIndex(
				(element) => element.dataset.actionId === config.autofocus,
			),
		);
		focusedActionIndex = initialIndex >= 0 ? initialIndex : 0;
		focusActionByIndex(focusedActionIndex);
	} else {
		focusedActionIndex = 0;
	}

	attachKeydown();
	attachCloseButton();

	return new Promise((resolve) => {
		currentResolve = resolve;
	});
};

const closeOsdModal = (result) => {
	if (!currentConfig) return;
	detachKeydown();
	detachCloseButton();
	// focus leaves the modal before it is hidden, it goes back to what opened the modal below
	if (modalRoot.contains(document.activeElement)) document.activeElement.blur();
	modalRoot.setAttribute('aria-hidden', 'true');
	modalRoot.dataset.osdModalState = 'closed';
	modalRoot.style.display = 'none';
	modalPanel.removeAttribute('tabindex');
	onCloseCallback(result, currentConfig);

	// a replacement modal opens straight after, and takes over where focus goes back to
	if (result !== 'replace') {
		const restoreFocus = previousFocus;
		previousFocus = null;
		setTimeout(() => {
			// another modal opened in the meantime (a confirm going back to the video manager), it returns focus later
			if (currentConfig) {
				previousFocus ??= restoreFocus;
				return;
			}
			if (typeof restoreFocus?.focus !== 'function') return;
			try {
				restoreFocus.focus({ preventScroll: true });
			} catch {
				// ignore focus errors
			}
		}, 0);
	}

	const payload = { action: result, config: currentConfig };
	currentConfig = null;
	clearActions();
	modalBodySlot.innerHTML = '';
	resolveAndReset(payload);
};

const initOsdModal = ({ onOpen, onClose } = {}) => {
	onOpenCallback = typeof onOpen === 'function' ? onOpen : () => {};
	onCloseCallback = typeof onClose === 'function' ? onClose : () => {};
	ensureElements();
	modalRoot.setAttribute('aria-hidden', 'true');
	modalRoot.dataset.osdModalState = 'closed';
	modalRoot.style.display = 'none';
};

// the result of a copy to the clipboard, OSD.md 8: confirmations use OSD modals, not toasts
const openCopyResultModal = (copied, failureText = 'Copy failed. Copy it by hand.') => {
	const body = document.createElement('p');
	body.textContent = copied ? 'Copied to clipboard.' : failureText;
	return openOsdModal({
		title: copied ? '--------- COPIED ---------' : '------- COPY FAILED -------',
		body,
		actions: [{ id: 'ok', label: '[ OK ]', primary: true }],
		autofocus: 'ok',
	});
};

export {
	initOsdModal, openOsdModal, closeOsdModal, openCopyResultModal,
};
