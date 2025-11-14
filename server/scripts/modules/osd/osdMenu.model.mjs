const wrapText = (value) => {
	if (value === null || value === undefined) return '';
	return String(value);
};

const formatSpeedLabel = (value) => `${Number(value).toFixed(2)}x`;

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
		const currentIndex = values.findIndex((value) => value === current);
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
		const nextIndex = (values.findIndex((value) => value === current) + 1) % values.length;
		const nextValue = values[nextIndex];
		if (typeof beforeSet === 'function') {
			const proceed = await beforeSet(nextValue, current);
			if (proceed === false) return false;
		}
		return setValue(nextValue);
	},
	getDisplayValue: (value) => {
		const option = options.find((item) => item.value === value) || options[0];
		if (typeof formatLabel === 'function') return formatLabel(option);
		return option?.label ?? wrapText(value);
	},
});

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
			const options = (this.settings.units.values || []).map(
				([value, text]) => ({
					value,
					label: text,
				}),
			);
			items.push(
				createEnumDefinition({
					id: 'units',
					label: 'Units',
					options,
					getValue: () => this.settings.units.value,
					setValue: (value) => {
						this.settings.units.value = value;
					},
					formatLabel: (option) => option.label?.toUpperCase?.() ?? option.label,
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

		if (this.settings?.wide) {
			items.push(
				createToggleDefinition({
					id: 'widescreen',
					label: 'Widescreen',
					getValue: () => !!this.settings.wide.value,
					setValue: (value) => {
						this.settings.wide.value = value;
					},
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
				setValue: (value) => {
					if (typeof display.checkboxChange === 'function') {
						display.checkboxChange({ target: { checked: value } });
					} else {
						display.isEnabled = value;
						if (value) {
							display.getData();
						}
					}
				},
			}));

		return {
			id: 'screens',
			title: 'SCREENS',
			items: displayItems,
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
			const volumeOptions = this.media.getVolumeOptions?.() ?? [
				{ value: 1, label: '100%' },
				{ value: 0.75, label: '75%' },
				{ value: 0.5, label: '50%' },
				{ value: 0.25, label: '25%' },
			];
			items.push(
				createEnumDefinition({
					id: 'music-volume',
					label: 'Music Volume',
					options: volumeOptions,
					getValue: () => this.media.getVolume(),
					setValue: (value) => this.media.setVolume(Number(value)),
					formatLabel: (option) => option.label,
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

		if (this.settings?.kiosk) {
			items.push(
				createToggleDefinition({
					id: 'kiosk-mode',
					label: 'Kiosk Mode',
					getValue: () => !!this.settings.kiosk.value,
					setValue: (value) => {
						this.settings.kiosk.value = !!value;
					},
				}),
			);
		}

		if (this.settings?.speed) {
			const allowed = [0.75, 1.0, 1.25, 1.5];
			const options = (this.settings.speed.values || [])
				.filter(([value]) => allowed.includes(Number(value)))
				.map(([value]) => ({
					value,
					label: formatSpeedLabel(value),
				}));

			items.push(
				createEnumDefinition({
					id: 'screen-speed',
					label: 'Screen Speed',
					options,
					getValue: () => this.settings.speed.value,
					setValue: (value) => {
						this.settings.speed.value = Number(value);
					},
					formatLabel: (option) => option.label,
				}),
			);
		}

		if (this.settings?.crtStrength?.values?.length) {
			const options = this.settings.crtStrength.values.map(
				([value, label]) => ({
					value,
					label,
				}),
			);
			items.push(
				createEnumDefinition({
					id: 'crt-strength',
					label: 'CRT Effect',
					options,
					getValue: () => this.settings.crtStrength.value,
					setValue: (value) => {
						this.settings.crtStrength.value = value;
					},
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
