import { useEditDraft } from "../editors/useEditDraft.ts";
import {
	ArrowDown,
	ArrowDownLeft,
	ArrowRightLeft,
	ArrowUpRight,
	CalendarDays,
	Check,
	Clock3,
	Eye,
	EyeOff,
	Link2,
	LockKeyhole,
	Repeat,
	Trash2,
	TriangleAlert,
	UsersRound,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
	useId,
	useMemo,
	useRef,
	useState,
	type FormEvent,
	type ReactNode,
} from "react";
import {
	scheduleTransaction,
	type AccountTransaction,
} from "../../domain/accountActivity.ts";
import { claimOccurrenceCandidates } from "../../domain/ruleSchedule.ts";
import { dateLabel, todayIso } from "../../domain/format.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { AccountIconFallback } from "./AccountIconFallback.tsx";
import { parseUnion } from "../../domain/guards.ts";
import {
	visibleAccounts,
	type Account,
	type Transaction,
} from "../../domain/model.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import { serverQueryClient } from "../../state/serverQuery.ts";
import { AccountIcon } from "../AccountIcon.tsx";
import { ActionMenu, type ActionMenuItem } from "../ActionMenu.tsx";
import { Badge } from "../Badge.tsx";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { FieldError } from "../ErrorNotice.tsx";
import { Modal } from "../Modal.tsx";
import { TextButton } from "../Button.tsx";
import { Notice } from "../Notice.tsx";
import { Checkbox, Input, InputField, Select } from "../Field.tsx";
import { transactionIconStyles } from "./activityStyles.ts";
import { TransactionDateModal } from "./TransactionDateModal.tsx";
import {
	transactionControlStyles,
	detailPropertyRowClassName,
	detailPropertyLabelClassName,
	detailFooterClassName,
} from "./transactionDetailStyles.ts";
import { DetailEditActions, DiscardConfirm } from "./DetailEditActions.tsx";
import {
	amendSchedule,
	amendTransaction,
	claimOccurrence,
	deleteSchedule,
	deleteTransaction,
	endScheduleWithTransaction,
	releaseOccurrence,
	rescheduleSchedule,
	scheduleFromTransaction,
} from "@/api/generated/endpoints.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import {
	removeDeletedTransactionFromCache,
	transactionRemovalNeedsProjectionRefresh,
} from "../../state/transactionCache.ts";
import type { SettleCandidateRow } from "@/api/generated/model/settleCandidateRow.ts";
import { frequencyLabel } from "../../domain/recurringPatterns.ts";
import {
	refreshTransactions,
	schedulesOptions,
	useSchedules,
} from "../../state/workspaceResources.ts";
import { AccountOptions } from "../editors/AccountOptions.tsx";
import {
	claimUpdate,
	detailTransactionValues,
	detailScheduleValues,
	transactionUpdate,
	scheduleUpdate,
	timeOfDay,
} from "../editors/transactionBodies.ts";
import type { Frequency } from "@/api/contracts.ts";
import { ReceiptPanel } from "../receipts/ReceiptPanel.tsx";
import { TransactionAnalysisPanel } from "../analysis/TransactionAnalysis.tsx";
import { scheduleHistoryTransactions } from "../../domain/scheduleHistory.ts";
import { ScheduleHistory } from "./ScheduleHistory.tsx";
import { TransactionCategory } from "./TransactionCategory.tsx";
import { TransactionSharing } from "./TransactionSharing.tsx";
import {
	buildInsightSuggestions,
	TransactionInsightsPanel,
	TransactionInsightsTrigger,
} from "./TransactionInsights.tsx";
import { useAnalysisFindings } from "../../state/analyses.ts";
import {
	useSavedSchedules,
	useSavedTransactions,
} from "../../state/savedState.ts";
import { scheduleToDisplay } from "../../domain/transactionRows.ts";
import { useSharingGrants } from "../../state/sharing.ts";
import { useSettleCandidates } from "../../state/settleCandidates.ts";

type AccountRef = Pick<Account, "id" | "kind" | "color" | "name">;

const EMPTY_SETTLE_CANDIDATES: SettleCandidateRow[] = [];

/**
 * The detail opens above drawers that portal to document.body. Rendering the
 * native dialog as a sibling keeps React's cancel path flat: the browser
 * sends Escape only to the topmost dialog, and Modal stops cancel
 * propagation so the drawer beneath never starts closing with it.
 */
function DetailPortal({ children }: { children: ReactNode }) {
	return createPortal(children, document.body);
}

function DirectionIcon({
	kind,
	size = 16,
}: {
	kind: "in" | "out" | "transfer";
	size?: number;
}) {
	const Icon =
		kind === "transfer"
			? ArrowRightLeft
			: kind === "in"
				? ArrowDownLeft
				: ArrowUpRight;
	return <Icon size={size} aria-hidden="true" />;
}

function accountFor(
	accounts: AccountRef[],
	id: string | null,
): AccountRef | null {
	if (!id) return null;
	return accounts.find((account) => account.id === id) ?? null;
}

function associatedAccountLabel({
	fromAccount,
	toAccount,
	transaction,
}: {
	fromAccount: AccountRef | null;
	toAccount: AccountRef | null;
	transaction: AccountTransaction;
}): string {
	const fromFallback =
		transaction.from && transaction.from !== "External income"
			? transaction.from
			: null;
	const toFallback =
		transaction.to && transaction.to !== "External spending"
			? transaction.to
			: null;
	const names = [
		fromAccount?.name ?? fromFallback,
		toAccount?.name ?? toFallback,
	].filter((name): name is string => Boolean(name));
	const unique = [...new Set(names)];
	return unique.join(" → ");
}

