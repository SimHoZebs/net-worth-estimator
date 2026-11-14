import { useId, useMemo, useState, type FormEvent } from "react";
import { createSchedule } from "@/api/generated/endpoints.ts";
import { visibleAccounts } from "../../domain/model.ts";
import { todayIso } from "../../domain/format.ts";
import { parseUnion } from "../../domain/guards.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
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
import { Field, FieldDescription } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Button } from "@/components/ui/button.tsx";

const fieldLabelClassName = "text-sm leading-normal font-semibold text-muted";
const fieldHintClassName = "text-xs leading-relaxed text-muted";
const fieldInputClassName =
	"h-11 bg-input-bg px-3 text-base text-ink placeholder:text-subtle disabled:bg-transparent focus-visible:outline-solid focus-visible:ring-0";
const fieldSelectClassName =
	"h-11 w-full rounded-control border border-solid border-line-strong bg-input-bg px-3 py-2 text-base font-normal text-ink placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-60";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";
import type { Frequency } from "../../api/contracts.ts";
import {
	SCHEDULE_AMOUNT_RECIPES,
	validateRecipe,
	type AmountFields,
} from "../../domain/scheduleAmounts.ts";
import { ScheduleAmountFields } from "./ScheduleAmountFields.tsx";

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
	useBeforeUnload(dirty && !saving);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
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
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>Add schedule</DialogTitle>
				</DialogHeader>
				<form
					className="flex h-full min-h-0 flex-col gap-4"
					onSubmit={(event) => void submit(event)}
				>
					<div className="min-h-0 flex-1 overflow-y-auto">
						<fieldset
							disabled={saving}
							className="m-0 grid grid-cols-2 gap-5 border-0 p-0 max-sm:grid-cols-1 max-sm:gap-x-3 max-sm:gap-y-4"
						>
							<Field className="col-span-full flex min-w-0 flex-col gap-2">
								<Label htmlFor={nameId} className={fieldLabelClassName}>
									Schedule name
								</Label>
								<Input
									id={nameId}
									required
									maxLength={100}
									value={name}
									onChange={(event) => setName(event.target.value)}
									placeholder="e.g. Monthly investing"
									className={fieldInputClassName}
								/>
							</Field>
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
										<span className="text-muted">
											Source starts {sourceSchedule.startDate} ·{" "}
											{sourceSchedule.frequency}
										</span>
										<Button
											type="button"
											variant="secondary"
											size="sm"
											className="min-h-9 border-line-strong bg-surface px-3 py-2 text-xs leading-snug text-ink enabled:hover:bg-hover focus-visible:outline-solid focus-visible:ring-0"
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
									<p role="alert">
										Schedules could not be loaded.{" "}
										<Button
											type="button"
											variant="secondary"
											className="min-h-10 border-line-strong bg-surface px-4 py-2 text-sm leading-snug text-ink enabled:hover:bg-hover focus-visible:outline-solid focus-visible:ring-0"
											onClick={() => void schedules.refetch()}
										>
											Retry
										</Button>
									</p>
								)}
							</div>
							<Field className="flex min-w-0 flex-col gap-2">
								<Label htmlFor={frequencyId} className={fieldLabelClassName}>
									Frequency
								</Label>
								<select
									id={frequencyId}
									value={frequency}
									onChange={(event) => {
										const next = parseUnion(event.target.value, [
											"daily",
											"weekly",
											"monthly",
											"quarterly",
											"annual",
										] as const);
										if (next) setFrequency(next);
									}}
									className={fieldSelectClassName}
								>
									<option value="daily">Daily</option>
									<option value="weekly">Weekly</option>
									<option value="monthly">Monthly</option>
									<option value="quarterly">Every 3 months</option>
									<option value="annual">Yearly</option>
								</select>
							</Field>
							<Field className="flex min-w-0 flex-col gap-2">
								<Label htmlFor={fromIdInput} className={fieldLabelClassName}>
									From
								</Label>
								<select
									id={fromIdInput}
									value={fromId}
									onChange={(event) => setFromId(event.target.value)}
									className={fieldSelectClassName}
								>
									<option value="">External income</option>
									{savedAccounts
										.filter((account) => account.kind !== "debt")
										.map((account) => (
											<option key={account.id} value={account.id}>
												{account.name}
											</option>
										))}
								</select>
							</Field>
							<Field className="flex min-w-0 flex-col gap-2">
								<Label htmlFor={toIdInput} className={fieldLabelClassName}>
									To
								</Label>
								<select
									id={toIdInput}
									value={toId}
									onChange={(event) => setToId(event.target.value)}
									className={fieldSelectClassName}
								>
									<option value="">External expense</option>
									{savedAccounts.map((account) => (
										<option key={account.id} value={account.id}>
											{account.name}
										</option>
									))}
								</select>
							</Field>
							<Field className="flex min-w-0 flex-col gap-2">
								<Label htmlFor={firstId} className={fieldLabelClassName}>
									First occurrence
								</Label>
								<Input
									id={firstId}
									type="date"
									required
									value={startDate}
									onChange={(event) => setStartDate(event.target.value)}
									className={fieldInputClassName}
								/>
							</Field>
							<Field className="flex min-w-0 flex-col gap-2">
								<Label htmlFor={lastId} className={fieldLabelClassName}>
									Last occurrence
								</Label>
								<Input
									id={lastId}
									type="date"
									disabled={noEndDate}
									value={endDate}
									onChange={(event) => setEndDate(event.target.value)}
									className={fieldInputClassName}
								/>
							</Field>
							<label
								htmlFor={noEndDateId}
								className="flex min-h-11 items-center gap-3 text-sm text-muted"
							>
								<input
									id={noEndDateId}
									type="checkbox"
									checked={noEndDate}
									onChange={(event) => setNoEndDate(event.target.checked)}
									className="m-0 size-5 flex-none cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-60"
								/>
								No end date
							</label>
							<label
								htmlFor={enabledId}
								className="flex min-h-11 items-center gap-3 text-sm text-muted"
							>
								<input
									id={enabledId}
									type="checkbox"
									checked={enabled}
									onChange={(event) => setEnabled(event.target.checked)}
									className="m-0 size-5 flex-none cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-60"
								/>
								Include in projections
							</label>
							<details className="col-span-full text-sm">
								<summary className="cursor-pointer py-2 font-semibold">
									Limits and execution order
								</summary>
								<div className="mt-3 grid grid-cols-2 gap-4 max-sm:grid-cols-1">
									<Field className="flex min-w-0 flex-col gap-2">
										<Label
											htmlFor={annualCapId}
											className={fieldLabelClassName}
										>
											Annual cap (USD)
										</Label>
										<Input
											id={annualCapId}
											name="annualCap"
											type="number"
											min="0"
											max="10000000000"
											step="0.01"
											value={annualCap}
											onChange={(event) => setAnnualCap(event.target.value)}
											placeholder="No cap"
											aria-describedby={annualCapHintId}
											className={fieldInputClassName}
										/>
										<FieldDescription
											id={annualCapHintId}
											className={fieldHintClassName}
										>
											Caps this schedule only. It does not enforce a shared
											contribution limit.
										</FieldDescription>
									</Field>
									<Field className="flex min-w-0 flex-col gap-2">
										<Label htmlFor={priorityId} className={fieldLabelClassName}>
											Execution priority
										</Label>
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
											className={fieldInputClassName}
										/>
										<FieldDescription
											id={priorityHintId}
											className={fieldHintClassName}
										>
											Lower numbers run first on shared dates. Automatic runs
											after the selected source, or appends after existing
											schedules.
										</FieldDescription>
									</Field>
								</div>
							</details>
						</fieldset>
					</div>
					<div className="mt-6 flex shrink-0 flex-wrap items-center justify-end gap-3 border-0 border-t border-solid border-line pt-5">
						<div className="min-w-0 flex-1 basis-48 max-sm:basis-full">
							{error && (
								<p
									role="alert"
									className="m-0 shrink-0 overflow-auto text-sm leading-relaxed text-danger-text"
								>
									{error}
								</p>
							)}
						</div>
						<Button
							type="button"
							variant="secondary"
							className="min-h-10 border-line-strong bg-surface px-4 py-2 text-sm leading-snug text-ink enabled:hover:bg-hover focus-visible:outline-solid focus-visible:ring-0"
							onClick={onClose}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="secondary"
							className="min-h-10 border-line-strong bg-surface px-4 py-2 text-sm leading-snug text-ink enabled:hover:bg-hover focus-visible:outline-solid focus-visible:ring-0"
							disabled={saving || !dirty}
						>
							{saving ? "Saving…" : "Add schedule"}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
