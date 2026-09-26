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
				hint="Used only when viewing today’s dollars. Movement increases are configured separately."
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
				hint="Annual standard deviation in percentage points, applied to all investment accounts."
				name="volatility"
				type="number"
				required
				min="0"
				max="40"
				step="0.5"
				defaultValue={plan.assumptions.volatility}
			/>
			<div className="method-note field-wide">
				<h3>What the scenarios vary</h3>
				<p>
					400 repeatable scenarios vary investment returns each calendar year.
					Investment accounts share the same market shock. Rates are normally
					sampled and capped between −50% and +50%. Cash, debt and property
					rates stay fixed.
				</p>
				<p>
					Taxes, market fees and access restrictions are not calculated. Add
					relevant payments to your plan. A range is a model, not a guarantee.
				</p>
			</div>
		</EditorForm>
	);
}
