const createKeyboardController = ({
	onMove,
	onAdjust,
	onActivate,
	onSwapColumn,
	onEscape,
	getActiveColumn,
} = {}) => {
	let active = false;

	const handleKeydown = (event) => {
		if (!active) return;
		if (event.defaultPrevented) return;

		const column = getActiveColumn?.() ?? 'items';
		switch (event.key) {
			case 'ArrowUp':
			case 'PageUp':
				event.preventDefault();
				onMove?.(-1);
				break;
			case 'ArrowDown':
			case 'PageDown':
				event.preventDefault();
				onMove?.(1);
				break;
			case 'ArrowLeft':
				event.preventDefault();
				onAdjust?.('decrement', column);
				break;
			case 'ArrowRight':
				event.preventDefault();
				onAdjust?.('increment', column);
				break;
			case 'Tab':
				event.preventDefault();
				onSwapColumn?.(event.shiftKey ? 'previous' : 'next');
				break;
			case 'Enter':
			case ' ': {
				event.preventDefault();
				onActivate?.(column);
				break;
			}
			case 'Escape':
				event.preventDefault();
				onEscape?.();
				break;
			default:
		}
	};

	const activate = () => {
		if (active) return;
		active = true;
		document.addEventListener('keydown', handleKeydown, true);
	};

	const deactivate = () => {
		if (!active) return;
		active = false;
		document.removeEventListener('keydown', handleKeydown, true);
	};

	return {
		activate,
		deactivate,
	};
};

export default createKeyboardController;