function MoreOptions({
	savedTransaction,
	transactions,
	draft,
	updateDraft,
	locked,
	categoryReadOnly,
	occurrenceOptions,
}: {
	savedTransaction: Transaction;
	transactions: Transaction[];
	draft: TransactionDraft;
	updateDraft: (patch: Partial<TransactionDraft>, field: EditField) => void;
	locked: boolean;
	categoryReadOnly: boolean;
	/** Scheduled dates of the selected rule, closest to the posted day first. */
	occurrenceOptions: string[];
}) {
	const id = useId();
	const claimSchedules = transactions.filter(
		(item) => item.kind === "schedule" && item.id !== savedTransaction.id,
	);
	const claimEditable = !locked || canClaimOccurrence(savedTransaction);
	const frequencyId = `${id}-frequency`;
	const annualIncreaseId = `${id}-annual-increase`;
	const claimScheduleId = `${id}-claim-rule`;
	const claimOccurrenceId = `${id}-claim-occurrence`;
	const rowLabel = detailPropertyLabelClassName;
	const schedule = savedTransaction.kind === "schedule";
	return (
		<section
			aria-label="Transaction options"
			className="mt-4 border-t border-line"
		>
			<div className="flex flex-col">
				{!schedule && (
					<TransactionCategory
						transactionId={savedTransaction.id}
						category={savedTransaction.category}
						source={savedTransaction.categorySource}
						readOnly={categoryReadOnly}
						labelClassName={rowLabel}
					/>
				)}
				{schedule && (
					<>
						<div className={detailPropertyRowClassName}>
							<label htmlFor={frequencyId} className={rowLabel}>
								Frequency
							</label>
							<Select
								id={frequencyId}
								name="frequency"
								disabled={locked}
								value={draft.frequency ?? "monthly"}
								onChange={(event) => {
									const next = parseUnion(event.target.value, [
										"daily",
										"weekly",
										"monthly",
										"quarterly",
										"annual",
									] as const);
									if (next) updateDraft({ frequency: next }, "schedule");
								}}
								className="min-w-0 flex-1"
							>
								<option value="daily">Daily</option>
								<option value="weekly">Weekly</option>
								<option value="monthly">Monthly</option>
								<option value="quarterly">Every 3 months</option>
								<option value="annual">Yearly</option>
							</Select>
						</div>
						<div className={detailPropertyRowClassName}>
							<label htmlFor={annualIncreaseId} className={rowLabel}>
								Annual amount increase (%)
							</label>
							<Input
								id={annualIncreaseId}
								name="annualIncrease"
								type="number"
								required
								disabled={locked || savedTransaction.amountKnown === false}
								min="-50"
								max="50"
								step="0.1"
								value={draft.annualIncrease}
								onChange={(event) =>
									updateDraft(
										{ annualIncrease: event.target.value },
										"schedule",
									)
								}
								className="min-w-0 flex-1"
							/>
						</div>
					</>
				)}
				{!schedule && (
					<>
						<div className={detailPropertyRowClassName}>
							<span className={rowLabel}>Records an occurrence of</span>
							<div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
								<Select
									id={claimScheduleId}
									aria-label="Records an occurrence of"
									name="claimScheduleId"
									disabled={!claimEditable}
									value={draft.claimScheduleId}
									onChange={(event) =>
										updateDraft(
											{ claimScheduleId: event.target.value },
											"schedule",
										)
									}
									className="min-w-0 flex-1"
								>
									<option value="">No link — standalone record</option>
									{claimSchedules.map((rule) => (
										<option key={rule.id} value={rule.id}>
											{rule.name}
										</option>
									))}
								</Select>
								<span
									className="text-xs font-semibold text-muted"
									aria-hidden="true"
								>
									on
								</span>
								<Select
									id={claimOccurrenceId}
									aria-label="Replaces occurrence on"
									name="claimOccurrenceDate"
									disabled={!claimEditable || !draft.claimScheduleId}
									value={draft.claimOccurrenceDate}
									onChange={(event) =>
										updateDraft(
											{ claimOccurrenceDate: event.target.value },
											"schedule",
										)
									}
									className="min-w-0 flex-1"
								>
									<option value="">
										{!draft.claimScheduleId
											? "Choose a schedule first"
											: occurrenceOptions.length === 0
												? "No claimable occurrences"
												: "Choose the occurrence"}
									</option>
									{occurrenceOptions.map((date) => (
										<option key={date} value={date}>
											{dateLabel(date, true)}
										</option>
									))}
								</Select>
							</div>
						</div>
					</>
				)}
			</div>
		</section>
	);
}

/**
 * Schedule stated only for recurring rules: one-time transactions need no
 * label. The sentence is always the same elements: frequency text, date
 * controls, and the growth note. Read mode is an attribute flip
 * (readOnly/disabled/armed styling); only the end-date control collapses
 * to the word "ongoing" when there is no end date, since an empty date
 * input reads as broken.
 */
function ScheduleCapsule({
	savedTransaction,
	draft,
	updateDraft,
	claimScheduleName,
	scheduleCadence,
	editing,
	locked,
	scheduleControlId,
	occurrenceOptions,
}: {
	savedTransaction: Transaction;
	draft: TransactionDraft;
	updateDraft: (patch: Partial<TransactionDraft>, field: EditField) => void;
	claimScheduleName?: string | null;
	/** Stored cadence from the raw rule, shown while it loads. */
	scheduleCadence?: string | null;
	editing: boolean;
	locked: boolean;
	/** DOM id for the first schedule control. */
	scheduleControlId?: string;
	/** Scheduled dates of the selected rule, closest to the posted day first. */
	occurrenceOptions: string[];
}) {
	const id = useId();
	const claimEditable = !locked || canClaimOccurrence(savedTransaction);
	if (savedTransaction.kind === "transaction") {
		if (!draft.claimScheduleId) return null;
		return (
			<p className="mt-4 flex items-center gap-2 text-xs leading-[1.6] text-muted">
				<Link2 size={15} aria-hidden="true" />
				<span>
					Replaces{" "}
					<select
						className={transactionControlStyles({
							element: "select",
							shape: "compact",
						})}
						aria-label="Records an occurrence of"
						name="claimScheduleId"
						disabled={!claimEditable}
						value={draft.claimScheduleId}
						onChange={(event) =>
							updateDraft({ claimScheduleId: event.target.value }, "schedule")
						}
					>
						<option value="">No link</option>
						{draft.claimScheduleId && (
							<option value={draft.claimScheduleId}>
								{claimScheduleName ?? draft.claimScheduleId}
							</option>
						)}
					</select>{" "}
					on{" "}
					<select
						className={transactionControlStyles({
							element: "select",
							shape: "compact",
						})}
						aria-label="Replaces occurrence on"
						name="claimOccurrenceDate"
						disabled={!claimEditable}
						value={draft.claimOccurrenceDate}
						onChange={(event) =>
							updateDraft(
								{ claimOccurrenceDate: event.target.value },
								"schedule",
							)
						}
					>
						<option value="">Choose a date</option>
						{occurrenceOptions.map((date) => (
							<option key={date} value={date}>
								{dateLabel(date, true)}
							</option>
						))}
					</select>
				</span>
			</p>
		);
	}
	const annualIncrease = Number(draft.annualIncrease) || 0;
	const growth =
		annualIncrease === 0
			? null
			: ` · ${annualIncrease > 0 ? "+" : ""}${annualIncrease}% yearly`;
	return (
		<div className="mt-5 rounded-surface bg-surface-2 p-4">
			<div className="flex items-center gap-3 text-muted">
				<Repeat size={16} aria-hidden="true" />
				<div className="flex min-w-0 flex-col gap-0.5">
					<strong className="text-sm font-semibold text-ink">
						Recurring schedule
					</strong>
					<span className="text-xs text-muted">
						{scheduleCadence ?? "Recurring schedule"}
						{growth}
					</span>
				</div>
			</div>
			<div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
				<input
					className={transactionControlStyles()}
					id={scheduleControlId}
					aria-label="First occurrence"
					type="date"
					name="startDate"
					required
					readOnly={locked}
					value={draft.startDate}
					onChange={(event) =>
						updateDraft({ startDate: event.target.value }, "schedule")
					}
				/>{" "}
				→{" "}
				{draft.noEndDate && !editing ? (
					"ongoing"
				) : (
					<input
						className={transactionControlStyles()}
						aria-label="Last occurrence"
						type="date"
						name="endDate"
						disabled={draft.noEndDate || locked}
						readOnly={locked}
						value={draft.endDate}
						onChange={(event) =>
							updateDraft({ endDate: event.target.value }, "schedule")
						}
					/>
				)}{" "}
				{editing && (
					<label
						htmlFor={`${id}-no-end-date`}
						className="inline-flex items-center gap-1 whitespace-nowrap"
					>
						<Checkbox
							id={`${id}-no-end-date`}
							name="noEndDate"
							disabled={locked}
							checked={draft.noEndDate}
							onChange={(event) =>
								updateDraft({ noEndDate: event.target.checked }, "schedule")
							}
						/>
						No end date
					</label>
				)}
			</div>
		</div>
	);
}

