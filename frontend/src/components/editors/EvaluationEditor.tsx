import { useState } from "react";
import type { Evaluation } from "../../domain/model.ts";
import { upsertItem } from "../../domain/planEdits.ts";
import { InputField, SelectField } from "../Field.tsx";
import { AccountOptions } from "./AccountOptions.tsx";
import { EditorForm, type EditorProps } from "./EditorForm.tsx";
import { numberValue, textValue } from "./formValues.ts";

export function EvaluationEditor({
	item,
	plan,
	...props
}: EditorProps & { item: Evaluation | null }) {
	const [kind, setKind] = useState(item?.kind ?? "net-worth");
	return (
		<EditorForm
			{...props}
			title={`${item ? "Edit" : "Add"} evaluation`}
			buildPlan={(data) => {
				const evaluation: Evaluation = {
					id: item?.id ?? crypto.randomUUID(),
					name: textValue(data, "name"),
					kind,
					target: numberValue(data, "target"),
					accountId:
						kind === "reserve" ? textValue(data, "accountId") || null : null,
					enabled: item?.enabled ?? true,
				};
				return {
					...plan,
					evaluations: upsertItem({
						items: plan.evaluations,
						item: evaluation,
					}),
				};
			}}
		>
			<InputField
				label="Evaluation name"
				wide
				name="name"
				required
				maxLength={100}
				defaultValue={item?.name ?? ""}
				placeholder="e.g. A comfortable cash cushion"
			/>
			<SelectField
				label="Measure"
				name="kind"
				value={kind}
				onChange={(event) => setKind(event.target.value as Evaluation["kind"])}
			>
				<option value="net-worth">Household net worth</option>
				<option value="reserve">An account balance</option>
			</SelectField>
			<InputField
				label="Target (USD)"
				name="target"
				type="number"
				required
				min="1"
				max="10000000000"
				step="1"
				defaultValue={item?.target ?? 1000000}
			/>
			{kind === "reserve" && (
				<SelectField
					label="Account"
					wide
					name="accountId"
					required
					defaultValue={item?.accountId ?? ""}
				>
					<option value="" disabled>
						Select an account
					</option>
					<AccountOptions accounts={plan.accounts} />
				</SelectField>
			)}
			<p className="field-wide field-hint">
				An evaluation is reached the first day the selected measure meets its
				target. Reaching it once does not establish long-term sustainability.
			</p>
		</EditorForm>
	);
}
