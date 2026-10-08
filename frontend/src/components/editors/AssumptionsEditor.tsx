import { InputField } from "../Field.tsx";
import { EditorForm, type EditorProps } from "./EditorForm.tsx";
import { numberValue } from "./formValues.ts";

export function AssumptionsEditor({ plan, ...props }: EditorProps) {
	return (
		<EditorForm
			{...props}
			title="Edit assumptions"
			buildPlan={(data) => ({
				...plan,
				assumptions: {
					inflation: numberValue(data, "inflation"),
					volatility: numberValue(data, "volatility"),
				},
			})}
		>
			<InputField
				label="Annual inflation (%)"
				name="inflation"
				type="number"
				required
				min="0"
				max="20"
				step="0.1"
				defaultValue={plan.assumptions.inflation}
			/>
			<InputField
				label="Investment return variability (%)"
				name="volatility"
				type="number"
				required
				min="0"
				max="40"
				step="0.5"
				defaultValue={plan.assumptions.volatility}
			/>
		</EditorForm>
	);
}
