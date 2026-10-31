import { useEditDraft } from "../editors/useEditDraft.ts";
import {
	ArrowDown,
	ArrowDownLeft,
	ArrowRightLeft,
	ArrowUpRight,
	Banknote,
	Check,
	ChevronDown,
	Clock3,
	Link2,
	LockKeyhole,
	Repeat,
	RotateCcw,
	Save,
	Trash2,
	TriangleAlert,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
	useId,
	useRef,
	useState,
	type FormEvent,
	type ReactNode,
} from "react";
import type {
	AccountTransaction,
} from "../../domain/accountActivity.ts";
import { voidSettleCandidates } from "../../domain/accountActivity.ts";
import { dateLabel, money } from "../../domain/format.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
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
import { Badge } from "../Badge.tsx";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { Modal } from "../Modal.tsx";
import { Button, IconButton } from "../Button.tsx";
import { Notice } from "../Notice.tsx";
import { Checkbox, InputField, SelectField } from "../Field.tsx";
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
	getServerModel,
	modelOptions,
	refreshTransactions,
} from "../../state/workspaceResources.ts";
import { AccountOptions } from "../editors/AccountOptions.tsx";
import {
	timeOfDay,
	claimPostingBody,
	detailFormValues,
	postingBody,
	postingUpdateBody,
	ruleBody,
	ruleUpdateBody,
} from "../editors/transactionBodies.ts";
import { ReceiptPanel } from "../receipts/ReceiptPanel.tsx";
import { TransactionAnalysisPanel } from "../analysis/TransactionAnalysis.tsx";

type AccountRef = Pick<Account, "id" | "kind" | "color" | "name">;

/**
 * The detail opens above drawers that portal to model.body. Rendering the
 * native dialog as a sibling (rather than nested inside the drawer panel)
 * keeps drawer-level Escape/backdrop handling from also firing: the drawer's
 * keydown guard only acts on focus inside its own panel.
 */
function DetailPortal({ children }: { children: ReactNode }) {
	return createPortal(children, document.body);
}

