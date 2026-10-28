import { useId, useState } from "react";
import {
	type Movement,
	type Plan,
	visibleAccounts,
} from "../../domain/model.ts";
import { parseUnion } from "../../domain/guards.ts";
import { upsertItem } from "../../domain/planEdits.ts";
import { Checkbox, InputField, SelectField } from "../Field.tsx";
import { Notice } from "../Notice.tsx";
import { AccountOptions } from "./AccountOptions.tsx";
import { useAmountTemplates } from "./amountTemplates.ts";
import {
	EditorForm,
	type EditorProps,
	sourceReadOnlyReason,
} from "./EditorForm.tsx";
import { numberValue, textValue } from "./formValues.ts";

/** Pure plan builder shared by the overlay editor and inline detail edits. */
export function buildMovementPlan({
	plan,
	item,
	data,
}: {
	plan: Plan;
	item: Movement | null;
	data: FormData;
}): Plan {
	const claimRuleId = textValue(data, "claimRuleId") || null;
	const claimOccurrenceDate = textValue(data, "claimOccurrenceDate") || null;
	const amountKind = textValue(data, "amountKind") || "fixed";
	const advanced = amountKind !== "fixed" && amountKind !== "growth";
	const movement: Movement = {
		id: item?.id ?? crypto.randomUUID(),
		name: textValue(data, "name"),
		amount: advanced ? 0 : numberValue(data, "amount"),
		amountKnown: !advanced,
		fromId: textValue(data, "fromId") || null,
		toId: textValue(data, "toId") || null,
		frequency:
			parseUnion(textValue(data, "frequency"), [
				"monthly",
				"yearly",
				"once",
			] as const) ?? "monthly",
		startDate: textValue(data, "startDate"),
		endDate:
			textValue(data, "noEndDate") === "on"
				? null
				: textValue(data, "endDate") || null,
		annualIncrease: advanced ? 0 : numberValue(data, "annualIncrease"),
		enabled: textValue(data, "enabled") === "on",
		readOnly: false,
		claimRuleId,
		claimOccurrenceDate,
		postedDate: (textValue(data, "postedDate") || item?.postedDate) ?? null,
		void: item?.void ?? false,
		...(item?.purchasePriority != null
			? { purchasePriority: item.purchasePriority }
			: {}),
	};
	return {
		...plan,
		movements: upsertItem({ items: plan.movements, item: movement }),
	};
}

/** The movement fields without a form shell. State is keyed by field name so
 *  any owning form can read it through FormData on submit. */
export function MovementFormFields({
	item,
	plan,
}: {
	item: Movement | null;
	plan: Plan;
}) {
	const id = useId();
	const [noEndDate, setNoEndDate] = useState(item?.endDate == null);
	const [frequency, setFrequency] = useState(item?.frequency ?? "monthly");
	const isOnce = frequency === "once";
	const claimRules = plan.movements.filter(
		(movement) => movement.frequency !== "once" && movement.id !== item?.id,
	);
	const initialKind =
		item?.amountKnown === false
			? "advanced"
			: (item?.annualIncrease ?? 0) !== 0
				? "growth"
				: "fixed";
	const [amountKind, setAmountKind] = useState(initialKind);
	const templates = useAmountTemplates();
	const advanced = amountKind !== "fixed" && amountKind !== "growth";
	const templateForKind =
		templates.find((template) => template.id === amountKind) ??
		templates.find((template) => template.id === "fixed")!;
	return (
		<>
			<InputField
				label="Transaction name"
				wide
				name="name"
				required
				maxLength={100}
				defaultValue={item?.name ?? ""}
				placeholder="e.g. Monthly investing"
			/>
			<SelectField
				label="How is the amount calculated?"
				name="amountKind"
				value={amountKind}
				onChange={(event) => setAmountKind(event.target.value)}
			>
				<option value="fixed">Fixed amount</option>
				<option value="growth">Grows yearly by %</option>
				{templates
					.filter(
						(template) => template.id !== "fixed" && template.id !== "growth",
					)
					.map((template) => (
						<option key={template.id} value={template.id}>
							{template.label}
						</option>
					))}
				{item?.amountKnown === false && (
					<option value="advanced">Current calculated amount (keep)</option>
				)}
			</SelectField>
			{!advanced && (
				<p className="col-span-full text-xs text-muted">
					{templateForKind.summary}{" "}
					{templateForKind.whenToUse && (
						<span>Use when: {templateForKind.whenToUse}</span>
					)}
				</p>
			)}
			{!advanced ? (
				<>
					<InputField
						label="Amount (USD)"
						name="amount"
						type="number"
						required
						min="0.01"
						max="10000000000"
						step="0.01"
						defaultValue={
							item?.amountKnown === false ? "" : (item?.amount ?? 500)
						}
					/>
					{amountKind === "growth" && (
						<InputField
							label="Annual amount increase (%)"
							name="annualIncrease"
							type="number"
							required
							min="-50"
							max="50"
							step="0.1"
							defaultValue={item?.annualIncrease ?? 3}
						/>
					)}
					{amountKind === "fixed" && (
						<input type="hidden" name="annualIncrease" value="0" />
					)}
				</>
			) : (
				<>
					<input type="hidden" name="amount" value="0" />
					<input type="hidden" name="annualIncrease" value="0" />
					<Notice className="col-span-full">
						<span>
							{templates.some((template) => template.id === amountKind) ? (
								<>
									<strong>{templateForKind.label}.</strong>{" "}
									{templateForKind.summary} Builds exact values in Configs →
									Amounts. This entry stays as Varies.
								</>
							) : (
								<>
									This movement already uses a calculated amount. It stays as
									Varies and keeps its saved recipe.
								</>
							)}
						</span>
					</Notice>
				</>
			)}
			<SelectField
				label="Frequency"
				name="frequency"
				defaultValue={item?.frequency ?? "monthly"}
				onChange={(event) => {
					const next = parseUnion(event.target.value, [
						"monthly",
						"yearly",
						"once",
					] as const);
					if (next) setFrequency(next);
				}}
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
					<label
						htmlFor={`${id}-no-end-date`}
						className="flex min-h-11 items-center gap-3 text-sm text-muted"
					>
						<Checkbox
							id={`${id}-no-end-date`}
							name="noEndDate"
							checked={noEndDate}
							onChange={(event) => setNoEndDate(event.target.checked)}
						/>
						No end date
					</label>
				</>
			)}
			<label
				htmlFor={`${id}-enabled`}
				className="flex min-h-11 items-center gap-3 text-sm text-muted"
			>
				<Checkbox
					id={`${id}-enabled`}
					name="enabled"
					defaultChecked={item?.enabled ?? true}
				/>
				Include in projections
			</label>
		</>
	);
}

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
	return (
		<EditorForm
			{...props}
			title={item ? item.name : "Add planned transaction"}
			readOnlyReason={readOnlyReason}
			buildPlan={(data) => buildMovementPlan({ plan, item, data })}
		>
			<MovementFormFields item={item} plan={plan} />
		</EditorForm>
	);
}
