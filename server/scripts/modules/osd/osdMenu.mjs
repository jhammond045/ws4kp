import createOsdMenuModel from './osdMenu.model.mjs';
import createOsdMenuView from './osdMenu.view.mjs';
import createKeyboardController from './osdMenu.keyboard.mjs';
import createMouseController from './osdMenu.mouse.mjs';
import { initOsdModal } from './osdModal.mjs';

/* eslint-disable indent, quotes, operator-linebreak */

const LAST_CATEGORY_KEY = "ws.osd.lastCategory";
const ITEMS_PER_PAGE = 6;

const defaultState = () => ({
  open: false,
  categories: [],
  items: [],
  allItems: [],
  activeCategoryId: null,
  categoryIndex: 0,
  itemIndex: 0,
  itemsPerPage: ITEMS_PER_PAGE,
  visibleOffset: 0,
  pageIndex: 0,
  pageCount: 0,
  focusedColumn: "items",
  previousFocus: null,
  modalDepth: 0,
});

const createOsdMenu = (dependencies = {}) => {
  const {
    settings,
    getDisplays,
    media,
    video,
    actions = {},
    navigation,
  } = dependencies;

  const root = document.getElementById("ws-osd-root");
  if (!root) throw new Error("OSD menu root element not found.");

  const state = defaultState();
  const pauseLocks = new Set();
  const pauseState = { wasPlaying: false };

  const acquirePause = (lockId) => {
    if (pauseLocks.has(lockId)) return;
    if (pauseLocks.size === 0) {
      pauseState.wasPlaying = navigation?.isPlaying?.() ?? false;
      if (pauseState.wasPlaying) {
        navigation?.sendCommand?.("stop");
      }
    }
    pauseLocks.add(lockId);
  };

  const releasePause = (lockId) => {
    if (!pauseLocks.has(lockId)) return;
    pauseLocks.delete(lockId);
    if (pauseLocks.size === 0 && pauseState.wasPlaying) {
      navigation?.sendCommand?.("play");
      pauseState.wasPlaying = false;
    }
  };

  const mediaHelpers = {
    isAvailable: media?.isAvailable ?? (() => false),
    getPlaying: media?.getPlaying ?? (() => false),
    setPlaying: media?.setPlaying ?? (() => undefined),
    getVolume: media?.getVolume ?? (() => 1),
    setVolume: media?.setVolume ?? (() => undefined),
    getVolumeOptions: media?.getVolumeOptions ?? (() => []),
  };

  const videoHelpers = {
    getSources: video?.getSources ?? (() => []),
    getIncludeInPermalink: video?.getIncludeInPermalink ?? (() => false),
    setIncludeInPermalink: video?.setIncludeInPermalink ?? ((value) => value),
    openManager: video?.openManager ?? (() => {}),
    subscribe: video?.subscribe,
  };

  const controllerActions = {
    openLocation: actions.openLocation ?? (() => {}),
    openVideoManager: actions.openVideoManager ?? (() => {}),
    openPermalinkModal: actions.openPermalinkModal ?? (() => {}),
    confirmResetDefaults: actions.confirmResetDefaults ?? (() => {}),
    openAboutModal: actions.openAboutModal ?? (() => {}),
    requestKioskEnable: actions.requestKioskEnable ?? (() => {}),
    confirmUnitsChange: actions.confirmUnitsChange,
    confirmIncludeVideosToggle: actions.confirmIncludeVideosToggle,
  };

  const model = createOsdMenuModel({
    settings,
    getDisplays,
    media: mediaHelpers,
    video: videoHelpers,
    actions: controllerActions,
  });

  const view = createOsdMenuView(root);

  // Add close button handler
  const closeBtn = root.querySelector(".ws-osd__close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      if (state.open && state.modalDepth === 0) {
        close();
      }
    });
  }

  if (typeof videoHelpers.subscribe === "function") {
    videoHelpers.subscribe(() => {
      model.refresh();
      if (state.open) {
        loadCategories();
        render({ refreshCategories: true, refreshItems: true });
      }
    });
  }

  const keyboard = createKeyboardController({
    onMove: (delta) => handleMove(delta),
    onAdjust: (direction, column) => handleAdjust(direction, column),
    onActivate: (column) => handleActivate(column),
    onSwapColumn: (direction) => swapColumn(direction),
    onEscape: () => handleEscape(),
    getActiveColumn: () => state.focusedColumn,
  });

  const mouse = createMouseController({
    root,
    onFocus: (column, index) => handlePointerFocus(column, index),
    onActivate: (column, index) => handlePointerActivate(column, index),
    onAdjust: (direction, column, index) => handlePointerAdjust(direction, column, index),
    onPaginate: (delta) => handlePaginationChange(delta),
  });

  const handleGlobalPointerDown = (event) => {
    if (!state.open || state.modalDepth > 0) return;
    const target = event?.target;
    if (!target) return;
    if (root.contains(target)) return;
    close();
  };

  document.addEventListener("pointerdown", handleGlobalPointerDown);

  initOsdModal({
    onOpen: () => {
      state.modalDepth += 1;
      keyboard.deactivate();
      mouse.deactivate();
      acquirePause("modal");
    },
    onClose: () => {
      state.modalDepth = Math.max(0, state.modalDepth - 1);
      releasePause("modal");
      if (state.open && state.modalDepth === 0) {
        keyboard.activate();
        mouse.activate();
      }
    },
  });

  const ensureStateIndices = () => {
    if (state.categoryIndex < 0) state.categoryIndex = 0;
    if (state.categoryIndex >= state.categories.length) {
      state.categoryIndex = Math.max(0, state.categories.length - 1);
    }
    const totalItems = state.allItems.length;
    if (totalItems === 0) {
      state.itemIndex = 0;
      state.items = [];
      state.visibleOffset = 0;
      state.pageIndex = 0;
      state.pageCount = 0;
      return;
    }
    if (state.itemIndex < 0) state.itemIndex = 0;
    if (state.itemIndex >= totalItems) {
      state.itemIndex = totalItems - 1;
    }
    updateVisibleItems();
  };

  const loadCategories = () => {
    model.refresh();
    state.categories = model.getCategories();
    const storedCategoryId = localStorage.getItem(LAST_CATEGORY_KEY);
    const defaultCategoryId =
      storedCategoryId &&
      state.categories.some((cat) => cat.id === storedCategoryId)
        ? storedCategoryId
        : state.categories[0]?.id ?? null;
    state.activeCategoryId = defaultCategoryId;
    state.categoryIndex = state.categories.findIndex(
      (cat) => cat.id === state.activeCategoryId,
    );
    if (state.categoryIndex < 0) state.categoryIndex = 0;
    loadItems();
  };

  const loadItems = () => {
    if (!state.activeCategoryId) {
      state.allItems = [];
      state.items = [];
      state.itemIndex = 0;
      state.visibleOffset = 0;
      state.pageIndex = 0;
      state.pageCount = 0;
      return;
    }
    state.allItems = model.getItemsSnapshot(state.activeCategoryId);
    if (state.itemIndex >= state.allItems.length) {
      state.itemIndex = Math.max(0, state.allItems.length - 1);
    }
    if (state.itemIndex < 0) state.itemIndex = 0;
    updateVisibleItems();
  };

  const updateVisibleItems = () => {
    const total = state.allItems.length;
    if (total === 0) {
      state.items = [];
      state.visibleOffset = 0;
      state.pageIndex = 0;
      state.pageCount = 0;
      return;
    }
    const perPage = state.itemsPerPage || ITEMS_PER_PAGE;
    state.pageCount = Math.max(1, Math.ceil(total / perPage));
    state.pageIndex = Math.min(
      state.pageCount - 1,
      Math.max(0, Math.floor(state.itemIndex / perPage)),
    );
    state.visibleOffset = state.pageIndex * perPage;
    state.items = state.allItems.slice(
      state.visibleOffset,
      state.visibleOffset + perPage,
    );
  };

  const render = (options = {}) => {
    const previousOffset = state.visibleOffset;
    const previousPage = state.pageIndex;
    const previousLength = state.items.length;

    ensureStateIndices();

    if (options.refreshCategories) {
      view.renderCategories(state.categories, state.activeCategoryId);
    }
    const itemsChanged =
      options.refreshItems ||
      previousOffset !== state.visibleOffset ||
      previousPage !== state.pageIndex ||
      previousLength !== state.items.length;

    if (itemsChanged) {
      view.renderItems(state.items, { offset: state.visibleOffset });
    }
    view.updatePagination(state.pageIndex, state.pageCount);
    view.updateCategorySelection(state.activeCategoryId);
    const categoryActive = state.focusedColumn === "categories";
    view.updateFocus("categories", state.categoryIndex, categoryActive);
    const relativeIndex = state.itemIndex - state.visibleOffset;
    view.updateFocus(
      "items",
      Math.max(0, relativeIndex),
      !categoryActive && state.items.length > 0,
    );
  };

  const open = () => {
    if (state.open) return;
    loadCategories();
    state.focusedColumn = "items";
    state.previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    view.setOpen(true);
    render({ refreshCategories: true, refreshItems: true });

    root.setAttribute("tabindex", "-1");
    root.focus({ preventScroll: true });

    keyboard.activate();
    mouse.activate();
    acquirePause("menu");

    state.open = true;
  };

  const close = () => {
    if (!state.open) return;
    if (state.modalDepth > 0) return; // Modal will handle closure

    keyboard.deactivate();
    mouse.deactivate();
    releasePause("menu");

    view.clearFocus();
    view.setOpen(false);
    root.removeAttribute("tabindex");

    if (
      state.previousFocus &&
      typeof state.previousFocus.focus === "function"
    ) {
      requestAnimationFrame(() => {
        try {
          state.previousFocus.focus({ preventScroll: true });
        } catch (_error) {
          // ignore focus errors
        }
      });
    }

    state.previousFocus = null;
    state.open = false;
  };

  const toggle = () => {
    if (state.open) {
      close();
    } else {
      open();
    }
  };

  const focusCategory = (index) => {
    state.categoryIndex = Math.max(
      0,
      Math.min(index, state.categories.length - 1),
    );
    state.activeCategoryId = state.categories[state.categoryIndex]?.id ?? null;
    if (state.activeCategoryId) {
      localStorage.setItem(LAST_CATEGORY_KEY, state.activeCategoryId);
    }
    loadItems();
    state.itemIndex = 0;
    updateVisibleItems();
    render({ refreshItems: true });
  };

  const focusItem = (index) => {
    if (state.allItems.length === 0) {
      state.itemIndex = 0;
      render({ refreshItems: true });
      return;
    }
    const clamped = Math.max(0, Math.min(index, state.allItems.length - 1));
    const previousPage = state.pageIndex;
    state.itemIndex = clamped;
    updateVisibleItems();
    const pageChanged = state.pageIndex !== previousPage;
    render({ refreshItems: pageChanged });
  };

  const handleMove = (delta) => {
    if (state.focusedColumn === "categories") {
      focusCategory(state.categoryIndex + delta);
    } else {
      focusItem(state.itemIndex + delta);
    }
  };

  const handleAdjust = (direction, column) => {
    if (column !== "items") return;
    const itemDefinitionIndex = state.itemIndex;
    model
      .adjustItem(state.activeCategoryId, itemDefinitionIndex, direction)
      .then(() => {
        loadItems();
        render({ refreshItems: true });
      });
  };

  const handleActivate = (column) => {
    if (column === "categories") {
      state.focusedColumn = "items";
      render();
      return;
    }
    const index = state.itemIndex;
    model.activateItem(state.activeCategoryId, index).then(() => {
      loadItems();
      render({ refreshItems: true });
    });
  };

  const swapColumn = (direction) => {
    if (direction === "previous") {
      state.focusedColumn =
        state.focusedColumn === "items" ? "categories" : "items";
    } else {
      state.focusedColumn =
        state.focusedColumn === "categories" ? "items" : "categories";
    }
    render();
  };

  const handlePointerFocus = (column, index) => {
    if (state.modalDepth > 0) return;
    if (column === "categories") {
      state.focusedColumn = "categories";
      focusCategory(index);
    } else {
      state.focusedColumn = "items";
      focusItem(index);
    }
  };

  const handlePointerActivate = (column, index) => {
    if (column === "categories") {
      focusCategory(index);
      state.focusedColumn = "items";
      render();
      return;
    }
    state.itemIndex = Math.max(0, Math.min(index, state.allItems.length - 1));
    updateVisibleItems();
    render();
    handleActivate("items");
  };

  const handlePointerAdjust = (direction, column, index) => {
    if (column !== "items") return;
    state.itemIndex = Math.max(0, Math.min(index, state.allItems.length - 1));
    updateVisibleItems();
    handleAdjust(direction, "items");
  };

  const handlePaginationChange = (delta) => {
    if (state.modalDepth > 0) return;
    const targetPage = state.pageIndex + delta;
    if (targetPage < 0 || targetPage >= state.pageCount) return;
    const { itemsPerPage } = state;
    const targetItemIndex = targetPage * itemsPerPage;
    focusItem(targetItemIndex);
  };

  const handleEscape = () => {
    if (!state.open) return;
    if (state.focusedColumn === "items" && state.categories.length > 0) {
      state.focusedColumn = "categories";
      render();
      return;
    }
    close();
  };

  const refresh = () => {
    if (!state.open) return;
    loadCategories();
    render({ refreshCategories: true, refreshItems: true });
  };

  document.addEventListener("ws4kp:displays-changed", () => {
    model.refresh();
    if (state.open) {
      loadCategories();
      render({ refreshCategories: true, refreshItems: true });
    }
  });

  document.addEventListener("ws4kp:media-availability", () => {
    model.refresh();
    if (state.open) {
      loadCategories();
      render({ refreshCategories: true, refreshItems: true });
    }
  });

  return {
    open,
    close,
    toggle,
    refresh,
    isOpen: () => state.open,
  };
};

export default createOsdMenu;