function frequencyLabel(frequency: Transaction["frequency"]): string {
	switch (frequency) {
		case "monthly":
			return "Monthly";
		case "yearly":
			return "Yearly";
		case "once":
			return "One-time";
	}
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

function FrequencyOptions() {
	return (
		<>
			<option value="monthly">Monthly</option>
			<option value="yearly">Yearly</option>
			<option value="once">One time</option>
		</>
	);
}

function MoreOptions({
	savedTransaction,
	transactions,
	draft,
	updateDraft,
	locked,
}: {
	savedTransaction: Transaction;
	transactions: Transaction[];
	draft: TransactionDraft;
	updateDraft: (patch: Partial<TransactionDraft>, field: EditField) => void;
	locked: boolean;
}) {
	const id = useId();
	const frequency = draft.frequency;
	const onFrequency = (next: Transaction["frequency"]) =>
		updateDraft({ frequency: next }, "schedule");
	const claimRules = transactions.filter(
		(item) => item.frequency !== "once" && item.id !== savedTransaction.id,
	);
	return (
		<details className="group mt-4">
			<summary className="inline-flex w-fit cursor-pointer list-none items-center gap-1 rounded-control text-xs text-muted hover:text-ink hover:underline hover:underline-offset-4 [&::-webkit-details-marker]:hidden">
				<ChevronDown
					size={13}
					aria-hidden="true"
					className="transition-transform duration-150 ease-out group-open:rotate-90"
				/>
				More options
			</summary>
			<div className="mt-3 flex flex-col gap-3 rounded-surface border border-line bg-surface-2 p-4">
				<SelectField
					label="Frequency"
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
				>
					<FrequencyOptions />
				</SelectField>
				<InputField
					label="Annual amount increase (%)"
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
				/>
				{frequency === "once" && (
					<>
						<SelectField
							label="Records an occurrence of"
							name="claimRuleId"
							disabled={locked}
							value={draft.claimRuleId}
							onChange={(event) =>
								updateDraft({ claimRuleId: event.target.value }, "schedule")
							}
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
							type="date"
							name="claimOccurrenceDate"
							disabled={locked}
							value={draft.claimOccurrenceDate}
							onChange={(event) =>
								updateDraft(
									{ claimOccurrenceDate: event.target.value },
									"schedule",
								)
							}
						/>
					</>
				)}
				<label
					htmlFor={`${id}-enabled`}
					className="flex items-center gap-2 text-xs text-muted"
				>
					<Checkbox
						id={`${id}-enabled`}
						name="enabled"
						disabled={locked}
						checked={draft.enabled}
						onChange={(event) =>
							updateDraft({ enabled: event.target.checked }, "schedule")
						}
					/>
					Include in projections
				</label>
			</div>
		</details>
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
	draft,
	updateDraft,
	claimRuleName,
	editing,
	locked,
	scheduleControlId,
}: {
	draft: TransactionDraft;
	updateDraft: (patch: Partial<TransactionDraft>, field: EditField) => void;
	claimRuleName?: string | null;
	editing: boolean;
	locked: boolean;
	/** DOM id for the first schedule control. */
	scheduleControlId?: string;
}) {
	const id = useId();
	const frequency = draft.frequency;
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
						disabled={locked}
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
					<input
						className={transactionControlStyles({ shape: "date" })}
						aria-label="Replaces occurrence on"
						type="date"
						name="claimOccurrenceDate"
						readOnly={locked}
						value={draft.claimOccurrenceDate}
						onChange={(event) =>
							updateDraft(
								{ claimOccurrenceDate: event.target.value },
								"schedule",
							)
						}
					/>
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
						{frequencyLabel(frequency)}
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
 * for confirmation instead of navigating away.
 */
type EditField = "name" | "amount" | "from" | "to" | "schedule" | "posted";

type TransactionDraft = {
	name: string;
	amount: string;
	fromId: string;
	toId: string;
	frequency: Transaction["frequency"];
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

function draftFromTransaction(savedTransaction: Transaction): TransactionDraft {
	return {
		name: savedTransaction.name,
		amount: String(savedTransaction.amount),
		fromId: savedTransaction.fromId ?? "",
		toId: savedTransaction.toId ?? "",
		frequency: savedTransaction.frequency,
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

function useTransactionEdit({
	savedTransaction,
	readOnly: readOnlyProp,
	onClose,
}: {
	savedTransaction: Transaction;
	readOnly?: boolean;
	onClose: () => void;
}) {
	// Only the clicked value is editable; null renders the pure read view.
	const [activeField, setActiveField] = useState<EditField | null>(null);
	const [touched, setTouched] = useState(false);
	const [confirmCancel, setConfirmCancel] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const edit = useEditDraft(
		savedTransaction.id,
		draftFromTransaction(savedTransaction),
	);
	const draft = edit.value;
	const formId = useId();
	const rowReason = readOnlyReasonFor(savedTransaction);
	const readOnlyReason = readOnlyProp ? "Read-only." : rowReason;
	useBeforeUnload(activeField !== null && touched && !saving);
	const updateDraft = (patch: Partial<TransactionDraft>, field: EditField) => {
		if (readOnlyReason) return;
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
	const close = () => {
		if (activeField && touched) setConfirmCancel(true);
		else onClose();
	};
	const discardAndClose = () => {
		exitEdit();
		onClose();
	};
	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (readOnlyReason || saving) return;
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
		const wasOnce = savedTransaction.frequency === "once";
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
					disabled={Boolean(readOnlyReason) || saving}
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
		close,
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

function MarkAsSubscriptionAction({
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
	if (
		savedTransaction.frequency !== "once" ||
		savedTransaction.claimRuleId ||
		locked
	)
		return null;
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
	return (
		<div className="mt-4">
			<Button
				type="button"
				variant="secondary"
				size="sm"
				onClick={() => void mark()}
				disabled={saving}
			>
				<Repeat size={16} aria-hidden="true" />
				{saving ? "Marking…" : "Mark as subscription"}
			</Button>
			{error && <ErrorNotice message={error} />}
		</div>
	);
}

function DiscardConfirm({
	onContinue,
	onDiscard,
}: {
	onContinue: () => void;
	onDiscard: () => void;
}) {
	return (
		<Notice tone="danger" className="mt-6 block" role="alert">
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
	/** All saved transaction rows (claim options). */
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
	const edit = useTransactionEdit({
		savedTransaction,
		readOnly,
		onClose,
	});
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [confirmingVoidRemove, setConfirmingVoidRemove] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const once = savedTransaction.frequency === "once";
	const canEdit = !edit.readOnlyReason;
	// Settled bank rows are editable but never deletable through the UI:
	// a deleted settled row would be re-imported by the next sync, while
	// excluding it keeps it out of projections. Phantom voids go through
	// the dedicated remove flow below instead of the generic delete.
	const canDelete = canEdit && !savedTransaction.syncOwned;
	const voidCandidates = transaction.void
		? voidSettleCandidates({
				voidRow: savedTransaction,
				transactions: transactions ?? [],
			})
		: [];
	const [postedPick, setPostedPick] = useState("");
	// A pick that is not among the current candidates reads as unpicked,
	// which also resets the selection when the modal moves to another row.
	const effectivePick = voidCandidates.some(
		(candidate) => candidate.id === postedPick,
	)
		? postedPick
		: "";
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
	const hasStatusPill =
		transaction.pending ||
		transaction.source === "historical" ||
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
	const removeTransaction = async () => {
		if (deleting) return;
		setDeleting(true);
		setDeleteError(null);
		const ok = await performSave({
			call: () =>
				savedTransaction.frequency === "once"
					? deletePosting(savedTransaction.id)
					: deleteRule(savedTransaction.id),
			refresh: refreshTransactions,
			failureMessage: "The transaction could not be removed.",
		});
		setDeleting(false);
		if (ok) onClose();
		else setDeleteError("The transaction could not be removed.");
	};
	const fullAccounts = accounts as Account[];
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
			{savedTransaction.frequency !== "once" && (
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
	return (
		<DetailPortal>
			<Modal
				title={editHeading}
				titleSize="plain"
				headerClassName="border-b-0 pb-0"
				className="max-sm:m-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:max-w-none max-sm:overflow-y-auto max-sm:rounded-none"
				actions={edit.actions}
				onClose={edit.close}
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
								) : transaction.source === "historical" ? (
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
										<span className="inline-flex size-8 flex-none items-center justify-center rounded-surface border border-line bg-surface text-muted">
											<Banknote size={15} aria-hidden="true" />
										</span>
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
										<span className="inline-flex size-8 flex-none items-center justify-center rounded-surface border border-line bg-surface text-muted">
											<Banknote size={15} aria-hidden="true" />
										</span>
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
					<ScheduleCapsule
						draft={edit.draft}
						updateDraft={edit.updateDraft}
						claimRuleName={claimRuleName}
						editing={edit.activeField === "schedule"}
						locked={!canEdit}
						scheduleControlId={`${edit.formId}-schedule`}
					/>
					<MarkAsSubscriptionAction
						savedTransaction={savedTransaction}
						locked={!canEdit}
						onDone={onClose}
					/>
					<MoreOptions
						savedTransaction={savedTransaction}
						transactions={transactions ?? [savedTransaction]}
						draft={edit.draft}
						updateDraft={edit.updateDraft}
						locked={!canEdit}
					/>
					{canDelete && (
						<div className="mt-4">
							<Button
								type="button"
								variant="danger"
								size="sm"
								onClick={() => {
									setDeleteError(null);
									setConfirmingDelete(true);
								}}
							>
								<Trash2 size={16} aria-hidden="true" />
								Delete transaction
							</Button>
						</div>
					)}
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
					{edit.confirmCancel && (
						<DiscardConfirm
							onContinue={() => edit.setConfirmCancel(false)}
							onDiscard={edit.discardAndClose}
						/>
					)}
					<ReadOnlyNotice savedTransaction={savedTransaction} appReadOnly={readOnly} />
				</form>
				{once && (
					<TransactionAnalysisPanel
						postingId={savedTransaction.id}
						readOnly={Boolean(readOnly ?? savedTransaction.readOnly)}
					/>
				)}
				{once && (
					<ReceiptPanel
						postingId={savedTransaction.id}
						readOnly={Boolean(readOnly ?? savedTransaction.readOnly)}
					/>
				)}
			</Modal>
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
					onConfirm={() => void removeTransaction()}
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
								{dateLabel(pickedPosted.startDate, true)}. The posted
								charge is untouched; this clears the vanished hold
								record.
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