function ReadOnlyNotice({
	savedTransaction,
	appReadOnly,
}: {
	savedTransaction: Transaction;
	appReadOnly?: boolean;
}) {
	// Void holds carry a notice because the hold vanished without a posted
	// charge. The row is editable and can be restored.
	if (!savedTransaction.void) return null;
	return (
		<Notice className="my-4">
			<LockKeyhole size={18} className="mt-px" aria-hidden="true" />
			This hold vanished without a posted charge. You can edit it or
			restore it as a settled record.
			{!appReadOnly &&
				" If it posted after all, pick the posted charge below and remove this record."}
		</Notice>
	);
}
function readOnlyReasonFor(savedTransaction: Transaction): string | undefined {
	return savedTransaction.amountKnown === false &&
		savedTransaction.kind !== "schedule"
		? "This amount is calculated each time. See the transaction list for the resolved amounts."
		: savedTransaction.readOnly
			? "Read-only."
			: undefined;
}

/**
 * In-place edit state for the detail dialog. There is no edit mode toggle:
 * clicking a value makes only that value editable and reveals Save/Discard
 * in the header; every other block keeps rendering exactly as in read mode.
 * The dialog shell never unmounts, and closing with unsaved changes asks
 * for confirmation before the exit animation starts.
 */
type EditField = "name" | "amount" | "from" | "to" | "schedule" | "posted";

type TransactionDraft = {
	name: string;
	amount: string;
	fromId: string;
	toId: string;
	/** Schedule cadence. Null on a one-time transaction. */
	frequency: Frequency | null;
	startDate: string;
	endDate: string;
	noEndDate: boolean;
	annualIncrease: string;
	enabled: boolean;
	claimScheduleId: string;
	claimOccurrenceDate: string;
	postedDate: string;
	transactionTime: string;
	pending: boolean;
	void: boolean;
};

function draftFromTransaction(
	savedTransaction: Transaction,
	scheduleFrequency: Frequency,
): TransactionDraft {
	return {
		name: savedTransaction.name,
		amount: String(savedTransaction.amount),
		fromId: savedTransaction.fromId ?? "",
		toId: savedTransaction.toId ?? "",
		frequency: savedTransaction.kind === "schedule" ? scheduleFrequency : null,
		startDate: savedTransaction.startDate,
		endDate: savedTransaction.endDate ?? "",
		noEndDate: savedTransaction.endDate == null,
		annualIncrease: String(savedTransaction.annualIncrease),
		enabled: savedTransaction.enabled,
		claimScheduleId: savedTransaction.claimScheduleId ?? "",
		claimOccurrenceDate: savedTransaction.claimOccurrenceDate ?? "",
		postedDate: savedTransaction.postedDate ?? "",
		transactionTime: timeOfDay(savedTransaction.transactionTime),
		pending: savedTransaction.pending === true,
		void: savedTransaction.void === true,
	};
}

/**
 * Pending bank rows are owner-editable and the occurrence claim lives outside
 * the synced columns. The pending-to-posted convert keeps the same row id,
 * so claiming while pending survives refreshes and settlement. Derived from
 * the row itself at each use site; no exception flag is passed.
 */
function canClaimOccurrence(transaction: Transaction): boolean {
	return (
		transaction.kind === "transaction" &&
		transaction.pending === true &&
		transaction.syncOwned === true
	);
}

