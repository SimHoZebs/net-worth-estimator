import {
	getSafeSpendingSettings,
	updateSettingsForScope,
} from "../state/useSafeSpendingSettings.ts";

/** Test observations compose Query data and a scope-bound command. */
export const safeSpendingSettingsObserver = {
	getState: () => ({
		...getSafeSpendingSettings(),
		updateSettings: updateSettingsForScope(),
	}),
};
