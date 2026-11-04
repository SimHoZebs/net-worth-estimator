import { useEditDraft } from "../editors/useEditDraft.ts";
import {
	ArrowDown,
	ArrowDownLeft,
	ArrowRightLeft,
	ArrowUpRight,
	Check,
	Clock3,
	Eye,
	EyeOff,
	Link2,
	LockKeyhole,
	Repeat,
	RotateCcw,
	Save,
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
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import { voidSettleCandidates } from "../../domain/accountActivity.ts";
import { claimOccurrenceCandidates } from "../../domain/ruleSchedule.ts";
import { dateLabel, money, todayIso } from "../../domain/format.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { AccountIconFallback } from "./AccountIconFallback.tsx";
import { parseUnion } from "../../domain/guards.ts";
import { buildSubscriptionConversion } from "../../domain/subscriptions.ts";
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
import { ErrorNotice } from "../ErrorNotice.tsx";
import { Modal } from "../Modal.tsx";
import { Button, IconButton, TextButton } from "../Button.tsx";
import { Notice } from "../Notice.tsx";
import { Checkbox, Input, Select, SelectField } from "../Field.tsx";
import { transactionIconStyles } from "./activityStyles.ts";
import { transactionControlStyles } from "./transactionDetailStyles.ts";
import {
	convertTransaction,
	createRule,
	deletePosting,
	deleteRule,
	updatePosting,
	updateRule,
} from "@/api/generated/endpoints.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import {
	removeDeletedTransactionFromCache,
	transactionRemovalNeedsProjectionRefresh,
} from "../../state/transactionCache.ts";
import { frequencyLabel } from "../../domain/recurringPatterns.ts";
import {
	getServerModel,
	modelOptions,
	refreshTransactions,
} from "../../state/workspaceResources.ts";
import { AccountOptions } from "../editors/AccountOptions.tsx";
import {
	frequencyChoiceOf,
	timeOfDay,
	claimPostingBody,
	detailFormValues,
	postingBody,
	postingUpdateBody,
	ruleBody,
	ruleUpdateBody,
	type FrequencyChoice,
} from "../editors/transactionBodies.ts";
import { ReceiptPanel } from "../receipts/ReceiptPanel.tsx";
import { TransactionAnalysisPanel } from "../analysis/TransactionAnalysis.tsx";
import { TransactionSharing } from "./TransactionSharing.tsx";
import {
	buildInsightSuggestions,
	TransactionInsightsPanel,
	TransactionInsightsTrigger,
} from "./TransactionInsights.tsx";
import { useAnalysisFindings } from "../../state/analyses.ts";
import { useSavedRules, useSavedTransactions } from "../../state/savedRows.ts";
import { ruleToDisplay } from "../../domain/transactionRows.ts";
import { useSharingGrants } from "../../state/sharing.ts";