function useTransactionEdit({
	savedTransaction,
	readOnly: readOnlyProp,
	onClose,
	scheduleFrequency,
	storedFrequency: storedScheduleFrequency,
}: {
	savedTransaction: Transaction;
	readOnly?: boolean;
	onClose: () => void;
	scheduleFrequency: Frequency;
	storedFrequency?: Frequency;
}) {
	// Only the clicked value is editable; null renders the pure read view.
	const [activeField, setActiveField] = useState<EditField | null>(null);
	const [touched, setTouched] = useState(false);
	const [confirmCancel, setConfirmCancel] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const edit = useEditDraft(
		savedTransaction.id,
		draftFromTransaction(savedTransaction, scheduleFrequency),
	);
	const draft = edit.value;
	const formId = useId();
	const rowReason = readOnlyReasonFor(savedTransaction);
	const readOnlyReason = readOnlyProp ? "Read-only." : rowReason;
	const claimEditable = canClaimOccurrence(savedTransaction);
	useBeforeUnload(activeField !== null && touched && !saving);
	const updateDraft = (patch: Partial<TransactionDraft>, field: EditField) => {
		if (
			savedTransaction.amountKnown === false &&
			(field === "amount" || "annualIncrease" in patch)
		)
			return;
		if (readOnlyReason) {
			// Locked rows are read-only except for the occurrence claim on
			// pending bank rows. Any other schedule patch stays blocked.
			if (!claimEditable || field !== "schedule") return;
			const keys = Object.keys(patch);
			if (
				keys.length === 0 ||
				!keys.every(
					(key) => key === "claimScheduleId" || key === "claimOccurrenceDate",
				)
			)
				return;
		}
		edit.update(patch);
		if (activeField !== field) setActiveField(field);
		setTouched(true);
		setError(null);
		setConfirmCancel(false);
	};
	// Discard restores the read view with the savedTransaction's own values.
	const exitEdit = () => {
		const field = activeField;
		edit.reset();
		setActiveField(null);
		setTouched(false);
		setError(null);
		setConfirmCancel(false);
		// The Save/Discard buttons unmount with the click; return focus to
		// the value that was being edited.
		if (field) document.getElementById(`${formId}-${field}`)?.focus();
	};
	// Close requests run before the dialog exit animation. Every request on a
	// touched edit keeps the prompt visible; only its Discard button closes.
	// The modal's onClose only unmounts after an accepted close.
	const requestClose = () => {
		if (activeField && touched) {
			setConfirmCancel(true);
			return false;
		}
		return true;
	};
	const discardAndClose = () => {
		exitEdit();
		onClose();
	};
	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const claimOnlySave =
			Boolean(readOnlyReason) && claimEditable && activeField === "schedule";
		if ((readOnlyReason && !claimOnlySave) || saving) return;
		if (edit.conflict) {
			setError(
				"This transaction changed during your edit. Discard your edits and try again.",
			);
			return;
		}
		const finish = (ok: boolean, failureMessage: string) => {
			setSaving(false);
			// Keep failed form values; return to the underlying view only
			// after confirmed save.
			if (ok) onClose();
			else
				setError(
					`${failureMessage} Review the workspace notice and try again.`,
				);
		};
		setSaving(true);
		setError(null);
		if (savedTransaction.kind === "schedule") {
			if (draft.frequency === null) {
				setSaving(false);
				setError(
					"The saved schedule could not be loaded. Close and try again.",
				);
				return;
			}
			const values = detailScheduleValues({
				draft: { ...draft, frequency: draft.frequency },
			});
			if (values instanceof Error) {
				setSaving(false);
				setError(values.message);
				return;
			}
			const storedFrequency = storedScheduleFrequency;
			if (storedFrequency === undefined) {
				// A cadence edit needs the stored value to tell an untouched
				// choice from a changed one; refuse instead of saving a blind
				// update the server would ignore.
				setSaving(false);
				setError(
					"The saved schedule could not be loaded. Close and try again.",
				);
				return;
			}
			const schedule = scheduleUpdate({
				baseline: savedTransaction,
				values,
				storedFrequency,
			});
			const ok = await performSave({
				call: async () => {
					if (Object.keys(schedule.amend).length) {
						const amended = await amendSchedule(
							savedTransaction.id,
							schedule.amend,
						);
						if (amended.data.saved === false) return amended;
					}
					if (Object.keys(schedule.reschedule).length) {
						return rescheduleSchedule(savedTransaction.id, schedule.reschedule);
					}
					return { data: { saved: true, issues: [] } };
				},
				refresh: refreshTransactions,
				failureMessage: "The schedule could not be saved.",
			});
			finish(ok, "The schedule could not be saved.");
			return;
		}
		const values = detailTransactionValues({ draft, item: savedTransaction });
		if (values instanceof Error) {
			setSaving(false);
			setError(values.message);
			return;
		}
		const claimChanged =
			(values.claimScheduleId ?? null) !== savedTransaction.claimScheduleId ||
			(values.claimOccurrenceDate ?? null) !==
				savedTransaction.claimOccurrenceDate;
		const ok = await performSave({
			call: async () => {
				const patch = transactionUpdate({ baseline: savedTransaction, values });
				if (Object.keys(patch).length) {
					const amended = await amendTransaction(savedTransaction.id, patch);
					if (amended.data.saved === false) return amended;
				}
				if (claimChanged) {
					if (values.claimScheduleId && values.claimOccurrenceDate) {
						return claimOccurrence(
							savedTransaction.id,
							claimUpdate(values.claimScheduleId, values.claimOccurrenceDate),
						);
					}
					return releaseOccurrence(savedTransaction.id);
				}
				return { data: { saved: true, issues: [] } };
			},
			refresh: refreshTransactions,
			failureMessage: "The transaction could not be saved.",
		});
		finish(ok, "The transaction could not be saved.");
	};
	// The submitter only mounts once an edit starts, so no in-flight
	// activation can ever land on it: read mode renders no actions at all.
	// Locked claimable rows save schedule-claim edits while locked.
	const saveBlocked =
		saving ||
		(savedTransaction.kind === "schedule" &&
			storedScheduleFrequency === undefined) ||
		(Boolean(readOnlyReason) && !(claimEditable && activeField === "schedule"));
	const actions =
		activeField === null ? undefined : (
			<DetailEditActions
				formId={formId}
				onDiscard={exitEdit}
				disabled={saveBlocked}
			/>
		);
	return {
		activeField,
		draft,
		updateDraft,
		confirmCancel,
		setConfirmCancel,
		error,
		formId,
		actions,
		requestClose,
		submit,
		exitEdit,
		readOnlyReason,
		discardAndClose,
		saving,
	};
}

/**
 * Authoritative schedule-existence check for subscription retries. The cache
 * may be stale after a saved-but-refresh-failed attempt, so a cache miss
 * falls back to one server read before any create. The start action is
 * atomic: the transaction and its first occurrence claim land together.
 */
async function scheduleExistsAuthoritative(
	scheduleId: string,
): Promise<boolean> {
	const cached = serverQueryClient().getQueryData(
		schedulesOptions(getUserScope()).queryKey,
	) as { schedules?: { id: string }[] } | undefined;
	if (cached?.schedules?.some((schedule) => schedule.id === scheduleId))
		return true;
	try {
		const fresh = await serverQueryClient().fetchQuery(
			schedulesOptions(getUserScope()),
		);
		return fresh.schedules.some((schedule) => schedule.id === scheduleId);
	} catch {
		return false;
	}
}

function useMarkAsSubscription({
	savedTransaction,
	locked,
	onDone,
}: {
	savedTransaction: Transaction;
	locked: boolean;
	onDone: () => void;
}) {
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	// Pinned retry identity: a saved-but-refresh-failed attempt already
	// recorded the occurrence claim with the schedule. Retrying reuses the
	// same identity and verifies it before creating anything.
	const attemptRef = useRef<{ scheduleId: string } | null>(null);
	const canClaimPending = canClaimOccurrence(savedTransaction);
	const available =
		savedTransaction.kind === "transaction" &&
		!savedTransaction.claimScheduleId &&
		(!locked || canClaimPending);
	const mark = async () => {
		if (saving) return;
		const scheduleId = attemptRef.current?.scheduleId ?? crypto.randomUUID();
		attemptRef.current = { scheduleId };
		const scope = getUserScope();
		setSaving(true);
		setError(null);
		if (await scheduleExistsAuthoritative(scheduleId)) {
			setSaving(false);
			attemptRef.current = null;
			onDone();
			return;
		}
		const ok = await performSave({
			call: () =>
				scheduleFromTransaction(savedTransaction.id, {
					id: scheduleId,
					frequency: "monthly",
					startDate: savedTransaction.startDate,
				}),
			refresh: refreshTransactions,
			failureMessage: "The subscription schedule could not be created.",
		});
		setSaving(false);
		if (getUserScope() !== scope) {
			setError("The signed-in user changed. Close and review before retrying.");
			return;
		}
		if (ok) {
			attemptRef.current = null;
			onDone();
		} else
			setError(
				"The subscription schedule could not be created. Review the workspace notice and try again.",
			);
	};
	return { available, marking: saving, error, mark };
}

function fromAccountOptions(accounts: Account[]): Account[] {
	return visibleAccounts(accounts).filter((account) => account.kind !== "debt");
}

/**
 * Read-friendly view of one projected or recorded occurrence. Clicking a
 * value turns the same blocks into controls in place: the dialog, the
 * header, and the layout never move. Save/Discard appear once editing.
 */
