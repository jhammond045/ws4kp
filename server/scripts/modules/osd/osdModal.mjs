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

const detachKeydown = () => {
	if (!keydownHandlerBound) return;
	document.removeEventListener('keydown', handleKeydown, true);
	keydownHandlerBound = false;
};

const attachKeydown = () => {
	if (keydownHandlerBound) return;
	document.addEventListener('keydown', handleKeydown, true);
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

	if (['ArrowLeft', 'ArrowRight'].includes(key) && actionElements.length > 1) {
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

	if (key === 'Enter') {
		event.stopPropagation();
		event.preventDefault();
		const action = actionElements[focusedActionIndex];
		if (action) {
			selectAction(action.dataset.actionId);
		}
	}
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
		} catch (_error) {
			console.error('OSD modal action handler failed', _error);
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

	modalRoot.setAttribute('aria-hidden', 'false');
	modalRoot.dataset.osdModalState = 'open';
	modalPanel.setAttribute('tabindex', '-1');
	modalPanel.focus({ preventScroll: true });
	modalRoot.style.display = 'flex';

	previousFocus = document.activeElement instanceof HTMLElement
    	? document.activeElement
    	: null;

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
	modalRoot.setAttribute('aria-hidden', 'true');
	modalRoot.dataset.osdModalState = 'closed';
	modalRoot.style.display = 'none';
	modalPanel.removeAttribute('tabindex');
	onCloseCallback(result, currentConfig);

	setTimeout(() => {
		if (previousFocus && typeof previousFocus.focus === 'function') {
			try {
				previousFocus.focus({ preventScroll: true });
			} catch (_error) {
				// ignore focus errors
			}
		}
		previousFocus = null;
	}, 0);

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

export { initOsdModal, openOsdModal, closeOsdModal };
