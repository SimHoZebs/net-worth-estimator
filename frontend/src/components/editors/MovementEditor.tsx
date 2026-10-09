import { useState } from "react";
import { type Movement, visibleAccounts } from "../../domain/model.ts";
import { upsertItem } from "../../domain/planEdits.ts";
import { InputField, SelectField } from "../Field.tsx";
import { AccountOptions } from "./AccountOptions.tsx";
import {
	EditorForm,
	type EditorProps,
	sourceReadOnlyReason,
} from "./EditorForm.tsx";
import { numberValue, textValue } from "./formValues.ts";

export function MovementEditor({
	item,
	plan,
	...props
}: EditorProps & { item: Movement | null }) {
	const readOnlyReason =
		item?.amountKnown === false
			? "This amount is calculated each occurrence. See the transaction list and Outlook for the resolved amounts."
			: item?.readOnly
				? sourceReadOnlyReason
				: undefined;
	const [noEndDate, setNoEndDate] = useState(item?.endDate == null);
	const [frequency, setFrequency] = useState(item?.frequency ?? "monthly");
	const isOnce = frequency === "once";
	const claimRules = plan.movements.filter(
		(movement) => movement.frequency !== "once" && movement.id !== item?.id,
	);
	return (
		<EditorForm
			{...props}
			title={item ? item.name : "Add planned transaction"}
			readOnlyReason={readOnlyReason}
			buildPlan={(data) => {
				const claimRuleId = textValue(data, "claimRuleId") || null;
				const claimOccurrenceDate =
					textValue(data, "claimOccurrenceDate") || null;
				const movement: Movement = {
					id: item?.id ?? crypto.randomUUID(),
					name: textValue(data, "name"),
					amount: numberValue(data, "amount"),
					amountKnown: true,
					fromId: textValue(data, "fromId") || null,
					toId: textValue(data, "toId") || null,
					frequency: textValue(data, "frequency") as Movement["frequency"],
					startDate: textValue(data, "startDate"),
					endDate:
						textValue(data, "noEndDate") === "on"
							? null
							: textValue(data, "endDate") || null,
					annualIncrease: numberValue(data, "annualIncrease"),
					enabled: textValue(data, "enabled") === "on",
					readOnly: false,
					claimRuleId,
					claimOccurrenceDate,
				};
				return {
					...plan,
					movements: upsertItem({ items: plan.movements, item: movement }),
				};
			}}
		>
			<InputField
				label="Transaction name"
				wide
				name="name"
				required
				maxLength={100}
				defaultValue={item?.name ?? ""}
				placeholder="e.g. Monthly investing"
			/>
			<InputField
				label="Amount (USD)"
				name="amount"
				type="number"
				required
				min="0.01"
				max="10000000000"
				step="0.01"
				defaultValue={item?.amountKnown === false ? "" : (item?.amount ?? 500)}
			/>
			<SelectField
				label="Frequency"
				name="frequency"
				defaultValue={item?.frequency ?? "monthly"}
				onChange={(event) =>
					setFrequency(event.target.value as Movement["frequency"])
				}
			>
				<option value="monthly">Monthly</option>
				<option value="yearly">Yearly</option>
				<option value="once">One time</option>
			</SelectField>
			<SelectField label="From" name="fromId" defaultValue={item?.fromId ?? ""}>
				<option value="">External income</option>
				<AccountOptions
					accounts={visibleAccounts(plan.accounts).filter(
						(account) => account.kind !== "debt",
					)}
				/>
			</SelectField>
			<SelectField label="To" name="toId" defaultValue={item?.toId ?? ""}>
				<option value="">External expense</option>
				<AccountOptions accounts={visibleAccounts(plan.accounts)} />
			</SelectField>
			<InputField
				label={isOnce ? "Date" : "First occurrence"}
				name="startDate"
				type="date"
				required
				defaultValue={item?.startDate ?? plan.startDate}
			/>
			{isOnce ? (
				<>
					<SelectField
						label="Records an occurrence of"
						name="claimRuleId"
						defaultValue={item?.claimRuleId ?? ""}
					>
						<option value="">No link — standalone record</option>
						{claimRules.map((rule) => (
							<option key={rule.id} value={rule.id}>
								{rule.name}
							</option>
						))}
					</SelectField>
					<InputField
						label="Replaces occurrence on"
						name="claimOccurrenceDate"
						type="date"
						defaultValue={item?.claimOccurrenceDate ?? ""}
					/>
				</>
			) : (
				<>
					<InputField
						label="Last occurrence"
						name="endDate"
						type="date"
						disabled={noEndDate}
						defaultValue={item?.endDate ?? ""}
					/>
					<label className="checkbox-field">
						<input
							name="noEndDate"
							type="checkbox"
							checked={noEndDate}
							onChange={(event) => setNoEndDate(event.target.checked)}
						/>
						No end date
					</label>
				</>
			)}
			<InputField
				label="Annual amount increase (%)"
				name="annualIncrease"
				type="number"
				required
				min="-50"
				max="50"
				step="0.1"
				defaultValue={item?.annualIncrease ?? 0}
			/>
			<label className="checkbox-field">
				<input
					name="enabled"
					type="checkbox"
					defaultChecked={item?.enabled ?? true}
				/>
				Include in projections
			</label>
		</EditorForm>
	);
}