export function TransactionDetail({
	transaction,
	savedTransaction,
	accounts,
	transactions,
	readOnly,
	claimScheduleName,
	shortfallLabel,
	onClose,
}: {
	transaction: AccountTransaction;
	savedTransaction: Transaction;
	accounts: AccountRef[];
	/**
	 * Rows the entry point had at hand; the detail prefers the canonical
	 * saved list and uses these only while it loads (and in fixtures).
	 */
	transactions?: Transaction[];
	readOnly?: boolean;
	claimScheduleName?: string | null;
	shortfallLabel?: string;
	onClose: () => void;
}) {
	const kind =
		transaction.flow === "transfer"
			? ("transfer" as const)
			: transaction.direction;
	// Cadence of the schedule this row displays, read from the schedules
	// endpoint. The editor follows the stored cadence; only a schedule
	// carries one.
	const savedRules = useSavedSchedules();
	const schedulesQuery = useSchedules();
	const modelRevision = schedulesQuery.data?.revision;
	const rawSchedules = savedRules ?? undefined;
	const rawSchedule =
		savedTransaction.kind === "schedule"
			? rawSchedules?.find((rule) => rule.id === savedTransaction.id)
			: undefined;
	const scheduleCadence = rawSchedule
		? frequencyLabel(rawSchedule.frequency)
		: null;
	const scheduleFrequency: Frequency =
		parseUnion(rawSchedule?.frequency, [
			"daily",
			"weekly",
			"monthly",
			"quarterly",
			"annual",
		] as const) ?? "monthly";
	const edit = useTransactionEdit({
		savedTransaction,
		readOnly,
		onClose,
		scheduleFrequency,
		storedFrequency: rawSchedule?.frequency as Frequency | undefined,
	});
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [confirmingEndSchedule, setConfirmingEndSchedule] = useState(false);
	const [endingSchedule, setEndingSchedule] = useState(false);
	const [endScheduleDate, setEndScheduleDate] = useState(
		savedTransaction.startDate,
	);
	const [endScheduleError, setEndScheduleError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const once = savedTransaction.kind === "transaction";
	const canEdit = !edit.readOnlyReason;
	// Settled and pending bank rows are editable and removable through the
	// UI: removing one suppresses its bank ids, so the feed will not
	// re-import it.
	const canDelete = canEdit;
	const [datesOpen, setDatesOpen] = useState(false);
	const subscription = useMarkAsSubscription({
		savedTransaction,
		locked: !canEdit,
		onDone: onClose,
	});
	// Claim options and name lookups use the canonical saved list, so the
	// detail never depends on which rows the entry point happened to pass.
	// The prop (or the row itself) covers loading and test fixtures.
	const savedTransactions = useSavedTransactions();
	// Claim targets and void candidates span both row kinds; rules arrive
	// from their own endpoint and are mapped to the shared display shape.
	const allTransactions = useMemo(() => {
		const rows = [
			...(savedTransactions ?? transactions ?? [savedTransaction]),
			...(savedRules ?? []).map(scheduleToDisplay),
		];
		const byId = new Map(rows.map((row) => [row.id, row]));
		return [...byId.values()];
	}, [savedTransactions, transactions, savedTransaction, savedRules]);
	const scheduleHistory = useMemo(
		() =>
			savedTransaction.kind === "schedule"
				? scheduleHistoryTransactions({
						scheduleId: savedTransaction.id,
						transactions: allTransactions,
					})
				: [],
		[allTransactions, savedTransaction.kind, savedTransaction.id],
	);
	// Claim candidates: the selected schedule's dates through today,
	// closest to the day the transaction actually happened first, already
	// claimed dates removed. The row's own saved claim always stays listed.
	const postedRef = savedTransaction.postedDate ?? savedTransaction.startDate;
	const occurrenceOptions = useMemo(() => {
		const scheduleId = edit.draft.claimScheduleId;
		const schedule = scheduleId
			? rawSchedules?.find((row) => row.id === scheduleId)
			: undefined;
		if (!schedule) return [];
		const claimed = new Set<string>();
		for (const row of allTransactions) {
			if (
				row.id !== savedTransaction.id &&
				row.claimScheduleId === scheduleId &&
				row.claimOccurrenceDate
			)
				claimed.add(row.claimOccurrenceDate);
		}
		const candidates = claimOccurrenceCandidates({
			schedule,
			through: todayIso(),
			postedRef,
			claimed,
		});
		const own = edit.draft.claimOccurrenceDate;
		return own && !candidates.includes(own) ? [own, ...candidates] : candidates;
	}, [
		edit.draft.claimScheduleId,
		edit.draft.claimOccurrenceDate,
		rawSchedules,
		allTransactions,
		savedTransaction.id,
		postedRef,
	]);
	const settleCandidates = useSettleCandidates(
		savedTransaction.id,
		transaction.void && !savedTransaction.pending,
		modelRevision,
	);
	const voidCandidates =
		settleCandidates.data?.candidates ?? EMPTY_SETTLE_CANDIDATES;
	const showShortfall = transaction.shortfall > 0.01;
	const showExcluded = transaction.excluded && !transaction.pending;
	const postedDiffers =
		savedTransaction.postedDate !== null &&
		savedTransaction.postedDate !== edit.draft.startDate;
	const fromAccount = accountFor(accounts, edit.draft.fromId || null);
	const toAccount = accountFor(accounts, edit.draft.toId || null);
	const showPosted = savedTransaction.postedDate !== null;
	const hasStatusPill =
		transaction.pending ||
		showPosted ||
		showExcluded ||
		showShortfall ||
		savedTransaction.amountKnown === false ||
		(!savedTransaction.enabled && !transaction.pending && !showExcluded);
	// Transfer details already state the route with labeled account rows.
	// Other flows keep the single account under the amount because nothing
	// else names it.
	const accountRoute =
		kind === "transfer"
			? ""
			: associatedAccountLabel({ fromAccount, toAccount, transaction });
	// Formula-driven rules without a resolved figure carry no amount to show:
	// the Calculated badge says it all. Real zero-amount occurrences always
	// carry a requested figure or shortfall, so they still render.
	const showAmount =
		savedTransaction.amountKnown ||
		transaction.amount !== 0 ||
		transaction.requested !== 0;
	const finishRemoval = async (
		refresh: () => Promise<void>,
		failureMessage: string,
		recover?: () => Promise<void>,
	) => {
		if (deleting) return;
		setDeleting(true);
		setDeleteError(null);
		const ok = await performSave({
			call: () =>
				savedTransaction.kind === "transaction"
					? deleteTransaction(savedTransaction.id)
					: deleteSchedule(savedTransaction.id),
			refresh,
			...(recover ? { recover } : {}),
			failureMessage,
		});
		setDeleting(false);
		if (ok) onClose();
		else setDeleteError(failureMessage);
	};
	const removeTransaction = () =>
		finishRemoval(
			refreshTransactions,
			savedTransaction.kind === "schedule"
				? "The schedule could not be removed."
				: "The transaction could not be removed.",
		);
	// Ending a schedule records one real transaction and removes the
	// schedule. The server copies the schedule's amount and accounts; only
	// the day it actually happened is new input.
	const endSchedule = async () => {
		if (endingSchedule) return;
		if (!endScheduleDate) {
			setEndScheduleError("Choose the transaction date.");
			return;
		}
		setEndingSchedule(true);
		setEndScheduleError(null);
		const ok = await performSave({
			call: () =>
				endScheduleWithTransaction(savedTransaction.id, {
					date: endScheduleDate,
				}),
			refresh: refreshTransactions,
			failureMessage: "The schedule could not be ended.",
		});
		setEndingSchedule(false);
		if (ok) onClose();
		else setEndScheduleError("The schedule could not be ended.");
	};
	// A void hold's suggestion merges it into the posted charge. The posted
	// charge keeps its amount and date; an occurrence recorded on the hold
	// moves to it when the charge records none.
	const mergeVoidHold = async (candidateId: string): Promise<boolean> => {
		if (deleting || readOnly) return false;
		const candidate = voidCandidates.find(
			(row) => row.transactionId === candidateId,
		);
		if (!candidate) return false;
		const claimScheduleId = savedTransaction.claimScheduleId;
		const claimOccurrenceDate = savedTransaction.claimOccurrenceDate;
		setDeleting(true);
		setDeleteError(null);
		if (claimScheduleId && claimOccurrenceDate && !candidate.claimScheduleId) {
			const claimed = await performSave({
				call: () =>
					claimOccurrence(
						candidateId,
						claimUpdate(claimScheduleId, claimOccurrenceDate),
					),
				refresh: refreshTransactions,
				failureMessage: "The posted charge could not record the occurrence.",
			});
			if (!claimed) {
				setDeleting(false);
				setDeleteError("The posted charge could not record the occurrence.");
				return false;
			}
		}
		const ok = await performSave({
			call: () => deleteTransaction(savedTransaction.id),
			refresh: transactionRemovalNeedsProjectionRefresh(savedTransaction.id)
				? refreshTransactions
				: () => removeDeletedTransactionFromCache(savedTransaction.id),
			recover: refreshTransactions,
			failureMessage: "The vanished hold could not be removed.",
		});
		setDeleting(false);
		if (ok) onClose();
		else setDeleteError("The vanished hold could not be removed.");
		return ok;
	};
	const fullAccounts = accounts as Account[];
	const [historySelection, setHistorySelection] = useState<Transaction | null>(
		null,
	);
	const [insightsOpen, setInsightsOpen] = useState(false);
	// Sharing lives in its own sheet above the detail, mirroring the
	// suggestions sheet: the footer status reports the state and opens it.
	const [sharingOpen, setSharingOpen] = useState(false);
	const findingsQuery = useAnalysisFindings(once ? [savedTransaction.id] : []);
	const grantsQuery = useSharingGrants();
	const insightNames = useMemo(() => {
		return new Map(allTransactions.map((row) => [row.id, row.name]));
	}, [allTransactions]);
	const insightSuggestions = useMemo(
		() =>
			once
				? buildInsightSuggestions({
						findings: findingsQuery.data?.findings ?? [],
						transactionId: savedTransaction.id,
						voidRow: savedTransaction,
						candidates: voidCandidates,
					})
				: [],
		[once, findingsQuery.data?.findings, savedTransaction, voidCandidates],
	);
	// A void hold is read-only as a row, but its merge suggestion stays
	// actionable for the owner. Only the app-level read-only gate blocks it.
	const insightReadOnly = savedTransaction.void
		? Boolean(readOnly)
		: Boolean(readOnly ?? savedTransaction.readOnly);
	const sharedIntents = useMemo(
		() =>
			(grantsQuery.data ?? []).filter(
				(grant) => grant.transactionId === savedTransaction.id,
			),
		[grantsQuery.data, savedTransaction.id],
	);
	const sharedCount = sharedIntents.filter(
		(intent) => intent.intent === "shared",
	).length;
	const sharingLabel =
		sharedCount > 0
			? `Shared · ${sharedCount}`
			: sharedIntents.length > 0
				? "Hidden"
				: "Private";
	const scrollToSection = (id: string) => {
		document.getElementById(id)?.scrollIntoView({ block: "start" });
	};
	const editHeading = (
		<span className="flex items-center gap-3">
			<span className="sr-only">{edit.draft.name}</span>
			<span
				className={transactionIconStyles({
					tone:
						kind === "transfer"
							? "transfer"
							: kind === "in"
								? "inflow"
								: "outflow",
					size: "hero",
				})}
			>
				<DirectionIcon kind={kind} size={22} />
			</span>
			<input
				id={`${edit.formId}-name`}
				aria-label="Transaction name"
				name="name"
				required
				maxLength={100}
				value={edit.draft.name}
				onChange={(event) =>
					edit.updateDraft({ name: event.target.value }, "name")
				}
				readOnly={!canEdit}
				form={edit.formId}
				className={transactionControlStyles({ shape: "name" })}
			/>
			{savedTransaction.kind === "schedule" && (
				<span
					title="Schedule"
					aria-label="Schedule"
					role="img"
					className="inline-flex size-9 flex-none items-center justify-center rounded-surface bg-surface-2 text-muted"
				>
					<Repeat size={16} aria-hidden="true" />
				</span>
			)}
		</span>
	);
	const menuItems: ActionMenuItem[] = [];
	if (canEdit) {
		menuItems.push({
			id: "toggle-enabled",
			label: edit.draft.enabled
				? "Exclude from projections"
				: "Include in projections",
			icon: edit.draft.enabled ? EyeOff : Eye,
			checked: edit.draft.enabled,
			onSelect: () =>
				edit.updateDraft({ enabled: !edit.draft.enabled }, "schedule"),
		});
	}
	if (subscription.available) {
		menuItems.push({
			id: "mark-subscription",
			label: subscription.marking ? "Marking…" : "Mark as subscription",
			icon: Repeat,
			disabled: subscription.marking,
			onSelect: () => void subscription.mark(),
		});
	}
	if (canEdit && savedTransaction.kind === "schedule") {
		menuItems.push({
			id: "end-schedule",
			label: "End schedule with this transaction",
			icon: Check,
			onSelect: () => {
				setEndScheduleError(null);
				setConfirmingEndSchedule(true);
			},
		});
	}
	if (canDelete) {
		menuItems.push({
			id: "delete",
			label:
				savedTransaction.kind === "schedule"
					? "Delete schedule"
					: "Delete transaction",
			icon: Trash2,
			tone: "danger",
			restoreFocus: false,
			onSelect: () => {
				setDeleteError(null);
				setConfirmingDelete(true);
			},
		});
	}
	return (
		<DetailPortal>
			<Modal
				title={editHeading}
				titleSize="plain"
				headerClassName="border-b-0 pb-0"
				className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-xl rounded-none border-0 border-l border-solid border-line max-sm:mt-auto max-sm:mb-0 max-sm:ml-0 max-sm:h-auto max-sm:max-h-[94svh] max-sm:w-full max-sm:max-w-none max-sm:rounded-t-surface max-sm:rounded-b-none max-sm:border-l-0 max-sm:border-t"
				onCloseRequest={edit.requestClose}
				actions={
					<>
						<ActionMenu
							label="More options"
							menuLabel={
								savedTransaction.kind === "schedule"
									? "Schedule actions"
									: "Transaction actions"
							}
							items={menuItems}
						/>
						{edit.actions}
					</>
				}
				onClose={onClose}
				focusPanelOnOpen
			>
				<form id={edit.formId} onSubmit={(event) => void edit.submit(event)}>
					<div className="flex flex-col gap-3 pt-1 pb-2">
						<div className="flex min-w-0 flex-col gap-2">
							{showAmount && (
								<span
									className={`type-value inline-flex items-baseline gap-1 text-2xl leading-[1.3] font-medium tracking-tight whitespace-nowrap${transaction.direction === "in" ? " text-success-text" : ""}`}
								>
									<span
										className="flex-none whitespace-nowrap"
										aria-hidden="true"
									>
										{transaction.amount === 0
											? "$"
											: `${transaction.direction === "in" ? "+" : "−"}$`}
									</span>
									<input
										id={`${edit.formId}-amount`}
										aria-label="Amount (USD)"
										name="amount"
										type="number"
										required
										min="0.01"
										max="10000000000"
										step="0.01"
										value={
											savedTransaction.amountKnown
												? edit.draft.amount
												: String(transaction.amount)
										}
										onChange={(event) =>
											edit.updateDraft({ amount: event.target.value }, "amount")
										}
										readOnly={
											!canEdit || savedTransaction.amountKnown === false
										}
										className={transactionControlStyles({
											shape: "amount",
											positive: transaction.direction === "in",
										})}
									/>
								</span>
							)}
							<div className="flex flex-wrap items-center gap-2">
								{transaction.void ? (
									<Badge tone="neutral">
										Did not post
										<span className="sr-only">bank hold that did not post</span>
									</Badge>
								) : transaction.pending ? (
									<Badge tone="warning">
										<Clock3 size={10} aria-hidden="true" />
										Pending
									</Badge>
								) : showPosted ? (
									<Badge tone="success">
										<Check size={10} aria-hidden="true" />
										Posted
									</Badge>
								) : null}
								{showExcluded && (
									<Badge tone="warning">Excluded from account</Badge>
								)}
								{showShortfall && (
									<Badge tone="warning">
										<TriangleAlert size={10} aria-hidden="true" />
										{shortfallLabel ?? "Shortfall"}
									</Badge>
								)}
								{!savedTransaction.enabled &&
									!transaction.pending &&
									!transaction.void &&
									!showExcluded && <Badge tone="warning">Excluded</Badge>}
								{savedTransaction.amountKnown === false && (
									<Badge tone="neutral">Calculated</Badge>
								)}
								{accountRoute && (
									<>
										{hasStatusPill && (
											<span className="text-muted" aria-hidden="true">
												·
											</span>
										)}
										<span className="text-sm text-muted">{accountRoute}</span>
									</>
								)}
							</div>
						</div>
						{(once || transaction.pending || postedDiffers) && (
							<div className="flex min-w-0 flex-col items-start gap-2">
								{once && (
									<div className="inline-flex flex-wrap items-center gap-2 text-sm text-muted">
										<span>Occurred</span>
										{canEdit ? (
											<button
												type="button"
												id={`${edit.formId}-date`}
												className="inline-flex items-center gap-1.5 rounded-control border border-transparent px-1 py-0.5 text-sm font-medium text-ink hover:border-line-strong focus-visible:bg-input-bg"
												onClick={() => setDatesOpen(true)}
											>
												<CalendarDays size={14} aria-hidden="true" />
												{dateLabel(edit.draft.startDate, true)}
											</button>
										) : (
											<span className="text-sm font-medium text-ink">
												{dateLabel(edit.draft.startDate, true)}
											</span>
										)}
									</div>
								)}
								{(transaction.pending || postedDiffers) && (
									<div className="inline-flex flex-wrap items-center gap-2 text-sm text-muted">
										<span>Posted</span>
										{transaction.pending ? (
											<span>Not yet posted</span>
										) : (
											<span className="text-sm font-medium text-ink">
												{dateLabel(edit.draft.postedDate, true)}
											</span>
										)}
									</div>
								)}
							</div>
						)}
					</div>
					{kind === "transfer" && (
						<div className="mt-5">
							<h3 className="mb-3 text-sm font-semibold">Transfer details</h3>
							<div className="rounded-surface bg-surface-2 p-4">
								<div className="flex items-center gap-3">
									{fromAccount ? (
										<AccountIcon account={fromAccount} />
									) : (
										<AccountIconFallback />
									)}
									<div className="flex min-w-0 flex-auto flex-col gap-0.5">
										<span
											className="text-xs font-semibold tracking-wide text-muted"
											aria-hidden="true"
										>
											FROM ACCOUNT
										</span>
										<select
											id={`${edit.formId}-from`}
											aria-label="From"
											name="fromId"
											value={edit.draft.fromId}
											onChange={(event) =>
												edit.updateDraft({ fromId: event.target.value }, "from")
											}
											disabled={!canEdit}
											className={transactionControlStyles({
												element: "select",
												shape: "account",
												appearance:
													edit.activeField === "from" ? "native" : "plain",
											})}
										>
											<option value="">External income</option>
											<AccountOptions
												accounts={fromAccountOptions(fullAccounts)}
											/>
										</select>
									</div>
								</div>
								<div
									className="my-2 ml-3 flex items-center gap-3 text-muted"
									aria-hidden="true"
								>
									<ArrowDown size={16} />
									<span className="h-px flex-auto bg-line" />
								</div>
								<div className="flex items-center gap-3">
									{toAccount ? (
										<AccountIcon account={toAccount} />
									) : (
										<AccountIconFallback />
									)}
									<div className="flex min-w-0 flex-auto flex-col gap-0.5">
										<span
											className="text-xs font-semibold tracking-wide text-muted"
											aria-hidden="true"
										>
											TO ACCOUNT
										</span>
										<select
											id={`${edit.formId}-to`}
											aria-label="To"
											name="toId"
											value={edit.draft.toId}
											onChange={(event) =>
												edit.updateDraft({ toId: event.target.value }, "to")
											}
											disabled={!canEdit}
											className={transactionControlStyles({
												element: "select",
												shape: "account",
												appearance:
													edit.activeField === "to" ? "native" : "plain",
											})}
										>
											<option value="">External spending</option>
											<AccountOptions
												accounts={visibleAccounts(fullAccounts)}
											/>
										</select>
									</div>
								</div>
							</div>
						</div>
					)}
					<div id={`${edit.formId}-schedule-section`} className="scroll-mt-4">
						<ScheduleCapsule
							savedTransaction={savedTransaction}
							draft={edit.draft}
							updateDraft={edit.updateDraft}
							claimScheduleName={
								savedTransaction.claimScheduleId
									? (allTransactions.find(
											(item) => item.id === savedTransaction.claimScheduleId,
										)?.name ?? claimScheduleName)
									: null
							}
							scheduleCadence={scheduleCadence}
							occurrenceOptions={occurrenceOptions}
							editing={edit.activeField === "schedule"}
							locked={!canEdit}
							scheduleControlId={`${edit.formId}-schedule`}
						/>
					</div>
					<MoreOptions
						savedTransaction={savedTransaction}
						transactions={allTransactions}
						draft={edit.draft}
						updateDraft={edit.updateDraft}
						locked={!canEdit}
						categoryReadOnly={Boolean(readOnly)}
						occurrenceOptions={occurrenceOptions}
					/>
					{savedTransaction.kind === "schedule" && (
						<ScheduleHistory
							transactions={scheduleHistory}
							accounts={fullAccounts}
							startDate={savedTransaction.startDate}
							onSelect={setHistorySelection}
						/>
					)}
					<FieldError
						message={[subscription.error, edit.error].filter(Boolean).join(" ")}
					/>
					{edit.saving && (
						<p className="mt-2 text-xs text-muted" role="status">
							Saving…
						</p>
					)}
					<ReadOnlyNotice
						savedTransaction={savedTransaction}
						appReadOnly={readOnly}
					/>
				</form>
				{once && (
					<TransactionAnalysisPanel
						transactionId={savedTransaction.id}
						readOnly={Boolean(readOnly ?? savedTransaction.readOnly)}
					/>
				)}
				{once && (
					<div id={`${edit.formId}-receipts`} className="scroll-mt-4">
						<ReceiptPanel
							transactionId={savedTransaction.id}
							transaction={savedTransaction}
							readOnly={Boolean(readOnly ?? savedTransaction.readOnly)}
						/>
					</div>
				)}
				<div className={detailFooterClassName}>
					{edit.confirmCancel ? (
						<DiscardConfirm
							onContinue={() => edit.setConfirmCancel(false)}
							onDiscard={edit.discardAndClose}
						/>
					) : (
						<>
							<div className="flex flex-wrap items-center gap-4">
								{once && (
									<TextButton
										type="button"
										tone="default"
										onClick={() => setSharingOpen(true)}
										aria-label={`Sharing status: ${sharingLabel}. Open sharing settings`}
										aria-haspopup="dialog"
									>
										{sharedCount > 0 ? (
											<UsersRound size={14} aria-hidden="true" />
										) : (
											<LockKeyhole size={14} aria-hidden="true" />
										)}
										<span>{sharingLabel}</span>
									</TextButton>
								)}
								{savedTransaction.kind === "schedule" && (
									<TextButton
										type="button"
										tone="default"
										onClick={() => {
											scrollToSection(`${edit.formId}-schedule-section`);
											document
												.getElementById(`${edit.formId}-schedule`)
												?.focus();
										}}
										aria-label={
											scheduleCadence
												? `Recurring schedule: ${scheduleCadence}. Go to schedule`
												: "Recurring schedule. Go to schedule"
										}
									>
										<Repeat size={14} aria-hidden="true" />
										<span>{scheduleCadence ?? "Recurring schedule"}</span>
									</TextButton>
								)}
							</div>
							<div className="flex flex-wrap items-center gap-4">
								{once && (
									<TransactionInsightsTrigger
										count={insightSuggestions.length}
										onClick={() => setInsightsOpen(true)}
									/>
								)}
							</div>
						</>
					)}
				</div>
			</Modal>
			{once && insightsOpen && (
				<Modal
					title="Suggestions"
					onClose={() => setInsightsOpen(false)}
					className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-md rounded-none border-0 border-l border-solid border-line max-sm:mt-auto max-sm:mb-0 max-sm:ml-0 max-sm:h-auto max-sm:max-h-[94svh] max-sm:w-full max-sm:max-w-none max-sm:rounded-t-surface max-sm:rounded-b-none max-sm:border-l-0 max-sm:border-t"
				>
					<p className="mt-0 mb-6 text-[11px] text-muted">
						Small checks to improve future estimates
					</p>
					<TransactionInsightsPanel
						suggestions={insightSuggestions}
						names={insightNames}
						readOnly={insightReadOnly}
						onDone={() => setInsightsOpen(false)}
						onMergeVoid={savedTransaction.void ? mergeVoidHold : undefined}
					/>
				</Modal>
			)}
			{once && sharingOpen && (
				<Modal
					title="Sharing"
					onClose={() => setSharingOpen(false)}
					className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-md rounded-none border-0 border-l border-solid border-line max-sm:mt-auto max-sm:mb-0 max-sm:ml-0 max-sm:h-auto max-sm:max-h-[94svh] max-sm:w-full max-sm:max-w-none max-sm:rounded-t-surface max-sm:rounded-b-none max-sm:border-l-0 max-sm:border-t"
				>
					<TransactionSharing
						transactionId={savedTransaction.id}
						readOnly={Boolean(readOnly ?? savedTransaction.readOnly)}
					/>
				</Modal>
			)}
			{historySelection && (
				<TransactionDetail
					key={historySelection.id}
					// The schedule start is only the adapter's display horizon;
					// the transaction detail reads the transaction's own fields.
					transaction={scheduleTransaction({
						transaction: historySelection,
						accounts: fullAccounts,
						startDate: savedTransaction.startDate,
					})}
					savedTransaction={historySelection}
					accounts={accounts}
					transactions={allTransactions}
					readOnly={readOnly}
					onClose={() => setHistorySelection(null)}
				/>
			)}
			{datesOpen && (
				<TransactionDateModal
					occurred={edit.draft.startDate}
					posted={edit.draft.postedDate}
					pending={edit.draft.pending}
					postedLocked={!canEdit}
					onClose={() => setDatesOpen(false)}
					onApply={(occurredDate, postedDate) => {
						const wasLifecycle = edit.draft.pending || edit.draft.void;
						const settles = wasLifecycle && postedDate.trim() !== "";
						edit.updateDraft(
							{
								startDate: occurredDate,
								postedDate,
								pending: settles ? false : edit.draft.pending,
								void: settles ? false : edit.draft.void,
								enabled: settles ? true : edit.draft.enabled,
							},
							"schedule",
						);
						setDatesOpen(false);
					}}
				/>
			)}
			{confirmingDelete && (
				<ConfirmDialog
					title={`Delete ${savedTransaction.name}?`}
					eyebrow="Changes"
					onCancel={() => {
						if (!deleting) {
							setConfirmingDelete(false);
							setDeleteError(null);
						}
					}}
					onConfirm={() => void removeTransaction()}
					cancelLabel={
						savedTransaction.kind === "schedule"
							? "Keep schedule"
							: "Keep transaction"
					}
					confirmLabel={
						savedTransaction.kind === "schedule"
							? "Delete schedule"
							: "Delete transaction"
					}
					busyLabel="Deleting…"
					busy={deleting}
					error={deleteError}
				>
					<p>
						{savedTransaction.kind === "schedule"
							? "This deletes the schedule immediately. Its recorded transactions stay."
							: "This deletes the transaction immediately. It is removed from the saved model."}
					</p>
				</ConfirmDialog>
			)}
			{confirmingEndSchedule && (
				<ConfirmDialog
					title={`End ${savedTransaction.name} with a transaction?`}
					eyebrow="Changes"
					onCancel={() => {
						if (!endingSchedule) {
							setConfirmingEndSchedule(false);
							setEndScheduleError(null);
						}
					}}
					onConfirm={() => void endSchedule()}
					cancelLabel="Keep schedule"
					confirmLabel="Record transaction"
					confirmVariant="primary"
					busyLabel="Recording…"
					busy={endingSchedule}
					error={endScheduleError}
				>
					<p>
						This records one transaction with the schedule amount and accounts.
						The schedule ends and no further occurrences are planned.
					</p>
					<InputField
						label="Transaction date"
						containerClassName="mt-3"
						type="date"
						name="endScheduleDate"
						required
						disabled={endingSchedule}
						value={endScheduleDate}
						onChange={(event) => setEndScheduleDate(event.target.value)}
					/>
				</ConfirmDialog>
			)}
		</DetailPortal>
	);
}
