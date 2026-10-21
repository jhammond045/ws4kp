const wrapText = (value) => {
	if (value === null || value === undefined) return '';
	return String(value);
};

const upperLabel = (option) => option.label?.toUpperCase?.() ?? option.label;

// [value, text] pairs from a Setting to enum options
const settingOptions = (setting) => (setting.values || []).map(([value, label]) => ({ value, label }));

// compared as strings, a numeric setting can arrive as '1.25' from a select or the url
const sameValue = (a, b) => String(a) === String(b);

const defaultToggleDisplayValue = (value) => (value ? 'ON' : 'OFF');

const snapshotDefinition = (definition) => {
	const value = definition.getValue?.();
	return {
		id: definition.id,
		label: definition.label,
		type: definition.type,
		displayValue: definition.getDisplayValue
			? definition.getDisplayValue(value)
			: wrapText(value),
		disabled: definition.isDisabled?.() ?? false,
	};
};

const createToggleDefinition = ({
	id,
	label,
	getValue,
	setValue,
	onActivate,
	isDisabled,
	beforeSet,
}) => ({
	id,
	label,
	type: 'toggle',
	getValue,
	setValue,
	isDisabled: isDisabled ?? (() => false),
	adjust: async () => {
		const current = !!getValue();
		const next = !current;
		if (typeof beforeSet === 'function') {
			const proceed = await beforeSet(next, current);
			if (proceed === false) return false;
		}
		return setValue(next);
	},
	activate: async () => {
		if (typeof onActivate === 'function') {
			return onActivate();
		}
		const current = !!getValue();
		const next = !current;
		if (typeof beforeSet === 'function') {
			const proceed = await beforeSet(next, current);
			if (proceed === false) return false;
		}
		return setValue(next);
	},
	getDisplayValue: (value) => defaultToggleDisplayValue(value),
});

const createEnumDefinition = ({
	id,
	label,
	options,
	getValue,
	setValue,
	formatLabel,
	isDisabled,
	beforeSet,
}) => ({
	id,
	label,
	type: 'enum',
	options,
	getValue,
	setValue,
	isDisabled: isDisabled ?? (() => false),
	adjust: async (direction) => {
		const current = getValue();
		const values = options.map((option) => option.value);
		const currentIndex = values.findIndex((value) => sameValue(value, current));
		const delta = direction === 'decrement' ? -1 : 1;
		const targetIndex = (currentIndex + delta + values.length) % values.length;
		const next = values[targetIndex];
		if (typeof beforeSet === 'function') {
			const proceed = await beforeSet(next, current);
			if (proceed === false) return false;
		}
		return setValue(next);
	},
	activate: async () => {
		const values = options.map((option) => option.value);
		const current = getValue();
		const nextIndex = (values.findIndex((value) => sameValue(value, current)) + 1) % values.length;
		const nextValue = values[nextIndex];
		if (typeof beforeSet === 'function') {
			const proceed = await beforeSet(nextValue, current);
			if (proceed === false) return false;
		}
		return setValue(nextValue);
	},
	getDisplayValue: (value) => {
		const option = options.find((item) => sameValue(item.value, value)) || options[0];
		if (!option) return wrapText(value);
		if (typeof formatLabel === 'function') return formatLabel(option);
		return option.label ?? wrapText(value);
	},
});

// steps between min and max; a value between steps (75 with a step of 10) moves to the nearest step in that direction
const createNumberDefinition = ({
	id,
	label,
	min,
	max,
	step,
	getValue,
	setValue,
	formatValue,
	isDisabled,
}) => {
	const stepFrom = (current, direction) => {
		const steps = direction === 'decrement'
			? Math.ceil((current - min) / step) - 1
			: Math.floor((current - min) / step) + 1;
		return Math.min(max, Math.max(min, min + steps * step));
	};
	return {
		id,
		label,
		type: 'number',
		getValue,
		setValue,
		isDisabled: isDisabled ?? (() => false),
		adjust: async (direction) => setValue(stepFrom(Number(getValue()), direction)),
		// enter steps up, and wraps around to the minimum after the maximum
		activate: async () => {
			const current = Number(getValue());
			return setValue(current >= max ? min : stepFrom(current, 'increment'));
		},
		getDisplayValue: (value) => (formatValue ? formatValue(value) : wrapText(value)),
	};
};

// turn a display on or off through its checkbox on the Displays tab
// the checkbox's change listener updates the display, and the tab's count and the permalink read the checkbox
const setDisplayEnabled = (display, value) => {
	const checkbox = display.checkbox?.querySelector('input[type=checkbox]');
	if (checkbox) {
		checkbox.checked = value;
		checkbox.dispatchEvent(new Event('change', { bubbles: true }));
		return;
	}
	display.checkboxChange?.({ target: { checked: value } });
};

const createActionDefinition = ({
	id,
	label,
	onActivate,
	displayValue,
	isDisabled,
}) => ({
	id,
	label,
	type: 'action',
	isDisabled: isDisabled ?? (() => false),
	activate: onActivate,
	getDisplayValue: () => displayValue ?? 'ENTER',
});

