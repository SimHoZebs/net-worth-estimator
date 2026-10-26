import { useAmountPresets } from "../../state/workspaceResources.ts";
import {
	FALLBACK_TEMPLATES,
	presetToTemplate,
} from "../../domain/amountCatalog.ts";

/** Single source for amount-recipe templates. Server presets are truth;
 * the bundled fallback only covers the gap before the first load. */
export function useAmountTemplates() {
	const serverPresets = useAmountPresets().data;
	if (!serverPresets) return FALLBACK_TEMPLATES;
	return serverPresets.map(presetToTemplate);
}
