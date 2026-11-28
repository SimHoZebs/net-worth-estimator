import { useCallback, useId, useMemo, useState } from "react";
import { createSchedule } from "@/api/generated/endpoints.ts";
import { isGroupedDisplay } from "../../domain/accountDisplay.ts";
import { isLiability } from "../../domain/accountKinds.ts";
import { visibleAccounts } from "../../domain/model.ts";
import { todayIso } from "../../domain/format.ts";
import {
	ensureStartWeekday,
	recurrenceEqual,
	recurrenceFromScheduleLike,
	recurrenceSentence,
	type Recurrence,
} from "../../domain/recurrence.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import {
	refreshTransactions,
	useSchedules,
	useTransactionCatalog,
} from "../../state/workspaceResources.ts";
import { useSavedAccounts, useSavedStartDate } from "../../state/savedState.ts";
import {
	toGeneratedAmountResolution,
	type TransactionAmountResolution,
} from "../../api/contracts.ts";
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
import { RecurrenceFields } from "./RecurrenceFields.tsx";
import { templateFieldsFromAmount } from "./amountDraft.ts";
import { AmountBuilder } from "./AmountBuilder.tsx";
import { useAmountTemplates } from "./amountTemplates.ts";
import { validateScheduleAmountDraft } from "../../domain/scheduleAmountValidation.ts";