class OsdMenuModel {
	constructor({
		settings, getDisplays, media, video, actions,
	}) {
		this.settings = settings;
		this.getDisplays = getDisplays;
		this.media = media;
		this.video = video;
		this.actions = actions;
		this.categories = [];
		this.videoSources = [];
		this.refresh();
	}

	refresh() {
		this.videoSources = this.video?.getSources?.() ?? [];
		this.categories = [
			this.buildSetupCategory(),
			this.buildScreensCategory(),
			this.buildVideoCategory(),
			this.buildAudioCategory(),
			this.buildStyleCategory(),
			this.buildSystemCategory(),
		].filter(Boolean);
	}

	buildSetupCategory() {
		const items = [];
		if (this.actions?.openLocation) {
			items.push(
				createActionDefinition({
					id: 'location',
					label: 'Location',
					onActivate: this.actions.openLocation,
					displayValue: 'OPEN',
				}),
			);
		}

		if (this.settings?.units) {
			const options = settingOptions(this.settings.units);
			items.push(
				createEnumDefinition({
					id: 'units',
					label: 'Units',
					options,
					getValue: () => this.settings.units.value,
					setValue: (value) => {
						this.settings.units.value = value;
					},
					formatLabel: upperLabel,
					beforeSet: (nextValue, currentValue) => {
						if (nextValue === currentValue) return true;
						if (typeof this.actions?.confirmUnitsChange === 'function') {
							return this.actions.confirmUnitsChange(currentValue, nextValue);
						}
						return true;
					},
				}),
			);
		}

		// widescreen, enhanced and portrait are set together by the display mode
		if (this.settings?.viewMode) {
			items.push(
				createEnumDefinition({
					id: 'view-mode',
					label: 'Display Mode',
					options: settingOptions(this.settings.viewMode),
					getValue: () => this.settings.viewMode.value,
					setValue: (value) => {
						this.settings.viewMode.value = value;
					},
					formatLabel: upperLabel,
				}),
			);
		}

		return {
			id: 'setup',
			title: 'SET UP WEATHER',
			items,
		};
	}

	buildScreensCategory() {
		const displays = this.getDisplays?.() ?? [];
		const displayItems = displays
			.filter(
				(display) => display?.elemId && display.includeInScreensCategory !== false,
			)
			.map((display) => createToggleDefinition({
				id: `screen-${display.elemId}`,
				label: display.name ?? display.elemId,
				getValue: () => !!display.isEnabled,
				setValue: (value) => setDisplayEnabled(display, value),
			}));

		const items = [];
		if (this.settings?.speed) {
			items.push(
				createEnumDefinition({
					id: 'screen-speed',
					label: 'Screen Speed',
					options: settingOptions(this.settings.speed),
					getValue: () => this.settings.speed.value,
					setValue: (value) => {
						this.settings.speed.value = Number(value);
					},
					formatLabel: upperLabel,
				}),
			);
		}

		return {
			id: 'screens',
			title: 'SCREENS',
			items: [...items, ...displayItems],
		};
	}

	buildAudioCategory() {
		const items = [];
		const musicAvailable = this.media?.isAvailable?.() ?? false;

		if (musicAvailable) {
			items.push(
				createToggleDefinition({
					id: 'music-toggle',
					label: 'Music',
					getValue: () => !!this.media.getPlaying?.(),
					setValue: (value) => this.media.setPlaying?.(value),
				}),
			);
		}

		if (this.media?.getVolume && this.media?.setVolume) {
			// the volume setting is 0-1, shown as a percentage
			items.push(
				createNumberDefinition({
					id: 'music-volume',
					label: 'Music Volume',
					min: 0,
					max: 100,
					step: 10,
					getValue: () => Math.round(Number(this.media.getVolume()) * 100),
					setValue: (value) => this.media.setVolume(value / 100),
					formatValue: (value) => `${value}%`,
					isDisabled: () => !musicAvailable,
				}),
			);
		}

		if (!items.length) return null;

		return {
			id: 'audio',
			title: 'AUDIO',
			items,
		};
	}

	buildVideoCategory() {
		const items = [];
		const openVideoManager = this.actions?.openVideoManager;
		if (this.video && typeof openVideoManager === 'function') {
			const count = this.videoSources.length;
			const manageDisplay = count === 0 ? 'ADD' : `${count} SOURCE${count === 1 ? '' : 'S'}`;
			items.push(
				createActionDefinition({
					id: 'video-manage',
					label: 'Video Sources',
					onActivate: () => openVideoManager(),
					displayValue: manageDisplay,
				}),
			);

			this.videoSources.forEach((source, index) => {
				const label = wrapText(source.title || `Video ${index + 1}`);
				const duration = Number.isFinite(Number(source.durationSec))
					? `${Math.round(Number(source.durationSec))}s`
					: 'OPEN';
				items.push(
					createActionDefinition({
						id: `video-source-${source.id}`,
						label,
						onActivate: () => openVideoManager(source.id),
						displayValue: duration,
					}),
				);
			});
		}

		// Videos are always included in permalink - no option needed

		return {
			id: 'video',
			title: 'VIDEO SOURCES',
			items,
		};
	}

