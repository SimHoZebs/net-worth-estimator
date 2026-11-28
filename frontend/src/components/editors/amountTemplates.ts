import { useAmountPresets } from "../../state/workspaceResources.ts";
import type { AmountPreset } from "../../api/contracts.ts";
import {
	FALLBACK_TEMPLATES,
	presetToTemplate,
} from "../../domain/amountCatalog.ts";

const SCHEDULE_TEMPLATE_IDS: ReadonlySet<string> = new Set([
	"schedule-percent",
	"owed-balance",
]);

export function amountTemplatesFromPresets(
	serverPresets: AmountPreset[] | undefined,
) {
	if (!serverPresets) return FALLBACK_TEMPLATES;
	const templates = serverPresets.map(presetToTemplate);
	const savedNames = new Set(templates.map((template) => template.id));
	return [
		...templates,
		...FALLBACK_TEMPLATES.filter(
			(template) =>
				SCHEDULE_TEMPLATE_IDS.has(template.id) && !savedNames.has(template.id),
		),
	];
}

/** Single source for amount-recipe templates. Server presets are truth;
 * schedule-only supported templates remain available alongside them. */
export function useAmountTemplates() {
	const serverPresets = useAmountPresets().data;
	return amountTemplatesFromPresets(serverPresets);
}