type AccountRef = Pick<Account, "id" | "kind" | "color" | "name">;

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
	occurrenceOptions,
}: {
	savedTransaction: Transaction;
	transactions: Transaction[];
	draft: TransactionDraft;
	updateDraft: (patch: Partial<TransactionDraft>, field: EditField) => void;
	locked: boolean;
	/** Scheduled dates of the selected rule, closest to the posted day first. */
	occurrenceOptions: string[];
}) {
	const id = useId();
	const frequency = draft.frequency;
	const onFrequency = (next: FrequencyChoice) =>
		updateDraft({ frequency: next }, "schedule");
	const claimRules = transactions.filter(
		(item) => item.kind === "rule" && item.id !== savedTransaction.id,
	);
	const claimEditable = !locked || canClaimOccurrence(savedTransaction);
	const frequencyId = `${id}-frequency`;
	const annualIncreaseId = `${id}-annual-increase`;
	const claimRuleId = `${id}-claim-rule`;
	const claimOccurrenceId = `${id}-claim-occurrence`;
	const rowLabel = "w-36 flex-none text-sm font-semibold text-muted";
	return (
		<section
			aria-label="Schedule options"
			className="mt-4 border-t border-line pt-4"
		>
			<div className="flex flex-col">
				<div className="flex items-center gap-4 border-t border-line py-2 first:border-t-0 first:pt-0 last:pb-0">
					<label htmlFor={frequencyId} className={rowLabel}>
						Frequency
					</label>
					<Select
						id={frequencyId}
						name="frequency"
						disabled={locked}
						value={frequency}
						onChange={(event) => {
							const next = parseUnion(event.target.value, [
								"monthly",
								"yearly",
								"once",
							] as const);
							if (next) onFrequency(next);
						}}
						className="min-w-0 flex-1"
					>
						<option value="monthly">Monthly</option>
						<option value="yearly">Yearly</option>
						<option value="once">One time</option>
					</Select>
				</div>
				{frequency !== "once" && (
					<div className="flex items-center gap-4 border-t border-line py-2 first:border-t-0 first:pt-0 last:pb-0">
						<label htmlFor={annualIncreaseId} className={rowLabel}>
							Annual amount increase (%)
						</label>
						<Input
							id={annualIncreaseId}
							name="annualIncrease"
							type="number"
							required
							disabled={locked}
							min="-50"
							max="50"
							step="0.1"
							value={draft.annualIncrease}
							onChange={(event) =>
								updateDraft({ annualIncrease: event.target.value }, "schedule")
							}
							className="min-w-0 flex-1"
						/>
					</div>
				)}
				{frequency === "once" && (
					<>
						<div className="flex items-center gap-4 border-t border-line py-2 first:border-t-0 first:pt-0 last:pb-0">
							<label htmlFor={claimRuleId} className={rowLabel}>
								Records an occurrence of
							</label>
							<Select
								id={claimRuleId}
								name="claimRuleId"
								disabled={!claimEditable}
								value={draft.claimRuleId}
								onChange={(event) =>
									updateDraft({ claimRuleId: event.target.value }, "schedule")
								}
								className="min-w-0 flex-1"
							>
								<option value="">No link — standalone record</option>
								{claimRules.map((rule) => (
									<option key={rule.id} value={rule.id}>
										{rule.name}
									</option>
								))}
							</Select>
						</div>
						<div className="flex items-center gap-4 border-t border-line py-2 first:border-t-0 first:pt-0 last:pb-0">
							<label htmlFor={claimOccurrenceId} className={rowLabel}>
								Replaces occurrence on
							</label>
							<Select
								id={claimOccurrenceId}
								name="claimOccurrenceDate"
								disabled={!claimEditable || !draft.claimRuleId}
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
									{!draft.claimRuleId
										? "Choose a rule first"
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
					</>
				)}
			</div>
		</section>
	);
}

/**
 * Schedule stated only for recurring rules: one-time transactions need no
 * label. Defaults stay silent: yearly change of zero, an open end date, and
 * "included" never render. In edit mode the same sentence carries date
 * controls in the same positions; structural settings live under More
 * options so the collapsed edit view matches the read view line for line.
 */
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
	claimRuleName,
	ruleCadence,
	editing,
	locked,
	scheduleControlId,
	occurrenceOptions,
}: {
	savedTransaction: Transaction;
	draft: TransactionDraft;
	updateDraft: (patch: Partial<TransactionDraft>, field: EditField) => void;
	claimRuleName?: string | null;
	/** Stored cadence from the raw rule, shown while it loads. */
	ruleCadence?: string | null;
	editing: boolean;
	locked: boolean;
	/** DOM id for the first schedule control. */
	scheduleControlId?: string;
	/** Scheduled dates of the selected rule, closest to the posted day first. */
	occurrenceOptions: string[];
}) {
	const id = useId();
	const frequency = draft.frequency;
	const claimEditable = !locked || canClaimOccurrence(savedTransaction);
	if (frequency === "once") {
		if (!draft.claimRuleId) return null;
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
						name="claimRuleId"
						disabled={!claimEditable}
						value={draft.claimRuleId}
						onChange={(event) =>
							updateDraft({ claimRuleId: event.target.value }, "schedule")
						}
					>
						<option value="">No link</option>
						{draft.claimRuleId && (
							<option value={draft.claimRuleId}>
								{claimRuleName ?? draft.claimRuleId}
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
						Recurring transaction
					</strong>
					<span className="text-xs text-muted">
						{ruleCadence ?? frequencyLabel(frequency)}
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
	// Void holds are the only read-only rows with an action attached: the
	// picker and remove flow below. Other locked rows stay unexplained,
	// matching the read-only treatment elsewhere in the modal.
	if (!savedTransaction.readOnly || !savedTransaction.void) return null;
	return (
		<Notice className="my-4">
			<LockKeyhole size={18} className="mt-px" aria-hidden="true" />
			This hold vanished without posting, so there is nothing to edit.
			{!appReadOnly &&
				" If it posted after all, pick the posted charge below and remove this record."}
		</Notice>
	);
}
function readOnlyReasonFor(savedTransaction: Transaction): string | undefined {
	return savedTransaction.amountKnown === false
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
	frequency: FrequencyChoice;
	startDate: string;
	endDate: string;
	noEndDate: boolean;
	annualIncrease: string;
	enabled: boolean;
	claimRuleId: string;
	claimOccurrenceDate: string;
	postedDate: string;
	transactionTime: string;
};

function draftFromTransaction(
	savedTransaction: Transaction,
	ruleFrequencyChoice: FrequencyChoice,
): TransactionDraft {
	return {
		name: savedTransaction.name,
		amount: String(savedTransaction.amount),
		fromId: savedTransaction.fromId ?? "",
		toId: savedTransaction.toId ?? "",
		frequency:
			savedTransaction.kind === "posting" ? "once" : ruleFrequencyChoice,
		startDate: savedTransaction.startDate,
		endDate: savedTransaction.endDate ?? "",
		noEndDate: savedTransaction.endDate == null,
		annualIncrease: String(savedTransaction.annualIncrease),
		enabled: savedTransaction.enabled,
		claimRuleId: savedTransaction.claimRuleId ?? "",
		claimOccurrenceDate: savedTransaction.claimOccurrenceDate ?? "",
		postedDate: savedTransaction.postedDate ?? "",
		transactionTime: timeOfDay(savedTransaction.transactionTime),
	};
}

/**
 * Pending bank rows stay locked, but the occurrence claim lives outside the
 * synced columns and the pending-to-posted convert keeps the same row id,
 * so claiming while pending survives refreshes and settlement. Derived from
 * the row itself at each use site; no exception flag is passed.
 */
function canClaimOccurrence(transaction: Transaction): boolean {
	return (
		transaction.kind === "posting" &&
		transaction.pending === true &&
		transaction.syncOwned === true
	);
}

function useTransactionEdit({
	savedTransaction,
	readOnly: readOnlyProp,
	onClose,
	ruleFrequencyChoice,
}: {
	savedTransaction: Transaction;
	readOnly?: boolean;
	onClose: () => void;
	ruleFrequencyChoice: FrequencyChoice;
}) {
	// Only the clicked value is editable; null renders the pure read view.
	const [activeField, setActiveField] = useState<EditField | null>(null);
	const [touched, setTouched] = useState(false);
	const [confirmCancel, setConfirmCancel] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const edit = useEditDraft(
		savedTransaction.id,
		draftFromTransaction(savedTransaction, ruleFrequencyChoice),
	);
	const draft = edit.value;
	const formId = useId();
	const rowReason = readOnlyReasonFor(savedTransaction);
	const readOnlyReason = readOnlyProp ? "Read-only." : rowReason;
	const claimEditable = canClaimOccurrence(savedTransaction);
	useBeforeUnload(activeField !== null && touched && !saving);
	const updateDraft = (patch: Partial<TransactionDraft>, field: EditField) => {
		if (readOnlyReason) {
			// Pending bank rows refresh in place, so only the occurrence
			// claim may change while locked. Any other schedule patch
			// (dates, frequency) stays blocked.
			if (!claimEditable || field !== "schedule") return;
			const keys = Object.keys(patch);
			if (
				keys.length === 0 ||
				!keys.every(
					(key) => key === "claimRuleId" || key === "claimOccurrenceDate",
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
		const once = draft.frequency === "once";
		const values = detailFormValues({
			draft,
			item: savedTransaction,
			isOnce: once,
		});
		if (values instanceof Error) {
			setError(values.message);
			return;
		}
		setSaving(true);
		setError(null);
		// Direct row write. Conversions state an explicit new body; updates
		// carry unedited fields over from the canonical raw row because the
		// backend replaces the full authored row.
		const wasOnce = savedTransaction.kind === "posting";
		const nowOnce = values.frequency === "once";
		if (wasOnce !== nowOnce) {
			const ok = await performSave({
				call: () =>
					convertTransaction(savedTransaction.id, {
						kind: nowOnce ? "posting" : "rule",
						...(nowOnce
							? { posting: postingBody(values) }
							: { rule: ruleBody(values) }),
					}),
				refresh: refreshTransactions,
				failureMessage: "The transaction could not be saved.",
			});
			setSaving(false);
			// Keep failed form values; return to the underlying view only
			// after confirmed save.
			if (ok) onClose();
			else
				setError(
					"The transaction could not be saved. Review the workspace notice and try again.",
				);
			return;
		}
		const model = getServerModel()?.model;
		// The backend replaces the full authored row, so updates need the
		// canonical raw row; conversions state explicit new bodies instead.
		const raw = nowOnce
			? model?.postings.find((row) => row.id === savedTransaction.id)
			: model?.recurrenceRules.find((row) => row.id === savedTransaction.id);
		if (!raw) {
			setSaving(false);
			setError(
				"The saved transaction could not be loaded. Close and try again.",
			);
			return;
		}
		const ok = await performSave({
			call: () =>
				"postedTime" in raw
					? updatePosting(
							savedTransaction.id,
							postingUpdateBody({ baseline: savedTransaction, raw, values }),
						)
					: updateRule(
							savedTransaction.id,
							ruleUpdateBody({ baseline: savedTransaction, raw, values }),
						),
			refresh: refreshTransactions,
			failureMessage: "The transaction could not be saved.",
		});
		setSaving(false);
		// Keep failed form values; return to the underlying view only after
		// confirmed save.
		if (ok) onClose();
		else
			setError(
				"The transaction could not be saved. Review the workspace notice and try again.",
			);
	};
	// The submitter only mounts once an edit starts, so no in-flight
	// activation can ever land on it: read mode renders no actions at all.
	// Pending claimable rows save schedule-claim edits while locked.
	const saveBlocked =
		saving ||
		(Boolean(readOnlyReason) && !(claimEditable && activeField === "schedule"));
	const actions =
		activeField === null ? undefined : (
			<>
				<IconButton
					icon={RotateCcw}
					label="Discard changes"
					onClick={exitEdit}
				/>
				<IconButton
					icon={Save}
					label="Save changes"
					type="submit"
					form={formId}
					disabled={saveBlocked}
				/>
			</>
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
 * Authoritative rule-existence check for subscription retries. The cache may
 * be stale after a saved-but-refresh-failed attempt, so a cache miss falls
 * back to one server read before any create. Never generates a rule.
 */
async function ruleExistsAuthoritative(ruleId: string): Promise<boolean> {
	if (
		getServerModel()?.model?.recurrenceRules.some((rule) => rule.id === ruleId)
	)
		return true;
	try {
		const fresh = await serverQueryClient().fetchQuery(
			modelOptions(getUserScope()),
		);
		return (
			fresh.model?.recurrenceRules.some((rule) => rule.id === ruleId) ?? false
		);
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
	// Pinned retry identity: if the rule create succeeded but the claim (or
	// its refresh) failed, retry reuses the same rule instead of silently
	// generating a replacement. No global draft or persistent state.
	const attemptRef = useRef<{ ruleId: string } | null>(null);
	const canClaimPending = canClaimOccurrence(savedTransaction);
	const available =
		savedTransaction.kind === "posting" &&
		!savedTransaction.claimRuleId &&
		(!locked || canClaimPending);
	const mark = async () => {
		if (saving) return;
		const ruleId = attemptRef.current?.ruleId ?? crypto.randomUUID();
		attemptRef.current = { ruleId };
		const conversion = buildSubscriptionConversion(savedTransaction, {
			ruleId,
		});
		if (conversion instanceof Error) {
			setError(conversion.message);
			return;
		}
		// Pin the original user scope across both writes: a scope change
		// between the rule create and the claim must not start the old claim
		// under the new user.
		const scope = getUserScope();
		setSaving(true);
		setError(null);
		// Preserve the source posting: create the rule first, then claim the
		// posting as its occurrence. Refresh even after partial failure so a
		// created rule is visible while the claim error stays on screen.
		const ruleValues = {
			name: conversion.rule.name,
			amount: conversion.rule.amount,
			annualIncrease: conversion.rule.annualIncrease,
			fromId: conversion.rule.fromId,
			toId: conversion.rule.toId,
			frequency: conversion.rule.frequency,
			startDate: conversion.rule.startDate,
			endDate: conversion.rule.endDate,
			postedDate: null,
			enabled: conversion.rule.enabled,
			claimRuleId: null,
			claimOccurrenceDate: null,
		} as const;
		let ruleOk = await ruleExistsAuthoritative(ruleId);
		if (!ruleOk) {
			ruleOk = await performSave({
				call: () =>
					createRule({ ...ruleBody(ruleValues), id: conversion.rule.id }),
				refresh: refreshTransactions,
				failureMessage: "The subscription rule could not be created.",
			});
			if (getUserScope() !== scope) {
				setSaving(false);
				setError(
					"The signed-in user changed. Close and review before retrying.",
				);
				return;
			}
			if (!ruleOk) {
				setSaving(false);
				setError(
					"The subscription rule could not be created. Review the workspace notice and try again.",
				);
				return;
			}
		}
		// Claim from the raw posting with only the claim changed: timestamps,
		// amount descriptor, destinations, and purchase policy stay
		// byte-identical instead of being rebuilt from display values.
		const raw = getServerModel()?.model?.postings.find(
			(row) => row.id === savedTransaction.id,
		);
		if (!raw) {
			setSaving(false);
			setError(
				"The saved transaction could not be loaded. Close and try again.",
			);
			return;
		}
		const claimOk = await performSave({
			call: () =>
				updatePosting(
					raw.id,
					claimPostingBody(
						raw,
						ruleId,
						conversion.claimed.claimOccurrenceDate ??
							conversion.claimed.startDate,
					),
				),
			refresh: refreshTransactions,
			failureMessage: "The source transaction could not be claimed.",
		});
		setSaving(false);
		if (claimOk) {
			attemptRef.current = null;
			onDone();
		} else
			setError(
				"The rule was created, but the source transaction could not be claimed. Review the workspace notice and try again.",
			);
	};
	return { available, marking: saving, error, mark };
}

function DiscardConfirm({
	onContinue,
	onDiscard,
}: {
	onContinue: () => void;
	onDiscard: () => void;
}) {
	return (
		<Notice tone="danger" className="block w-full" role="alert">
			<p className="mb-3 text-sm text-danger-text">
				Discard the changes in this form?
			</p>
			<div className="flex flex-wrap gap-2">
				<Button type="button" variant="secondary" onClick={onContinue}>
					Continue
				</Button>
				<Button type="button" variant="danger" onClick={onDiscard}>
					Discard changes
				</Button>
			</div>
		</Notice>
	);
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
	claimRuleName,
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
	claimRuleName?: string | null;
	shortfallLabel?: string;
	onClose: () => void;
}) {
	const kind =
		transaction.category === "transfer"
			? ("transfer" as const)
			: transaction.direction;
	// Cadence of the rule this row displays, read from the rule rows the
	// rules endpoint returns. Display-only; the editor keeps its own
	// monthly/yearly choice.
	const savedRules = useSavedRules();
	const rawRules = savedRules ?? undefined;
	const rawRule =
		savedTransaction.kind === "rule"
			? rawRules?.find((rule) => rule.id === savedTransaction.id)
			: undefined;
	const ruleCadence = rawRule ? frequencyLabel(rawRule.frequency) : null;
	const ruleFrequencyChoice: FrequencyChoice =
		rawRule === undefined ? "monthly" : frequencyChoiceOf(rawRule.frequency);
	const edit = useTransactionEdit({
		savedTransaction,
		readOnly,
		onClose,
		ruleFrequencyChoice,
	});
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [confirmingVoidRemove, setConfirmingVoidRemove] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const once = savedTransaction.kind === "posting";
	const canEdit = !edit.readOnlyReason;
	// Settled bank rows are editable and removable through the UI: removing
	// one suppresses its bank ids, so the feed will not re-import it.
	// Live pending holds stay locked: each feed refreshes them in place,
	// so an edit could not survive the next refresh.
	const canDelete = canEdit && !savedTransaction.pending;
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
			...(savedRules ?? []).map(ruleToDisplay),
		];
		const byId = new Map(rows.map((row) => [row.id, row]));
		return [...byId.values()];
	}, [savedTransactions, transactions, savedTransaction, savedRules]);
	// Claim candidates: the selected rule's scheduled dates through today,
	// closest to the day the posting actually happened first, already
	// claimed dates removed. The row's own saved claim always stays listed.
	const postedRef = savedTransaction.postedDate ?? savedTransaction.startDate;
	const occurrenceOptions = useMemo(() => {
		const ruleId = edit.draft.claimRuleId;
		const rule = ruleId
			? rawRules?.find((row) => row.id === ruleId)
			: undefined;
		if (!rule) return [];
		const claimed = new Set<string>();
		for (const row of allTransactions) {
			if (
				row.id !== savedTransaction.id &&
				row.claimRuleId === ruleId &&
				row.claimOccurrenceDate
			)
				claimed.add(row.claimOccurrenceDate);
		}
		const candidates = claimOccurrenceCandidates({
			rule,
			through: todayIso(),
			postedRef,
			claimed,
		});
		const own = edit.draft.claimOccurrenceDate;
		return own && !candidates.includes(own) ? [own, ...candidates] : candidates;
	}, [
		edit.draft.claimRuleId,
		edit.draft.claimOccurrenceDate,
		rawRules,
		allTransactions,
		savedTransaction.id,
		postedRef,
	]);
	const voidCandidates = transaction.void
		? voidSettleCandidates({
				voidRow: savedTransaction,
				transactions: allTransactions,
			})
		: [];
	const [postedPick, setPostedPick] = useState<string | null>(null);
	// The closest candidate is the suggested posted version, so the
	// confirmation states the link without an extra choice. An explicit empty
	// pick keeps "No link", and a stale pick from another row falls back to
	// the current candidate set.
	const effectivePick =
		postedPick === ""
			? ""
			: postedPick !== null &&
				  voidCandidates.some((candidate) => candidate.id === postedPick)
				? postedPick
				: (voidCandidates[0]?.id ?? "");
	const pickedPosted = voidCandidates.find(
		(candidate) => candidate.id === effectivePick,
	);
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
				savedTransaction.kind === "posting"
					? deletePosting(savedTransaction.id)
					: deleteRule(savedTransaction.id),
			refresh,
			...(recover ? { recover } : {}),
			failureMessage,
		});
		setDeleting(false);
		if (ok) onClose();
		else setDeleteError(failureMessage);
	};
	const removeTransaction = () =>
		finishRemoval(refreshTransactions, "The transaction could not be removed.");
	// A vanished hold is inert unless an evaluation names it or it supplies
	// the projection start date. In the common case, drop the row from the
	// narrow lists and leave the projection model untouched. A failed delete
	// still reloads authoritative state, so the row never disappears early.
	const removeVanishedHold = () =>
		finishRemoval(
			transactionRemovalNeedsProjectionRefresh(savedTransaction.id)
				? refreshTransactions
				: () => removeDeletedTransactionFromCache(savedTransaction.id),
			"The vanished hold could not be removed.",
			refreshTransactions,
		);
	// A void hold's suggestion merges it into the posted charge. The posted
	// charge keeps its amount and date; an occurrence recorded on the hold
	// moves to it when the charge records none.
	const mergeVoidHold = async (candidateId: string): Promise<boolean> => {
		if (deleting || readOnly) return false;
		const candidate = allTransactions.find((row) => row.id === candidateId);
		if (!candidate || candidate.void || candidate.pending) return false;
		const claimRuleId = savedTransaction.claimRuleId;
		const claimOccurrenceDate = savedTransaction.claimOccurrenceDate;
		setDeleting(true);
		setDeleteError(null);
		if (claimRuleId && claimOccurrenceDate && !candidate.claimRuleId) {
			const raw = getServerModel()?.model?.postings.find(
				(row) => row.id === candidateId,
			);
			if (!raw) {
				setDeleting(false);
				setDeleteError(
					"The posted charge could not be loaded. Close and try again.",
				);
				return false;
			}
			const claimed = await performSave({
				call: () =>
					updatePosting(
						candidateId,
						claimPostingBody(raw, claimRuleId, claimOccurrenceDate),
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
			call: () => deletePosting(savedTransaction.id),
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
						postingId: savedTransaction.id,
						voidRow: savedTransaction,
						transactions: allTransactions,
					})
				: [],
		[once, findingsQuery.data?.findings, savedTransaction, allTransactions],
	);
	// A void hold is read-only as a row, but its merge suggestion stays
	// actionable for the owner. Only the app-level read-only gate blocks it.
	const insightReadOnly = savedTransaction.void
		? Boolean(readOnly)
		: Boolean(readOnly ?? savedTransaction.readOnly);
	const sharedIntents = useMemo(
		() =>
			(grantsQuery.data ?? []).filter(
				(grant) => grant.postingId === savedTransaction.id,
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
			{savedTransaction.kind === "rule" && (
				<span
					title="Recurring transaction"
					aria-label="Recurring transaction"
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
	if (canDelete) {
		menuItems.push({
			id: "delete",
			label: "Delete transaction",
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
				className="scroll-smooth max-sm:fixed max-sm:inset-0 max-sm:m-0 max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:overflow-y-auto max-sm:rounded-none max-sm:border-0"
				onCloseRequest={edit.requestClose}
				actions={
					<>
						<ActionMenu
							label="More options"
							menuLabel="Transaction actions"
							items={menuItems}
						/>
						{edit.actions}
					</>
				}
				onClose={onClose}
				focusPanelOnOpen
			>
				<form id={edit.formId} onSubmit={(event) => void edit.submit(event)}>
					{subscription.error && <ErrorNotice message={subscription.error} />}
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
										readOnly={!canEdit}
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
								{hasStatusPill && (
									<span className="text-muted" aria-hidden="true">
										·
									</span>
								)}
								<span className="text-sm text-muted">
									{associatedAccountLabel({
										fromAccount,
										toAccount,
										transaction,
									})}
								</span>
							</div>
						</div>
						{(once || transaction.pending || postedDiffers) && (
							<div className="flex min-w-0 flex-col items-start gap-2">
								{once && (
									<label className="inline-flex flex-wrap items-center gap-2 text-sm text-muted">
										Occurred
										<input
											className={transactionControlStyles({ shape: "date" })}
											id={`${edit.formId}-date`}
											type="date"
											name="startDate"
											required
											value={edit.draft.startDate}
											onChange={(event) =>
												edit.updateDraft(
													{ startDate: event.target.value },
													"schedule",
												)
											}
											readOnly={!canEdit}
										/>
										<input
											className={transactionControlStyles({ shape: "date" })}
											id={`${edit.formId}-time`}
											type="time"
											step="1"
											name="transactionTime"
											aria-label="Occurred at time (UTC)"
											value={edit.draft.transactionTime}
											onChange={(event) =>
												edit.updateDraft(
													{ transactionTime: event.target.value },
													"schedule",
												)
											}
											readOnly={!canEdit}
										/>
									</label>
								)}
								{(transaction.pending || postedDiffers) && (
									<label className="inline-flex flex-wrap items-center gap-2 text-sm text-muted">
										Posted
										{transaction.pending ? (
											<span>Not yet posted</span>
										) : (
											<input
												className={transactionControlStyles({ shape: "date" })}
												id={`${edit.formId}-posted`}
												type="date"
												name="postedDate"
												required
												value={edit.draft.postedDate}
												onChange={(event) =>
													edit.updateDraft(
														{ postedDate: event.target.value },
														"posted",
													)
												}
												readOnly={!canEdit}
											/>
										)}
									</label>
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
							claimRuleName={
								savedTransaction.claimRuleId
									? (allTransactions.find(
											(item) => item.id === savedTransaction.claimRuleId,
										)?.name ?? claimRuleName)
									: null
							}
							ruleCadence={ruleCadence}
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
						occurrenceOptions={occurrenceOptions}
					/>
					{transaction.void && !readOnly && (
						<div className="mt-4 flex min-w-0 flex-col items-start gap-2">
							<SelectField
								label="Posted as"
								name="postedVersion"
								value={effectivePick}
								onChange={(event) => setPostedPick(event.target.value)}
							>
								<option value="">No link — just remove</option>
								{voidCandidates.map((candidate) => (
									<option key={candidate.id} value={candidate.id}>
										{candidate.name} — {money(candidate.amount)} on{" "}
										{dateLabel(candidate.startDate, true)}
									</option>
								))}
							</SelectField>
							<Button
								type="button"
								variant="danger"
								size="sm"
								onClick={() => {
									setDeleteError(null);
									setConfirmingVoidRemove(true);
								}}
							>
								<Trash2 size={16} aria-hidden="true" />
								Remove vanished hold
							</Button>
						</div>
					)}
					{edit.error && <ErrorNotice message={edit.error} />}
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
						postingId={savedTransaction.id}
						readOnly={Boolean(readOnly ?? savedTransaction.readOnly)}
					/>
				)}
				{once && (
					<div id={`${edit.formId}-receipts`} className="scroll-mt-4">
						<ReceiptPanel
							postingId={savedTransaction.id}
							readOnly={Boolean(readOnly ?? savedTransaction.readOnly)}
						/>
					</div>
				)}
				<div className="sticky bottom-0 z-10 -mx-8 -mb-8 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-8 py-3 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:mx-0 max-sm:mb-0 max-sm:px-5">
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
								{savedTransaction.kind === "rule" && (
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
											ruleCadence
												? `Recurring rule: ${ruleCadence}. Go to schedule`
												: "Recurring rule. Go to schedule"
										}
									>
										<Repeat size={14} aria-hidden="true" />
										<span>{ruleCadence ?? "Recurring rule"}</span>
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
						postingId={savedTransaction.id}
						readOnly={Boolean(readOnly ?? savedTransaction.readOnly)}
					/>
				</Modal>
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
					cancelLabel="Keep transaction"
					confirmLabel="Delete transaction"
					busyLabel="Deleting…"
					busy={deleting}
					error={deleteError}
				>
					<p>
						This deletes the transaction immediately. It is removed from the
						saved model.
					</p>
				</ConfirmDialog>
			)}
			{confirmingVoidRemove && (
				<ConfirmDialog
					title={`Remove ${savedTransaction.name}?`}
					eyebrow="Changes"
					onCancel={() => {
						if (!deleting) {
							setConfirmingVoidRemove(false);
							setDeleteError(null);
						}
					}}
					onConfirm={() => void removeVanishedHold()}
					cancelLabel="Keep hold"
					confirmLabel="Remove hold"
					busyLabel="Removing…"
					busy={deleting}
					error={deleteError}
				>
					<p>
						{pickedPosted ? (
							<>
								It posted as {pickedPosted.name} for{" "}
								{money(pickedPosted.amount)} on{" "}
								{dateLabel(pickedPosted.startDate, true)}. The posted charge is
								untouched; this clears the vanished hold record.
							</>
						) : (
							"No posted charge was picked. This clears the vanished hold record."
						)}
					</p>
				</ConfirmDialog>
			)}
		</DetailPortal>
	);
}