	buildStyleCategory() {
		const items = [];

		if (this.settings?.scanLines) {
			items.push(
				createToggleDefinition({
					id: 'scan-lines',
					label: 'Scan Lines',
					getValue: () => !!this.settings.scanLines.value,
					setValue: (value) => {
						this.settings.scanLines.value = !!value;
					},
				}),
			);
		}

		if (this.settings?.scanLineMode) {
			items.push(
				createEnumDefinition({
					id: 'scan-line-mode',
					label: 'Scan Line Style',
					options: settingOptions(this.settings.scanLineMode),
					getValue: () => this.settings.scanLineMode.value,
					setValue: (value) => {
						this.settings.scanLineMode.value = value;
					},
					formatLabel: upperLabel,
					isDisabled: () => !this.settings.scanLines?.value,
				}),
			);
		}

		if (this.settings?.kiosk) {
			items.push(
				createToggleDefinition({
					id: 'kiosk-mode',
					label: 'Kiosk Mode',
					getValue: () => !!this.settings.kiosk.value,
					setValue: (value) => {
						this.settings.kiosk.value = !!value;
					},
					// a warning is shown before turning it on
					beforeSet: (next) => (next ? this.actions?.requestKioskEnable?.() ?? true : true),
				}),
			);
		}

		if (this.settings?.stickyKiosk) {
			items.push(
				createToggleDefinition({
					id: 'sticky-kiosk',
					label: 'Sticky Kiosk',
					getValue: () => !!this.settings.stickyKiosk.value,
					setValue: (value) => {
						this.settings.stickyKiosk.value = !!value;
					},
				}),
			);
		}

		// custom-scroll-text.mjs
		if (this.settings?.customTextEnable) {
			items.push(
				createToggleDefinition({
					id: 'custom-text-enable',
					label: 'Custom Text',
					getValue: () => !!this.settings.customTextEnable.value,
					setValue: (value) => {
						this.settings.customTextEnable.value = !!value;
					},
				}),
			);
		}

		if (this.settings?.customText && this.actions?.editCustomText) {
			items.push(
				createActionDefinition({
					id: 'custom-text',
					label: 'Edit Custom Text',
					onActivate: this.actions.editCustomText,
					displayValue: 'EDIT',
				}),
			);
		}

		if (!items.length) return null;

		return {
			id: 'style',
			title: 'STYLE',
			items,
		};
	}

	buildSystemCategory() {
		const items = [];
		if (this.actions?.openPermalinkModal) {
			items.push(
				createActionDefinition({
					id: 'permalink',
					label: 'Copy Permalink',
					onActivate: this.actions.openPermalinkModal,
					displayValue: 'OPEN',
				}),
			);
		}

		if (this.actions?.confirmResetDefaults) {
			items.push(
				createActionDefinition({
					id: 'reset-defaults',
					label: 'Reset to Defaults',
					onActivate: this.actions.confirmResetDefaults,
					displayValue: 'CONFIRM',
				}),
			);
		}

		if (this.actions?.openAboutModal) {
			items.push(
				createActionDefinition({
					id: 'about',
					label: 'About',
					onActivate: this.actions.openAboutModal,
					displayValue: 'VIEW',
				}),
			);
		}

		return {
			id: 'system',
			title: 'SYSTEM',
			items,
		};
	}

	getCategories() {
		return this.categories.map(({ id, title }) => ({ id, title }));
	}

	getCategoryById(categoryId) {
		return this.categories.find((category) => category.id === categoryId);
	}

	getItemsSnapshot(categoryId) {
		const category = this.getCategoryById(categoryId);
		if (!category) return [];
		return category.items.map((item) => snapshotDefinition(item));
	}

	getItemDefinition(categoryId, index) {
		const category = this.getCategoryById(categoryId);
		if (!category) return null;
		return category.items[index] ?? null;
	}

	async adjustItem(categoryId, index, direction = 'increment') {
		const definition = this.getItemDefinition(categoryId, index);
		if (!definition || definition.isDisabled?.()) return false;
		if (typeof definition.adjust === 'function') {
			await definition.adjust(direction);
		} else if (definition.type === 'toggle') {
			await definition.activate?.();
		}
		return true;
	}

	async activateItem(categoryId, index) {
		const definition = this.getItemDefinition(categoryId, index);
		if (!definition || definition.isDisabled?.()) return false;
		if (typeof definition.activate === 'function') {
			await definition.activate();
			return true;
		}
		return false;
	}
}

const createOsdMenuModel = (deps) => new OsdMenuModel(deps);

export default createOsdMenuModel;