const DEFAULT_RECURRENCE: Recurrence = {
	unit: "month",
	interval: 1,
	monthlyMode: "byDate",
};

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
	const [error, setError] = useState<string | null>(null);
	const templates = useAmountTemplates();
	const [amountTemplateId, setAmountTemplateId] = useState("fixed");
	const initialTemplate =
		templates.find((entry) => entry.id === amountTemplateId) ?? templates[0];
	const [amount, setAmount] = useState<TransactionAmountResolution | null>(
		initialTemplate?.amount ?? null,
	);
	const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
	const schedules = useSchedules();
	const catalog = useTransactionCatalog();
	const amountAccounts = useMemo(() => {
		const assetTemplate =
			amountTemplateId === "account-percent" ||
			amountTemplateId === "investment-growth";
		const debtTemplate = amountTemplateId === "owed-balance";
		const accounts =
			assetTemplate || debtTemplate
				? savedAccounts.filter(
						(account) =>
							!isGroupedDisplay(account) &&
							isLiability(account) === debtTemplate,
					)
				: savedAccounts;
		return accounts.map((account) => ({
			id: account.id,
			name: account.name,
			kind: account.kind,
		}));
	}, [amountTemplateId, savedAccounts]);
	const amountSchedules = useMemo(
		() =>
			(schedules.data?.schedules ?? []).map((schedule) => ({
				id: schedule.id,
				name: schedule.name,
			})),
		[schedules.data],
	);
	const amountTransactions = useMemo(
		() =>
			(catalog.data?.items ?? []).map((transaction) => ({
				id: transaction.id,
				name: transaction.name,
			})),
		[catalog.data],
	);
	const amountFields = {
		...templateFieldsFromAmount(amountTemplateId, initialTemplate?.amount),
		...amountDrafts,
	};
	const changeAmountTemplate = useCallback(
		(id: string) => {
			if (id !== amountTemplateId) setAmountDrafts({});
			setAmountTemplateId(id);
			setError(null);
		},
		[amountTemplateId],
	);
	const changeAmount = useCallback((next: TransactionAmountResolution) => {
		setAmount(next);
		setError(null);
	}, []);
	const changeAmountFields = useCallback((fields: Record<string, string>) => {
		setAmountDrafts(fields);
		setError(null);
	}, []);
	const sourceSchedule =
		amountTemplateId === "schedule-percent"
			? schedules.data?.schedules.find(
					(entry) => entry.id === amountFields.reference,
				)
			: undefined;
	const [annualCap, setAnnualCap] = useState("");
	const [priority, setPriority] = useState("");
	const automaticPriority = sourceSchedule
		? sourceSchedule.priority + 1
		: undefined;
	const effectivePriority =
		priority === "" ? automaticPriority : Number(priority);
	const [recurrence, setRecurrence] = useState<Recurrence>(DEFAULT_RECURRENCE);
	const [fromId, setFromId] = useState("");
	const [toId, setToId] = useState("");
	const [startDate, setStartDate] = useState(fallbackStart);
	const changeStartDate = (next: string) => {
		setStartDate(next);
		setRecurrence((current) => ensureStartWeekday(current, next));
	};
	const [noEndDate, setNoEndDate] = useState(true);
	const [endDate, setEndDate] = useState("");
	const [enabled, setEnabled] = useState(true);
	const [saving, setSaving] = useState(false);
	const enabledId = useId();
	const noEndDateId = useId();
	const nameId = useId();
	const fromIdInput = useId();
	const toIdInput = useId();
	const firstId = useId();
	const lastId = useId();
	const recurrenceId = useId();
	const annualCapId = useId();
	const annualCapHintId = `${annualCapId}-hint`;
	const priorityId = useId();
	const priorityHintId = `${priorityId}-hint`;

	const amountChanged =
		amount !== null &&
		JSON.stringify(amount) !== JSON.stringify(initialTemplate?.amount);
	const dirty =
		name !== "" ||
		Object.keys(amountDrafts).length > 0 ||
		amountChanged ||
		amountTemplateId !== "fixed" ||
		annualCap !== "" ||
		priority !== "" ||
		!recurrenceEqual(recurrence, DEFAULT_RECURRENCE) ||
		fromId !== "" ||
		toId !== "" ||
		startDate !== fallbackStart ||
		!noEndDate ||
		endDate !== "" ||
		!enabled;

	const submit = async () => {
		if (saving) return;
		const amountError = validateScheduleAmountDraft({
			templateId: amountTemplateId,
			fields: amountFields,
			accounts: savedAccounts,
			schedules: schedules.data?.schedules ?? [],
		});
		if (amountError) {
			setError(amountError);
			return;
		}
		if (!amount) {
			setError("Choose an amount.");
			return;
		}
		const values: ScheduleTerms = {
			name: name.trim(),
			fromId: fromId || null,
			toId: toId || null,
			recurrence,
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
					amount: toGeneratedAmountResolution(amount),
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
						<AmountBuilder
							accounts={amountAccounts}
							transactions={amountTransactions}
							schedules={amountSchedules}
							templates={templates}
							initialTemplateId={amountTemplateId}
							fields={amountDrafts}
							onFieldsChange={changeAmountFields}
							onTemplateChange={changeAmountTemplate}
							onAmountChange={changeAmount}
						/>
						{sourceSchedule && (
							<div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
								<span className="text-muted-foreground">
									Source starts {sourceSchedule.startDate} ·{" "}
									{(() => {
										const sourceRecurrence =
											recurrenceFromScheduleLike(sourceSchedule);
										return sourceRecurrence
											? recurrenceSentence(
													sourceRecurrence,
													sourceSchedule.startDate,
												)
											: "Recurring schedule";
									})()}
								</span>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => {
										const next = recurrenceFromScheduleLike(sourceSchedule);
										if (next) setRecurrence(next);
										changeStartDate(sourceSchedule.startDate);
										setEndDate(sourceSchedule.endDate ?? "");
										setNoEndDate(!sourceSchedule.endDate);
									}}
								>
									Use source timing
								</Button>
							</div>
						)}
						{amountTemplateId === "schedule-percent" && schedules.isPending && (
							<p role="status">Loading schedules…</p>
						)}
						{amountTemplateId === "schedule-percent" && schedules.isError && (
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
					<div className="col-span-full">
						<RecurrenceFields
							recurrence={recurrence}
							startDate={startDate}
							onChange={setRecurrence}
							disabled={saving}
							idPrefix={recurrenceId}
						/>
					</div>
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
							onChange={(event) => changeStartDate(event.target.value)}
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
								hint="Schedule-only cap, not a shared contribution limit."
								hintId={annualCapHintId}
								disabled={saving}
							/>
							<EditorField
								label="Execution priority"
								htmlFor={priorityId}
								hint="Lower numbers run first on the same date. Automatic runs after the selected source, otherwise after existing schedules."
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
