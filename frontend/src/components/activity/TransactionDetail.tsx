import { useEditDraft } from "../editors/useEditDraft.ts";
import {
	ArrowDown,
	CalendarDays,
	Check,
	Clock3,
	Ellipsis,
	Eye,
	EyeOff,
	LockKeyhole,
	Repeat,
	Trash2,
	TriangleAlert,
	UsersRound,
	type LucideIcon,
} from "lucide-react";
import { useId, useMemo, useRef, useState, type FormEvent } from "react";
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
import { Badge } from "@/components/ui/badge.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet.tsx";
import { Button } from "@/components/ui/button.tsx";

import { Field, FieldError, FieldLabel } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select.tsx";
import { TransactionDateModal } from "./TransactionDateModal.tsx";
import {
	MoreOptions,
	ScheduleCapsule,
	canClaimOccurrence,
	draftFromTransaction,
	type EditField,
	type TransactionDraft,
} from "./TransactionDetailSchedule.tsx";
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
import {
	claimUpdate,
	detailTransactionValues,
	detailScheduleValues,
	transactionUpdate,
	scheduleUpdate,
} from "../editors/transactionBodies.ts";
import type { Frequency } from "@/api/contracts.ts";
import { ReceiptPanel } from "../receipts/ReceiptPanel.tsx";
import { TransactionAnalysisPanel } from "../analysis/TransactionAnalysis.tsx";
import { TransferLinkSection } from "./TransferLinkSection.tsx";
import { scheduleHistoryTransactions } from "../../domain/scheduleHistory.ts";
import { ScheduleHistory } from "./ScheduleHistory.tsx";
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
		<Alert role="note" className="my-4">
			<LockKeyhole size={18} className="mt-px" aria-hidden="true" />
			<AlertDescription>
				This hold vanished without a posted charge. You can edit it or restore
				it as a settled record.
				{!appReadOnly &&
					" If it posted after all, pick the posted charge below and remove this record."}
			</AlertDescription>
		</Alert>
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
	// Standard form state: every permitted field stays editable and the
	// footer Save commits. activeField only feeds the locked-row
	// claim-only permission gate below, never UI activation.
	const [activeField, setActiveField] = useState<EditField | null>(null);
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
	// Unload protection covers unsaved edits or an in-flight save.
	useBeforeUnload(edit.dirty || saving);
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
		setError(null);
		setConfirmCancel(false);
	};
	// Discard restores the read view with the savedTransaction's own values.
	// Focus returns through the sheet's own dismissal path.
	const exitEdit = () => {
		edit.reset();
		setActiveField(null);
		setError(null);
		setConfirmCancel(false);
	};
	// Close requests run before the dialog exit animation. An in-flight
	// save blocks the request outright; unsaved edits open the nested
	// discard confirmation while the sheet stays mounted.
	const requestClose = () => {
		if (saving) return false;
		if (edit.dirty) {
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
	// Footer Save stays disabled until there are changes, the save
	// finishes, or the row permits it. Locked claimable rows save
	// schedule-claim edits while locked.
	const saveBlocked =
		saving ||
		(savedTransaction.kind === "schedule" &&
			storedScheduleFrequency === undefined) ||
		(Boolean(readOnlyReason) && !(claimEditable && activeField === "schedule"));
	return {
		draft,
		updateDraft,
		confirmCancel,
		setConfirmCancel,
		error,
		formId,
		dirty: edit.dirty,
		saveBlocked,
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
	const [removingClaim, setRemovingClaim] = useState(false);
	const [claimRemoveError, setClaimRemoveError] = useState<string | null>(null);
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
	const accountNameById = useMemo(
		() => new Map(accounts.map((account) => [account.id, account.name])),
		[accounts],
	);
	const fromAccountLabel = (value: string | null): string => {
		if (!value) return "External income";
		return accountNameById.get(value) ?? "Unknown account";
	};
	const toAccountLabel = (value: string | null): string => {
		if (!value) return "External spending";
		return accountNameById.get(value) ?? "Unknown account";
	};
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
	// Direct release of the saved occurrence claim. The row itself stays;
	// only the link to the schedule occurrence is removed.
	const removeClaim = async () => {
		if (removingClaim || readOnly || !savedTransaction.claimScheduleId) return;
		setRemovingClaim(true);
		setClaimRemoveError(null);
		const ok = await performSave({
			call: () => releaseOccurrence(savedTransaction.id),
			refresh: refreshTransactions,
			failureMessage: "The occurrence could not be removed.",
		});
		setRemovingClaim(false);
		if (!ok) setClaimRemoveError("The occurrence could not be removed.");
	};
	const claimRemovable =
		!readOnly &&
		savedTransaction.kind === "transaction" &&
		savedTransaction.claimScheduleId !== null &&
		(!edit.readOnlyReason || canClaimOccurrence(savedTransaction));
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
	const scheduleSectionRef = useRef<HTMLDivElement | null>(null);
	const scheduleControlRef = useRef<HTMLInputElement | null>(null);
	const scrollToSchedule = () => {
		scheduleSectionRef.current?.scrollIntoView({ block: "start" });
		scheduleControlRef.current?.focus();
	};
	const editHeading = (
		<span className="flex min-w-0 items-center gap-2">
			<span className="min-w-0 flex-1 truncate">{savedTransaction.name}</span>
			{savedTransaction.kind === "schedule" && (
				<Badge variant="secondary">
					<Repeat size={16} aria-hidden="true" />
					Schedule
				</Badge>
			)}
		</span>
	);
	type DetailMenuItem = {
		id: string;
		label: string;
		icon?: LucideIcon;
		onSelect: () => void;
		checked?: boolean;
		tone?: "default" | "danger";
		disabled?: boolean;
	};
	const menuItems: DetailMenuItem[] = [];
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
			onSelect: () => {
				setDeleteError(null);
				setConfirmingDelete(true);
			},
		});
	}
	const saveError = [subscription.error, edit.error, claimRemoveError]
		.filter(Boolean)
		.join(" ");
	return (
		<Sheet
			open
			onOpenChange={(open) => {
				if (!open && edit.requestClose()) onClose();
			}}
		>
			<SheetContent side="right" className="data-[side=right]:sm:max-w-xl">
				<SheetHeader>
					<div className="flex min-w-0 items-start justify-between gap-2 pr-8">
						<SheetTitle className="min-w-0">{editHeading}</SheetTitle>
						<div className="flex flex-none items-center gap-1">
							{menuItems.length > 0 && (
								<DropdownMenu>
									<DropdownMenuTrigger
										render={
											<Button
												variant="ghost"
												size="icon"
												aria-label="More options"
												title="More options"
											>
												<Ellipsis aria-hidden="true" />
											</Button>
										}
									/>
									<DropdownMenuContent
										align="end"
										aria-label={
											savedTransaction.kind === "schedule"
												? "Schedule actions"
												: "Transaction actions"
										}
									>
										{menuItems.map((item) => {
											const Icon = item.icon;
											const label = (
												<>
													{Icon && <Icon size={14} aria-hidden="true" />}
													<span>{item.label}</span>
												</>
											);
											return item.checked === undefined ? (
												<DropdownMenuItem
													key={item.id}
													disabled={item.disabled}
													variant={
														item.tone === "danger" ? "destructive" : "default"
													}
													onClick={() => item.onSelect()}
												>
													{label}
												</DropdownMenuItem>
											) : (
												<DropdownMenuCheckboxItem
													key={item.id}
													checked={item.checked}
													disabled={item.disabled}
													onCheckedChange={() => item.onSelect()}
												>
													{label}
												</DropdownMenuCheckboxItem>
											);
										})}
									</DropdownMenuContent>
								</DropdownMenu>
							)}
						</div>
					</div>
					<SheetDescription className="sr-only">
						{savedTransaction.kind === "schedule"
							? "Recurring schedule details"
							: "Transaction details"}
					</SheetDescription>
				</SheetHeader>
				<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
					<form id={edit.formId} onSubmit={(event) => void edit.submit(event)}>
						<div className="flex flex-col gap-3 pt-1 pb-2">
							<Field>
								<FieldLabel htmlFor={`${edit.formId}-name`}>
									{savedTransaction.kind === "schedule"
										? "Schedule name"
										: "Transaction name"}
								</FieldLabel>
								<Input
									id={`${edit.formId}-name`}
									name="name"
									required
									maxLength={100}
									value={edit.draft.name}
									onChange={(event) =>
										edit.updateDraft({ name: event.target.value }, "name")
									}
									readOnly={!canEdit}
									form={edit.formId}
								/>
							</Field>
							<div className="flex min-w-0 flex-col gap-2">
								{showAmount && (
									<Field>
										<FieldLabel htmlFor={`${edit.formId}-amount`}>
											Amount (USD)
										</FieldLabel>
										<InputGroup className="w-auto max-w-full">
											<InputGroupAddon aria-hidden="true">
												{transaction.amount === 0
													? "$"
													: `${transaction.direction === "in" ? "+" : "−"}$`}
											</InputGroupAddon>
											<InputGroupInput
												id={`${edit.formId}-amount`}
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
													edit.updateDraft(
														{ amount: event.target.value },
														"amount",
													)
												}
												readOnly={
													!canEdit || savedTransaction.amountKnown === false
												}
												className={
													transaction.direction === "in"
														? "text-lg font-medium text-success-text tabular-nums"
														: "text-lg font-medium tabular-nums"
												}
											/>
										</InputGroup>
									</Field>
								)}
								<div className="flex flex-wrap items-center gap-2">
									{transaction.void ? (
										<Badge variant="secondary">
											Did not post
											<span className="sr-only">
												bank hold that did not post
											</span>
										</Badge>
									) : transaction.pending ? (
										<Badge variant="secondary">
											<Clock3 size={10} aria-hidden="true" />
											Pending
										</Badge>
									) : showPosted ? (
										<Badge variant="secondary">
											<Check size={10} aria-hidden="true" />
											Posted
										</Badge>
									) : null}
									{showExcluded && (
										<Badge variant="secondary">Excluded from account</Badge>
									)}
									{showShortfall && (
										<Badge variant="secondary">
											<TriangleAlert size={10} aria-hidden="true" />
											{shortfallLabel ?? "Shortfall"}
										</Badge>
									)}
									{!savedTransaction.enabled &&
										!transaction.pending &&
										!transaction.void &&
										!showExcluded && (
											<Badge variant="secondary">Excluded</Badge>
										)}
									{savedTransaction.amountKnown === false && (
										<Badge variant="secondary">Calculated</Badge>
									)}
									{accountRoute && (
										<>
											{hasStatusPill && (
												<span
													className="text-muted-foreground"
													aria-hidden="true"
												>
													·
												</span>
											)}
											<span
												title={accountRoute}
												className="block max-w-[32ch] truncate text-xs text-muted-foreground"
											>
												{accountRoute}
											</span>
										</>
									)}
								</div>
							</div>
							{(once || transaction.pending || postedDiffers) && (
								<div className="flex min-w-0 flex-col items-start gap-2">
									{once && (
										<div className="inline-flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
											<span>Occurred</span>
											{canEdit ? (
												<Button
													type="button"
													variant="ghost"
													size="sm"
													id={`${edit.formId}-date`}
													onClick={() => setDatesOpen(true)}
												>
													<CalendarDays size={14} aria-hidden="true" />
													{dateLabel(edit.draft.startDate, true)}
												</Button>
											) : (
												<span className="text-sm font-medium text-foreground">
													{dateLabel(edit.draft.startDate, true)}
												</span>
											)}
										</div>
									)}
									{(transaction.pending || postedDiffers) && (
										<div className="inline-flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
											<span>Posted</span>
											{transaction.pending ? (
												<span>Not yet posted</span>
											) : (
												<span className="text-sm font-medium text-foreground">
													{dateLabel(edit.draft.postedDate, true)}
												</span>
											)}
										</div>
									)}
								</div>
							)}
						</div>
						{kind === "transfer" && (
							<section aria-label="Transfer details" className="mt-5">
								<h3 className="mb-3 text-sm font-semibold">Transfer details</h3>
								<Card size="sm">
									<CardContent className="flex flex-col gap-3">
										<Field>
											<FieldLabel htmlFor={`${edit.formId}-from`}>
												From account
											</FieldLabel>
											<div className="flex items-center gap-3">
												{fromAccount ? (
													<AccountIcon account={fromAccount} />
												) : (
													<AccountIconFallback />
												)}
												<Select
													value={edit.draft.fromId}
													disabled={!canEdit}
													onValueChange={(value) => {
														if (value !== null)
															edit.updateDraft({ fromId: value }, "from");
													}}
												>
													<SelectTrigger
														id={`${edit.formId}-from`}
														aria-label="From"
														className="min-w-0 flex-1"
													>
														<SelectValue placeholder="External income">
															{(value: string | null) =>
																fromAccountLabel(value)
															}
														</SelectValue>
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="">External income</SelectItem>
														{fromAccountOptions(fullAccounts).map((account) => (
															<SelectItem key={account.id} value={account.id}>
																{account.name}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
										</Field>
										<div
											className="flex items-center gap-3 text-muted-foreground"
											aria-hidden="true"
										>
											<ArrowDown size={16} />
										</div>
										<Field>
											<FieldLabel htmlFor={`${edit.formId}-to`}>
												To account
											</FieldLabel>
											<div className="flex items-center gap-3">
												{toAccount ? (
													<AccountIcon account={toAccount} />
												) : (
													<AccountIconFallback />
												)}
												<Select
													value={edit.draft.toId}
													disabled={!canEdit}
													onValueChange={(value) => {
														if (value !== null)
															edit.updateDraft({ toId: value }, "to");
													}}
												>
													<SelectTrigger
														id={`${edit.formId}-to`}
														aria-label="To"
														className="min-w-0 flex-1"
													>
														<SelectValue placeholder="External spending">
															{(value: string | null) => toAccountLabel(value)}
														</SelectValue>
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="">External spending</SelectItem>
														{visibleAccounts(fullAccounts).map((account) => (
															<SelectItem key={account.id} value={account.id}>
																{account.name}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>
										</Field>
									</CardContent>
								</Card>
							</section>
						)}
						{once && (
							<TransferLinkSection
								transactionId={savedTransaction.id}
								readOnly={readOnly}
							/>
						)}
						<div
							ref={scheduleSectionRef}
							id={`${edit.formId}-schedule-section`}
							className="scroll-mt-4"
						>
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
								locked={!canEdit}
								scheduleControlId={`${edit.formId}-schedule`}
								controlRef={scheduleControlRef}
								onRemoveOccurrence={
									claimRemovable ? () => void removeClaim() : undefined
								}
								removingOccurrence={removingClaim}
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
								readOnly={Boolean(readOnly)}
							/>
						)}
						{saveError && <FieldError>{saveError}</FieldError>}
						{edit.saving && (
							<p className="mt-2 text-xs text-muted-foreground" role="status">
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
				</div>
				<SheetFooter className="flex-row flex-wrap items-center justify-between gap-3 border-t border-border">
					<div className="flex flex-wrap items-center gap-4">
						{once && (
							<Button
								type="button"
								variant="link"
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
							</Button>
						)}
						{savedTransaction.kind === "schedule" && (
							<Button
								type="button"
								variant="link"
								onClick={scrollToSchedule}
								aria-label={
									scheduleCadence
										? `Recurring schedule: ${scheduleCadence}. Go to schedule`
										: "Recurring schedule. Go to schedule"
								}
							>
								<Repeat size={14} aria-hidden="true" />
								<span>{scheduleCadence ?? "Recurring schedule"}</span>
							</Button>
						)}
						{once && (
							<TransactionInsightsTrigger
								count={insightSuggestions.length}
								onClick={() => setInsightsOpen(true)}
							/>
						)}
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							variant="secondary"
							onClick={() => {
								if (edit.requestClose()) onClose();
							}}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							form={edit.formId}
							disabled={edit.saveBlocked || !edit.dirty}
						>
							{edit.saving ? "Saving…" : "Save changes"}
						</Button>
					</div>
				</SheetFooter>
			</SheetContent>
			{edit.confirmCancel && (
				<AlertDialog
					open
					onOpenChange={(open) => {
						if (!open) edit.setConfirmCancel(false);
					}}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
							<AlertDialogDescription>
								Closing now loses the edits in this form. Continue editing to
								keep them, or discard them.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel onClick={() => edit.setConfirmCancel(false)}>
								Continue editing
							</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								onClick={() => edit.discardAndClose()}
							>
								Discard changes
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			)}
			{once && insightsOpen && (
				<Sheet
					open
					onOpenChange={(open) => {
						if (!open) setInsightsOpen(false);
					}}
				>
					<SheetContent side="right" className="data-[side=right]:sm:max-w-md">
						<SheetHeader>
							<SheetTitle>Suggestions</SheetTitle>
							<SheetDescription className="sr-only">
								Small checks to improve future estimates
							</SheetDescription>
						</SheetHeader>
						<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
							<p className="mt-0 mb-6 text-xs text-muted-foreground">
								Small checks to improve future estimates
							</p>
							<TransactionInsightsPanel
								suggestions={insightSuggestions}
								names={insightNames}
								readOnly={insightReadOnly}
								onDone={() => setInsightsOpen(false)}
								onMergeVoid={savedTransaction.void ? mergeVoidHold : undefined}
							/>
						</div>
					</SheetContent>
				</Sheet>
			)}
			{once && sharingOpen && (
				<Sheet
					open
					onOpenChange={(open) => {
						if (!open) setSharingOpen(false);
					}}
				>
					<SheetContent side="right" className="data-[side=right]:sm:max-w-md">
						<SheetHeader>
							<SheetTitle>Sharing</SheetTitle>
							<SheetDescription className="sr-only">
								Sharing settings for this transaction
							</SheetDescription>
						</SheetHeader>
						<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
							<TransactionSharing
								transactionId={savedTransaction.id}
								readOnly={Boolean(readOnly ?? savedTransaction.readOnly)}
							/>
						</div>
					</SheetContent>
				</Sheet>
			)}
			{historySelection && (
				<TransactionDetail
					key={historySelection.id}
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
				<AlertDialog
					open
					onOpenChange={(open) => {
						if (!open && !deleting) {
							setConfirmingDelete(false);
							setDeleteError(null);
						}
					}}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<p className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">
								Changes
							</p>
							<AlertDialogTitle>
								{`Delete ${savedTransaction.name}?`}
							</AlertDialogTitle>
							<AlertDialogDescription>
								{savedTransaction.kind === "schedule"
									? "This deletes the schedule immediately. Its recorded transactions stay."
									: "This deletes the transaction immediately. It is removed from the saved model."}
							</AlertDialogDescription>
						</AlertDialogHeader>
						{deleteError && <FieldError>{deleteError}</FieldError>}
						<AlertDialogFooter>
							<AlertDialogCancel disabled={deleting}>
								{savedTransaction.kind === "schedule"
									? "Keep schedule"
									: "Keep transaction"}
							</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								disabled={deleting}
								onClick={() => void removeTransaction()}
							>
								{deleting
									? "Deleting…"
									: savedTransaction.kind === "schedule"
										? "Delete schedule"
										: "Delete transaction"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			)}
			{confirmingEndSchedule && (
				<AlertDialog
					open
					onOpenChange={(open) => {
						if (!open && !endingSchedule) {
							setConfirmingEndSchedule(false);
							setEndScheduleError(null);
						}
					}}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<p className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">
								Changes
							</p>
							<AlertDialogTitle>
								{`End ${savedTransaction.name} with a transaction?`}
							</AlertDialogTitle>
							<AlertDialogDescription>
								This records one transaction with the schedule amount and
								accounts. The schedule ends and no further occurrences are
								planned.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<Field>
							<FieldLabel htmlFor="end-schedule-date">
								Transaction date
							</FieldLabel>
							<Input
								id="end-schedule-date"
								type="date"
								name="endScheduleDate"
								required
								disabled={endingSchedule}
								value={endScheduleDate}
								onChange={(event) => setEndScheduleDate(event.target.value)}
							/>
						</Field>
						{endScheduleError && <FieldError>{endScheduleError}</FieldError>}
						<AlertDialogFooter>
							<AlertDialogCancel disabled={endingSchedule}>
								Keep schedule
							</AlertDialogCancel>
							<AlertDialogAction
								disabled={endingSchedule}
								onClick={() => void endSchedule()}
							>
								{endingSchedule ? "Recording…" : "Record transaction"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			)}
		</Sheet>
	);
}
