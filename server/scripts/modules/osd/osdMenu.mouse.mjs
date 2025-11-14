const resolveRow = (target) => {
	if (!target) return null;
	if (target.dataset?.osdColumn) return target;
	return target.closest('[data-osd-column]');
};

const createMouseController = ({
	root,
	onFocus,
	onActivate,
	onAdjust,
	onPaginate,
}) => {
	if (!root) throw new Error('OSD menu root element missing for mouse controller.');
	let active = false;

	const handlePointerMove = (event) => {
		if (!active) return;
		const row = resolveRow(event.target);
		if (!row) return;
		const column = row.dataset.osdColumn;
		if (column === 'categories') return;
		const index = Number.parseInt(row.dataset.osdIndex, 10);
		if (Number.isNaN(index)) return;
		onFocus?.(column, index);
	};

	const handleClick = (event) => {
		if (!active) return;

		// Handle pagination buttons
		const paginationAction = event.target?.dataset?.osdPaginationAction;
		if (paginationAction) {
			event.preventDefault();
			event.stopPropagation();
			onPaginate?.(paginationAction === 'next' ? 1 : -1);
			return;
		}

		const control = event.target?.dataset?.osdControl;
		if (control) {
			event.preventDefault();
			event.stopPropagation();
			const row = resolveRow(event.target);
			if (!row) return;
			const column = row.dataset.osdColumn;
			const index = Number.parseInt(row.dataset.osdIndex, 10);
			if (Number.isNaN(index)) return;
			if (control === 'toggle') {
				if (row.dataset.disabled === 'true') return;
				onActivate?.(column, index);
				return;
			}
			onAdjust?.(
				control === 'increment' ? 'increment' : 'decrement',
				column,
				index,
			);
			return;
		}

		const row = resolveRow(event.target);
		if (!row) return;
		const column = row.dataset.osdColumn;
		const index = Number.parseInt(row.dataset.osdIndex, 10);
		if (Number.isNaN(index)) return;
		if (row.dataset.disabled === 'true') return;
		event.preventDefault();
		onActivate?.(column, index);
	};

	const activate = () => {
		if (active) return;
		active = true;
		root.addEventListener('pointermove', handlePointerMove);
		root.addEventListener('click', handleClick);
	};

	const deactivate = () => {
		if (!active) return;
		active = false;
		root.removeEventListener('pointermove', handlePointerMove);
		root.removeEventListener('click', handleClick);
	};

	return {
		activate,
		deactivate,
	};
};

export default createMouseController;
