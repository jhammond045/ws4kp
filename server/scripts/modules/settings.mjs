import Setting from './utils/setting.mjs';

// Initialize settings immediately so other modules can access them
const settings = { speed: { value: 1.0 } };

// Track settings that need DOM changes after early initialization
const deferredDomSettings = new Set();

// Declare change functions first, before they're referenced in init() to avoid the Temporal Dead Zone (TDZ)
const wideScreenChange = (value) => {
	const container = document.querySelector('#divTwc');
	if (!container) {
		// DOM not ready; defer enabling if set
		if (value) {
			deferredDomSettings.add('wide');
		}
		return;
	}

	if (value) {
		container.classList.add('wide');
	} else {
		container.classList.remove('wide');
	}
	// Trigger resize to recalculate scaling for new width
	window.dispatchEvent(new Event('resize'));
};

const kioskChange = (value) => {
	const body = document.querySelector('body');
	if (!body) {
		// DOM not ready; defer enabling if set
		if (value) {
			deferredDomSettings.add('kiosk');
		}
		return;
	}

	if (value) {
		body.classList.add('kiosk');
		window.dispatchEvent(new Event('resize'));
	} else {
		body.classList.remove('kiosk');
		window.dispatchEvent(new Event('resize'));
	}

	// Conditionally store the kiosk setting based on the "Sticky Kiosk" setting
	// (Need to check if the method exists to handle initialization race condition)
	if (settings.kiosk?.conditionalStoreToLocalStorage) {
		settings.kiosk.conditionalStoreToLocalStorage(
			value,
			settings.stickyKiosk?.value,
		);
	}
};

const crtStrengthChange = (_value) => {
	// Apply the CRT effect with the new strength
	if (typeof window.applyCrtEffect === 'function') {
		window.applyCrtEffect();
	}
};

// Simple global helper to change CRT strength when remote debugging or in kiosk mode
window.changeCrtStrength = (strength) => {
	if (typeof settings === 'undefined' || !settings.crtStrength) {
		console.error('Settings system not available');
		return false;
	}

	const validStrengths = ['0', '25', '50', '75', '100'];
	if (!validStrengths.includes(String(strength))) {
		return false;
	}

	settings.crtStrength.value = String(strength);
	return true;
};

const unitChange = () => {
	// reload the data at the top level to refresh units
	// after the initial load
	if (unitChange.firstRunDone) {
		window.location.reload();
	}
	unitChange.firstRunDone = true;
};

const init = () => {
	// create settings see setting.mjs for defaults
	settings.wide = new Setting('wide', {
		name: 'Widescreen',
		defaultValue: false,
		changeAction: wideScreenChange,
		sticky: true,
	});
	settings.kiosk = new Setting('kiosk', {
		name: 'Kiosk',
		defaultValue: false,
		changeAction: kioskChange,
		sticky: false,
		stickyRead: true,
	});
	settings.stickyKiosk = new Setting('stickyKiosk', {
		name: 'Sticky Kiosk',
		defaultValue: false,
		sticky: true,
	});
	settings.speed = new Setting('speed', {
		name: 'Speed',
		type: 'select',
		defaultValue: 1.0,
		values: [
			[0.5, 'Very Fast'],
			[0.75, 'Fast'],
			[1.0, 'Normal'],
			[1.25, 'Slow'],
			[1.5, 'Very Slow'],
		],
	});
	settings.crtStrength = new Setting('crtStrength', {
		name: 'CRT Effect Strength',
		type: 'select',
		defaultValue: '50',
		changeAction: crtStrengthChange,
		sticky: true,
		values: [
			['0', '0%'],
			['25', '25%'],
			['50', '50%'],
			['75', '75%'],
			['100', '100%'],
		],
	});
	settings.units = new Setting('units', {
		name: 'Units',
		type: 'select',
		defaultValue: 'us',
		changeAction: unitChange,
		values: [
			['us', 'US'],
			['si', 'Metric'],
		],
	});
	settings.refreshTime = new Setting('refreshTime', {
		type: 'select',
		defaultValue: 600_000,
		sticky: false,
		values: [
			[30_000, 'TESTING'],
			[300_000, '5 minutes'],
			[600_000, '10 minutes'],
			[900_000, '15 minutes'],
			[1_800_000, '30 minutes'],
		],
		visible: false,
	});
};

init();

// generate html objects
document.addEventListener('DOMContentLoaded', () => {
	// Apply any settings that were deferred due to the DOM not being ready when setting were read
	if (deferredDomSettings.size > 0) {
		console.log(
			'Applying deferred DOM settings:',
			Array.from(deferredDomSettings),
		);

		// Re-apply each pending setting by calling its changeAction with current value
		deferredDomSettings.forEach((settingName) => {
			const setting = settings[settingName];
			if (
				setting
        && setting.changeAction
        && typeof setting.changeAction === 'function'
			) {
				setting.changeAction(setting.value);
			}
		});

		deferredDomSettings.clear();
	}

	// Then generate the settings UI
	const settingHtml = Object.values(settings).map((d) => d.generate());
	const settingsSection = document.querySelector('#settings');
	if (!settingsSection) {
		console.warn(
			'Settings container not found; skipping legacy settings render.',
		);
		return;
	}
	settingsSection.innerHTML = '';
	settingsSection.append(...settingHtml);
});

export default settings;
