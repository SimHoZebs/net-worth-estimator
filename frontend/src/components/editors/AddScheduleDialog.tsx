import { useId, useMemo, useState } from "react";
import { createSchedule } from "@/api/generated/endpoints.ts";
import { visibleAccounts } from "../../domain/model.ts";
import { todayIso } from "../../domain/format.ts";
import { parseUnion } from "../../domain/guards.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import {
	refreshTransactions,
	useSchedules,
} from "../../state/workspaceResources.ts";
import { useSavedAccounts, useSavedStartDate } from "../../state/savedState.ts";
import {
	scheduleTermsBody,
	validateScheduleTerms,
	type ScheduleTerms,
} from "./transactionBodies.ts";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { EditorDialog } from "./EditorDialog.tsx";
import {
	EditorCheckbox,
	EditorField,
	EditorSelect,
	MoneyField,
} from "./editorFields.tsx";
import type { Frequency } from "../../api/contracts.ts";
import {
	SCHEDULE_AMOUNT_RECIPES,
	validateRecipe,
	type AmountFields,
} from "../../domain/scheduleAmounts.ts";
import { ScheduleAmountFields } from "./ScheduleAmountFields.tsx";

const frequencyOptions = [
	{ value: "daily", label: "Daily" },
	{ value: "weekly", label: "Weekly" },
	{ value: "monthly", label: "Monthly" },
	{ value: "quarterly", label: "Every 3 months" },
	{ value: "annual", label: "Yearly" },
] as const;

