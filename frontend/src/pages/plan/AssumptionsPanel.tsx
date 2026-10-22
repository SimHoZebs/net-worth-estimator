import type { FocusEvent, KeyboardEvent } from "react";
import { parseDisplayNumber } from "../../components/editors/formValues.ts";
import { InputField } from "../../components/Field.tsx";
import type { Plan } from "../../domain/model.ts";

type AssumptionField = "inflation" | "volatility";

export function AssumptionsPanel({
	plan,
	onUpdate,
}: {
	plan: Plan;
	onUpdate: (plan: Plan) => boolean;
}) {
	const commit = (field: AssumptionField, input: HTMLInputElement) => {
		const value = parseDisplayNumber(input.value);
		if (value === null) {
			input.value = String(plan.assumptions[field]);
			return;
		}
		if (value === plan.assumptions[field]) return;
		const applied = onUpdate({
			...plan,
			assumptions: { ...plan.assumptions, [field]: value },
		});
		if (!applied) input.value = String(plan.assumptions[field]);
	};
	const fieldProps = (field: AssumptionField) => ({
		onBlur: (event: FocusEvent<HTMLInputElement>) =>
			commit(field, event.currentTarget),
		onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
			if (event.key === "Enter") event.currentTarget.blur();
		},
	});
	return (
		<div className="p-6 [@media(max-width:600px)]:p-5">
			<div className="flex items-center justify-between gap-4 [@media(max-width:600px)]:flex-wrap">
				<h2>The inputs behind the outlook</h2>
			</div>
			<div className="grid grid-cols-2 gap-5 [@media(max-width:600px)]:gap-x-3 [@media(max-width:600px)]:gap-y-4 [@media(max-width:370px)]:grid-cols-1">
				<InputField
					key={plan.assumptions.inflation}
					label="Annual inflation (%)"
					name="inflation"
					type="number"
					min="0"
					max="20"
					step="0.1"
					defaultValue={plan.assumptions.inflation}
					{...fieldProps("inflation")}
				/>
				<InputField
					key={plan.assumptions.volatility}
					label="Investment return variability (%)"
					name="volatility"
					type="number"
					min="0"
					max="40"
					step="0.5"
					defaultValue={plan.assumptions.volatility}
					{...fieldProps("volatility")}
				/>
			</div>
		</div>
	);
}
