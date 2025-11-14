/* eslint-disable indent */

const wrapText = (text) => {
  if (text === null || text === undefined) return '';
  return String(text);
};

const createRow = (tag = 'div', className = '') => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
};

const resolveToggleState = (value) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (
    normalized === 'on'
    || normalized === 'enabled'
    || normalized === 'true'
  ) {
    return 'on';
  }
  return 'off';
};

const createOsdMenuView = (root) => {
  if (!root) throw new Error('OSD menu root element not found.');

  const categoriesSlot = root.querySelector('[data-osd-slot="categories"]');
  const itemsSlot = root.querySelector('[data-osd-slot="items"]');
  const paginationSlot = root.querySelector('[data-osd-slot="pagination"]');
  const focusCategories = root.querySelector('[data-osd-focus="categories"]');
  const focusItems = root.querySelector('[data-osd-focus="items"]');
  const legend = root.querySelector('.ws-osd__legend');

  if (!categoriesSlot || !itemsSlot || !focusCategories || !focusItems) {
    throw new Error('OSD menu markup is missing required slots.');
  }

  let categoryRows = [];
  let itemRows = [];
  const itemValueRefs = new Map();
  let paginationState = { pageIndex: 0, pageCount: 0 };

  const setOpen = (open) => {
    root.dataset.osdState = open ? 'open' : 'closed';
    root.setAttribute('aria-hidden', open ? 'false' : 'true');
  };

  const updateRowFocusState = (rows, activeIndex) => {
    (rows || []).forEach((row, index) => {
      row.dataset.focused = index === activeIndex ? 'true' : 'false';
    });
  };

  const hideFocusForColumn = (column) => {
    const rows = column === 'categories' ? categoryRows : itemRows;
    const focusEl = column === 'categories' ? focusCategories : focusItems;
    focusEl.setAttribute('data-visible', 'false');
    focusEl.style.top = '0px';
    focusEl.style.height = '0px';
    updateRowFocusState(rows, -1);
  };

  const clearFocus = (column) => {
    if (column === 'categories' || column === 'items') {
      hideFocusForColumn(column);
      return;
    }
    hideFocusForColumn('categories');
    hideFocusForColumn('items');
  };

  const updateFocus = (column, index, isActive = true) => {
    const rows = column === 'categories' ? categoryRows : itemRows;
    const focusEl = column === 'categories' ? focusCategories : focusItems;
    if (
      !rows
      || !rows.length
      || !isActive
      || index === null
      || index === undefined
      || index < 0
      || index >= rows.length
    ) {
      hideFocusForColumn(column);
      return;
    }
    const row = rows[index];
    const parent = row.parentElement;
    const offset = row.offsetTop - (parent?.scrollTop ?? 0);
    focusEl.style.top = `${offset}px`;
    focusEl.style.height = `${row.offsetHeight}px`;
    focusEl.setAttribute('data-visible', 'true');
    updateRowFocusState(rows, index);
    if (typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };

  const renderCategories = (categories, activeCategoryId) => {
    categoriesSlot.innerHTML = '';
    categoryRows = (categories || [])
      .filter((cat) => cat && cat.id)
      .map((category, index) => {
        const row = createRow('div', 'ws-osd__row');
        row.dataset.osdColumn = 'categories';
        row.dataset.osdIndex = String(index);
        row.dataset.categoryId = category.id;
        row.setAttribute('role', 'option');
        row.textContent = wrapText(
          category.title ?? category.label ?? category.id,
        );
        row.setAttribute(
          'aria-selected',
          category.id === activeCategoryId ? 'true' : 'false',
        );
        row.dataset.focused = 'false';
        categoriesSlot.append(row);
        return row;
      });
    if (legend) legend.hidden = categoryRows.length === 0;
  };

  const buildAdjustControls = (item) => {
    const wrapper = createRow('div', 'ws-osd__value-controls');
    const prev = createRow('button', 'ws-osd__value-button');
    prev.type = 'button';
    prev.dataset.osdControl = 'decrement';
    prev.textContent = '‹';

    const text = createRow('span', 'ws-osd__value-text');
    text.textContent = wrapText(item.displayValue);

    const next = createRow('button', 'ws-osd__value-button');
    next.type = 'button';
    next.dataset.osdControl = 'increment';
    next.textContent = '›';

    wrapper.append(prev, text, next);
    return { wrapper, text }; // return both elements
  };

  const buildToggleControls = (item) => {
    const wrapper = createRow('button', 'ws-osd__toggle');
    wrapper.type = 'button';
    wrapper.dataset.osdControl = 'toggle';
    wrapper.dataset.state = resolveToggleState(item.displayValue);
    wrapper.setAttribute('aria-label', `${item.label}: ${item.displayValue}`);
    wrapper.setAttribute('role', 'checkbox');
    wrapper.setAttribute(
      'aria-checked',
      resolveToggleState(item.displayValue) === 'on' ? 'true' : 'false',
    );

    return { wrapper, text: null, indicator: wrapper };
  };

  const renderItems = (items, { offset = 0 } = {}) => {
    itemsSlot.innerHTML = '';
    itemValueRefs.clear();
    itemRows = [];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item && item.id) {
        const row = createRow('div', 'ws-osd__row');
        row.dataset.osdColumn = 'items';
        row.dataset.osdIndex = String(offset + index);
        row.dataset.osdRelativeIndex = String(index);
        row.dataset.itemId = item.id;
        row.dataset.itemType = item.type;
        if (item.disabled) {
          row.dataset.disabled = 'true';
          row.setAttribute('aria-disabled', 'true');
        } else {
          row.dataset.disabled = 'false';
          row.removeAttribute('aria-disabled');
        }
        row.setAttribute('role', 'option');
        row.dataset.focused = 'false';

        const label = createRow('div', 'ws-osd__row-label');
        label.textContent = wrapText(item.label);

        const valueCell = createRow('div', 'ws-osd__row-value');
        let valueRef;

        let indicator = null;

        if (item.type === 'action') {
          valueRef = createRow('span', 'ws-osd__value-text');
          valueRef.textContent = item.displayValue ?? 'ENTER';
          valueCell.append(valueRef);
        } else if (item.type === 'toggle') {
          const controls = buildToggleControls(item);
          valueRef = controls.text;
          indicator = controls.indicator;
          valueCell.append(controls.wrapper);
        } else if (item.type === 'enum' || item.type === 'number') {
          const { wrapper, text } = buildAdjustControls(item);
          valueRef = text;
          valueCell.append(wrapper);
        } else {
          valueRef = createRow('span', 'ws-osd__value-text');
          valueRef.textContent = wrapText(item.displayValue);
          valueCell.append(valueRef);
        }

        itemValueRefs.set(item.id, {
          element: valueRef,
          indicator,
          type: item.type,
        });

        row.append(label, valueCell);
        itemsSlot.append(row);
        itemRows.push(row);
      }
    }

    if (paginationSlot) {
      if (paginationState.pageCount > 1) {
        paginationSlot.textContent = `PAGE ${
          paginationState.pageIndex + 1
        } OF ${paginationState.pageCount}`;
        paginationSlot.removeAttribute('aria-hidden');
      } else {
        paginationSlot.textContent = '';
        paginationSlot.setAttribute('aria-hidden', 'true');
      }
    }
  };

  const updateCategorySelection = (categoryId) => {
    categoryRows.forEach((row) => {
      const isSelected = row.dataset.categoryId === categoryId;
      row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      row.dataset.selected = isSelected ? 'true' : 'false';
    });
  };

  const updateItemDisplay = (item) => {
    const entry = itemValueRefs.get(item.id);
    if (!entry) return;
    if (entry.indicator && entry.type === 'toggle') {
      const state = resolveToggleState(item.displayValue);
      entry.indicator.dataset.state = state;
      entry.indicator.setAttribute(
        'aria-checked',
        state === 'on' ? 'true' : 'false',
      );
      entry.indicator.setAttribute(
        'aria-label',
        `${item.label}: ${item.displayValue}`,
      );
    } else if (entry.element) {
      entry.element.textContent = wrapText(item.displayValue);
    }
    const row = itemRows.find((r) => r.dataset.itemId === item.id);
    if (row) {
      if (item.disabled) {
        row.dataset.disabled = 'true';
        row.setAttribute('aria-disabled', 'true');
      } else {
        row.dataset.disabled = 'false';
        row.removeAttribute('aria-disabled');
      }
    }
  };

  const getRow = (column, index) => {
    const rows = column === 'categories' ? categoryRows : itemRows;
    return rows[index] ?? null;
  };

  const getRowById = (column, id) => {
    const rows = column === 'categories' ? categoryRows : itemRows;
    return (
      rows.find((row) => (column === 'categories'
          ? row.dataset.categoryId === id
          : row.dataset.itemId === id)) ?? null
    );
  };

  const updateItems = (items, options) => {
    renderItems(items, options);
  };

  const updatePagination = (pageIndex, pageCount) => {
    paginationState = { pageIndex, pageCount };
    if (!paginationSlot) return;

    if (pageCount > 1) {
      paginationSlot.innerHTML = '';

      // Create previous button
      const prevButton = createRow('button', 'ws-osd__pagination-btn');
      prevButton.type = 'button';
      prevButton.textContent = '‹';
      prevButton.dataset.osdPaginationAction = 'prev';
      prevButton.disabled = pageIndex === 0;
      prevButton.setAttribute('aria-label', 'Previous page');

      // Create page text
      const pageText = createRow('span', 'ws-osd__pagination-text');
      pageText.textContent = `PAGE ${pageIndex + 1} OF ${pageCount}`;

      // Create next button
      const nextButton = createRow('button', 'ws-osd__pagination-btn');
      nextButton.type = 'button';
      nextButton.textContent = '›';
      nextButton.dataset.osdPaginationAction = 'next';
      nextButton.disabled = pageIndex === pageCount - 1;
      nextButton.setAttribute('aria-label', 'Next page');

      paginationSlot.append(prevButton, pageText, nextButton);
      paginationSlot.removeAttribute('aria-hidden');
    } else {
      paginationSlot.innerHTML = '';
      paginationSlot.setAttribute('aria-hidden', 'true');
    }
  };

  return {
    setOpen,
    clearFocus,
    updateFocus,
    renderCategories,
    renderItems,
    updateCategorySelection,
    updateItemDisplay,
    getRow,
    getRowById,
    updateItems,
    updatePagination,
  };
};

export default createOsdMenuView;

/* eslint-enable indent */