/** Create-only schedule form. Recurrence, growth, and the end date live here. */
export function AddScheduleDialog({
	onSaved,
	onClose,
}: {
	onSaved: () => void;
	onClose: () => void;
}) {
	const savedAccountsQuery = useSavedAccounts();
	const savedStartDate = useSavedStartDate();
	const savedAccounts = useMemo(
		() => visibleAccounts(savedAccountsQuery ?? []),
		[savedAccountsQuery],
	);
	const fallbackStart = savedStartDate ?? todayIso();
	const [name, setName] = useState("");
	const [amountKind, setAmountKind] = useState("fixed");
	const [amountDrafts, setAmountDrafts] = useState<
		Record<string, AmountFields>
	>({});
	const recipe = SCHEDULE_AMOUNT_RECIPES.find(
		(entry) => entry.id === amountKind,
	)!;
	const amountFields = amountDrafts[amountKind] ?? recipe.defaults;
	const schedules = useSchedules();
	const [annualCap, setAnnualCap] = useState("");
	const [priority, setPriority] = useState("");
	const sourceSchedule =
		amountKind === "schedule-percent"
			? schedules.data?.schedules.find(
					(entry) => entry.id === amountFields.reference,
				)
			: undefined;
	const automaticPriority = sourceSchedule
		? sourceSchedule.priority + 1
		: undefined;
	const effectivePriority =
		priority === "" ? automaticPriority : Number(priority);
	const [frequency, setFrequency] = useState<Frequency>("monthly");
	const [fromId, setFromId] = useState("");
	const [toId, setToId] = useState("");
	const [startDate, setStartDate] = useState(fallbackStart);
	const [noEndDate, setNoEndDate] = useState(true);
	const [endDate, setEndDate] = useState("");
	const [enabled, setEnabled] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const enabledId = useId();
	const noEndDateId = useId();
	const nameId = useId();
	const frequencyId = useId();
	const fromIdInput = useId();
	const toIdInput = useId();
	const firstId = useId();
	const lastId = useId();
	const annualCapId = useId();
	const annualCapHintId = `${annualCapId}-hint`;
	const priorityId = useId();
	const priorityHintId = `${priorityId}-hint`;

	const dirty =
		name !== "" ||
		Object.keys(amountDrafts).length > 0 ||
		amountKind !== "fixed" ||
		annualCap !== "" ||
		priority !== "" ||
		frequency !== "monthly" ||
		fromId !== "" ||
		toId !== "" ||
		startDate !== fallbackStart ||
		!noEndDate ||
		endDate !== "" ||
		!enabled;

	const submit = async () => {
		if (saving) return;
		const amountError = validateRecipe(recipe, amountFields);
		if (amountError) {
			setError(amountError);
			return;
		}
		const values: ScheduleTerms = {
			name: name.trim(),
			fromId: fromId || null,
			toId: toId || null,
			frequency,
			startDate,
			endDate: !noEndDate && endDate ? endDate : null,
			enabled,
		};
		const invalid = validateScheduleTerms(values);
		if (invalid) {
			setError(invalid);
			return;
		}
		if (
			(annualCap !== "" &&
				(!Number.isFinite(Number(annualCap)) ||
					Number(annualCap) < 0 ||
					Number(annualCap) > 1e10)) ||
			(effectivePriority !== undefined &&
				!Number.isSafeInteger(effectivePriority))
		) {
			setError("Review the annual cap and execution priority.");
			return;
		}
		setSaving(true);
		setError(null);
		const id = crypto.randomUUID();
		const ok = await performSave({
			call: () =>
				createSchedule({
					...scheduleTermsBody(values),
					amount: recipe.build(amountFields),
					id,
					...(effectivePriority !== undefined
						? { priority: effectivePriority }
						: {}),
					...(annualCap !== "" ? { annualCap: Number(annualCap) } : {}),
				}),
			refresh: refreshTransactions,
			failureMessage: "The schedule could not be saved.",
		});
		setSaving(false);
		if (ok) onSaved();
		else
			setError(
				"The schedule could not be saved. Review the workspace notice and try again.",
			);
	};

	return (
		<EditorDialog
			title="Add schedule"
			onClose={onClose}
			dirty={dirty}
			busy={saving}
			error={error}
			submitLabel="Add schedule"
			submitDisabled={!dirty}
			onSubmit={() => void submit()}
		>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<fieldset
					disabled={saving}
					className="m-0 grid grid-cols-2 gap-5 border-0 p-0 max-sm:grid-cols-1"
				>
					<EditorField
						label="Schedule name"
						htmlFor={nameId}
						className="col-span-full"
					>
						<Input
							id={nameId}
							required
							maxLength={100}
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="e.g. Monthly investing"
							disabled={saving}
						/>
					</EditorField>
					<div className="col-span-full">
						<ScheduleAmountFields
							recipeId={amountKind}
							values={amountFields}
							accounts={savedAccounts}
							schedules={schedules.data?.schedules ?? []}
							onRecipe={(id) => {
								setAmountKind(id);
								setError(null);
							}}
							onChange={(key, value) => {
								setAmountDrafts((old) => ({
									...old,
									[amountKind]: { ...amountFields, [key]: value },
								}));
								setError(null);
							}}
						/>
						{sourceSchedule && (
							<div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
								<span className="text-muted-foreground">
									Source starts {sourceSchedule.startDate} ·{" "}
									{sourceSchedule.frequency}
								</span>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => {
										const next = parseUnion(sourceSchedule.frequency, [
											"daily",
											"weekly",
											"monthly",
											"quarterly",
											"annual",
										] as const);
										if (next) setFrequency(next);
										setStartDate(sourceSchedule.startDate);
										setEndDate(sourceSchedule.endDate ?? "");
										setNoEndDate(!sourceSchedule.endDate);
									}}
								>
									Use source timing
								</Button>
							</div>
						)}
						{amountKind === "schedule-percent" && schedules.isPending && (
							<p role="status">Loading schedules…</p>
						)}
						{amountKind === "schedule-percent" && schedules.isError && (
							<Alert variant="destructive">
								<AlertDescription>
									Schedules could not be loaded.{" "}
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() => void schedules.refetch()}
									>
										Retry
									</Button>
								</AlertDescription>
							</Alert>
						)}
					</div>
					<EditorField label="Frequency" htmlFor={frequencyId}>
						<EditorSelect
							id={frequencyId}
							value={frequency}
							onValueChange={(next) => {
								const parsed = parseUnion(next, [
									"daily",
									"weekly",
									"monthly",
									"quarterly",
									"annual",
								] as const);
								if (parsed) setFrequency(parsed);
							}}
							options={[...frequencyOptions]}
							disabled={saving}
						/>
					</EditorField>
					<EditorField label="From" htmlFor={fromIdInput}>
						<EditorSelect
							id={fromIdInput}
							value={fromId}
							onValueChange={setFromId}
							emptyLabel="External income"
							options={savedAccounts
								.filter((account) => account.kind !== "debt")
								.map((account) => ({
									value: account.id,
									label: account.name,
								}))}
							disabled={saving}
						/>
					</EditorField>
					<EditorField label="To" htmlFor={toIdInput}>
						<EditorSelect
							id={toIdInput}
							value={toId}
							onValueChange={setToId}
							emptyLabel="External expense"
							options={savedAccounts.map((account) => ({
								value: account.id,
								label: account.name,
							}))}
							disabled={saving}
						/>
					</EditorField>
					<EditorField label="First occurrence" htmlFor={firstId}>
						<Input
							id={firstId}
							type="date"
							required
							value={startDate}
							onChange={(event) => setStartDate(event.target.value)}
							disabled={saving}
						/>
					</EditorField>
					<EditorField label="Last occurrence" htmlFor={lastId}>
						<Input
							id={lastId}
							type="date"
							disabled={saving || noEndDate}
							value={endDate}
							onChange={(event) => setEndDate(event.target.value)}
						/>
					</EditorField>
					<EditorCheckbox
						id={noEndDateId}
						label="No end date"
						checked={noEndDate}
						onChange={setNoEndDate}
						disabled={saving}
					/>
					<EditorCheckbox
						id={enabledId}
						label="Include in projections"
						checked={enabled}
						onChange={setEnabled}
						disabled={saving}
					/>
					<details className="col-span-full text-sm">
						<summary className="cursor-pointer py-2 font-semibold">
							Limits and execution order
						</summary>
						<div className="mt-3 grid grid-cols-2 gap-4 max-sm:grid-cols-1">
							<MoneyField
								id={annualCapId}
								label="Annual cap"
								name="annualCap"
								min="0"
								max="10000000000"
								step="0.01"
								value={annualCap}
								onChange={(event) => setAnnualCap(event.target.value)}
								placeholder="No cap"
								aria-describedby={annualCapHintId}
								hint="Caps this schedule only. It does not enforce a shared contribution limit."
								hintId={annualCapHintId}
								disabled={saving}
							/>
							<EditorField
								label="Execution priority"
								htmlFor={priorityId}
								hint="Lower numbers run first on shared dates. Automatic runs after the selected source, or appends after existing schedules."
								hintId={priorityHintId}
							>
								<Input
									id={priorityId}
									name="priority"
									type="number"
									step="1"
									value={priority}
									placeholder={
										automaticPriority === undefined
											? "Automatic: after existing schedules"
											: `Automatic: ${automaticPriority}`
									}
									onChange={(event) => setPriority(event.target.value)}
									aria-describedby={priorityHintId}
									disabled={saving}
								/>
							</EditorField>
						</div>
					</details>
				</fieldset>
			</div>
		</EditorDialog>
	);
}
