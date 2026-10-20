import {
	ArrowDown,
	ArrowDownLeft,
	ArrowRightLeft,
	ArrowUpRight,
	Banknote,
	CalendarCheck2,
	CalendarDays,
	Check,
	ChevronDown,
	Clock3,
	Link2,
	LockKeyhole,
	Repeat,
	RotateCcw,
	Save,
	TriangleAlert,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
	useId,
	useState,
	type ComponentType,
	type FormEvent,
	type ReactNode,
} from "react";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import { dateLabel, money } from "../../domain/format.ts";
import { parseUnion } from "../../domain/guards.ts";
import { markAsSubscription } from "../../domain/subscriptions.ts";
import {
	validatePlan,
	visibleAccounts,
	type Account,
	type Movement,
	type Plan,
} from "../../domain/model.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import { useWorkspaceStore } from "../../state/workspaceStore.ts";
import { AccountIcon } from "../AccountIcon.tsx";
import { Badge, ErrorNotice, IconButton, Modal } from "../ui.tsx";
import { sourceReadOnlyReason } from "../editors/EditorForm.tsx";
import { AccountOptions } from "../editors/AccountOptions.tsx";
import { buildMovementPlan } from "../editors/MovementEditor.tsx";

type AccountRef = Pick<Account, "id" | "kind" | "color" | "name">;

/**
 * The detail opens above drawers that portal to document.body. Rendering the
 * native dialog as a sibling (rather than nested inside the drawer panel)
 * keeps drawer-level Escape/backdrop handling from also firing: the drawer's
 * keydown guard only acts on focus inside its own panel.
 */
function DetailPortal({ children }: { children: ReactNode }) {
	return createPortal(children, document.body);
}

function frequencyLabel(frequency: Movement["frequency"]): string {
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

function directionKindFor(movement: Movement): "in" | "out" | "transfer" {
	if (movement.fromId && movement.toId) return "transfer";
	if (movement.toId && !movement.fromId) return "in";
	return "out";
}

function accountFor(
	accounts: AccountRef[],
	id: string | null,
): AccountRef | null {
	if (!id) return null;
	return accounts.find((account) => account.id === id) ?? null;
}

/** Aligned metadata row: quiet icon label on the left, value on the right.
 * A wrapping label associates the text with the control inside, so no
 * aria-labels are needed on row controls. */
function MetaRow({
	icon: Icon,
	label,
	children,
}: {
	icon: ComponentType<{ size?: number; className?: string }>;
	label: string;
	children: ReactNode;
}) {
	return (
		<label className="transaction-meta-row">
			<span className="transaction-meta-label">
				<Icon size={15} aria-hidden="true" />
				{label}
			</span>
			{children}
		</label>
	);
}

function categoryLabel(kind: "in" | "out" | "transfer"): string {
	return kind === "transfer"
		? "Transfer"
		: kind === "in"
			? "Income"
			: "Expense";
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
	movement,
	plan,
	draft,
	updateDraft,
	locked,
}: {
	movement: Movement;
	plan: Plan;
	draft: MovementDraft;
	updateDraft: (patch: Partial<MovementDraft>, field: EditField) => void;
	locked: boolean;
}) {
	const frequency = draft.frequency;
	const onFrequency = (next: Movement["frequency"]) =>
		updateDraft({ frequency: next }, "schedule");
	const claimRules = plan.movements.filter(
		(item) => item.frequency !== "once" && item.id !== movement.id,
	);
	return (
		<details className="transaction-more">
			<summary>
				<ChevronDown
					size={13}
					aria-hidden="true"
					className="transaction-more-chevron"
				/>
				More options
			</summary>
			<div className="transaction-more-body">
				<label className="field">
					<span>Frequency</span>
					<select
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
					</select>
				</label>
				<label className="field">
					<span>Annual amount increase (%)</span>
					<input
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
				</label>
				{frequency === "once" && (
					<>
						<label className="field">
							<span>Records an occurrence of</span>
							<select
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
							</select>
						</label>
						<label className="field">
							<span>Replaces occurrence on</span>
							<input
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
						</label>
					</>
				)}
				<label className="transaction-more-check">
					<input
						type="checkbox"
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
 * Schedule stated only for recurring rules: one-time movements need no
 * label. Defaults stay silent: yearly change of zero, an open end date, and
 * "included" never render. In edit mode the same sentence carries date
 * controls in the same positions; structural settings live under More
 * options so the collapsed edit view matches the read view line for line.
 */
/**
 * Schedule stated only for recurring rules: one-time movements need no
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
	draft: MovementDraft;
	updateDraft: (patch: Partial<MovementDraft>, field: EditField) => void;
	claimRuleName?: string | null;
	editing: boolean;
	locked: boolean;
	/** DOM id for the first schedule control. */
	scheduleControlId?: string;
}) {
	const frequency = draft.frequency;
	if (frequency === "once") {
		if (!draft.claimRuleId) return null;
		return (
			<p className="transaction-schedule">
				<Link2 size={15} aria-hidden="true" />
				<span>
					Replaces{" "}
					<select
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
		<div className="transaction-inset">
			<div className="transaction-inset-head">
				<Repeat size={16} aria-hidden="true" />
				<div>
					<strong>Recurring transaction</strong>
					<span>
						{frequencyLabel(frequency)}
						{growth}
					</span>
				</div>
			</div>
			<div className="transaction-schedule-dates">
				<input
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
					<label className="transaction-inline-check">
						<input
							type="checkbox"
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

function ReadOnlyNotice({ movement }: { movement: Movement }) {
	if (movement.amountKnown === false) {
		return (
			<div className="inline-notice">
				<LockKeyhole size={18} />
				This amount is calculated each time. See the transaction list for the
				resolved amounts.
			</div>
		);
	}
	if (movement.readOnly) {
		return (
			<div className="inline-notice">
				<LockKeyhole size={18} />
				{sourceReadOnlyReason}
			</div>
		);
	}
	return null;
}

function readOnlyReasonFor(movement: Movement): string | undefined {
	return movement.amountKnown === false
		? "This amount is calculated each time. See the transaction list for the resolved amounts."
		: movement.readOnly
			? sourceReadOnlyReason
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

type MovementDraft = {
	name: string;
	amount: string;
	fromId: string;
	toId: string;
	frequency: Movement["frequency"];
	startDate: string;
	endDate: string;
	noEndDate: boolean;
	annualIncrease: string;
	enabled: boolean;
	claimRuleId: string;
	claimOccurrenceDate: string;
	postedDate: string;
};

function draftFromMovement(movement: Movement): MovementDraft {
	return {
		name: movement.name,
		amount: String(movement.amount),
		fromId: movement.fromId ?? "",
		toId: movement.toId ?? "",
		frequency: movement.frequency,
		startDate: movement.startDate,
		endDate: movement.endDate ?? "",
		noEndDate: movement.endDate == null,
		annualIncrease: String(movement.annualIncrease),
		enabled: movement.enabled,
		claimRuleId: movement.claimRuleId ?? "",
		claimOccurrenceDate: movement.claimOccurrenceDate ?? "",
		postedDate: movement.postedDate ?? "",
	};
}
function useMovementEdit({
	movement,
	plan,
	onClose,
}: {
	movement: Movement;
	plan: Plan;
	onClose: () => void;
}) {
	const updatePlan = useWorkspaceStore((state) => state.updatePlan);
	// Only the clicked value is editable; null renders the pure read view.
	const [activeField, setActiveField] = useState<EditField | null>(null);
	const [touched, setTouched] = useState(false);
	const [confirmCancel, setConfirmCancel] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [draft, setDraft] = useState<MovementDraft>(() =>
		draftFromMovement(movement),
	);
	// The movement this draft was taken from. Switching to another
	// transaction refreshes the draft on first edit instead of going stale.
	const [draftForId, setDraftForId] = useState(movement.id);
	const formId = useId();
	const readOnlyReason = readOnlyReasonFor(movement);
	useBeforeUnload(activeField !== null && touched);
	const updateDraft = (patch: Partial<MovementDraft>, field: EditField) => {
		if (readOnlyReason) return;
		if (draftForId !== movement.id) {
			const fresh = draftFromMovement(movement);
			setDraft({ ...fresh, ...patch });
			setDraftForId(movement.id);
		} else {
			setDraft((previous) => ({ ...previous, ...patch }));
		}
		if (activeField !== field) setActiveField(field);
		setTouched(true);
		setError(null);
		setConfirmCancel(false);
	};
	// Discard restores the read view with the movement's own values.
	const exitEdit = () => {
		const field = activeField;
		setDraft(draftFromMovement(movement));
		setDraftForId(movement.id);
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
	// The visible form holds only the active control, so the draft (kept in
	// the exact shape a full form would submit) is synthesized into FormData
	// for the shared movement builder.
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (readOnlyReason) return;
		const data = new FormData();
		data.append("name", draft.name);
		data.append("amount", draft.amount);
		data.append("fromId", draft.fromId);
		data.append("toId", draft.toId);
		data.append("frequency", draft.frequency);
		data.append("startDate", draft.startDate);
		if (draft.noEndDate) data.append("noEndDate", "on");
		else data.append("endDate", draft.endDate);
		data.append("annualIncrease", draft.annualIncrease);
		if (draft.enabled) data.append("enabled", "on");
		data.append("claimRuleId", draft.claimRuleId);
		data.append("claimOccurrenceDate", draft.claimOccurrenceDate);
		data.append("postedDate", draft.postedDate);
		const validated = validatePlan(
			buildMovementPlan({
				plan,
				item: movement,
				data,
			}),
		);
		if (validated instanceof Error) {
			setError(validated.message);
			return;
		}
		// Like the overlay editor, a successful apply returns to the
		// underlying view so Save/Discard stay one click away.
		if (updatePlan(validated)) onClose();
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
					label="Apply unsaved changes"
					type="submit"
					form={formId}
					disabled={Boolean(readOnlyReason)}
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
	};
}

function MarkAsSubscriptionAction({
	movement,
	plan,
	locked,
	onDone,
}: {
	movement: Movement;
	plan: Plan;
	locked: boolean;
	onDone: () => void;
}) {
	const updatePlan = useWorkspaceStore((state) => state.updatePlan);
	const [error, setError] = useState<string | null>(null);
	if (movement.frequency !== "once" || movement.claimRuleId || locked)
		return null;
	const mark = () => {
		const next = markAsSubscription(plan, movement.id);
		if (next instanceof Error) {
			setError(next.message);
			return;
		}
		if (updatePlan(next)) onDone();
		else setError("That change could not be applied to the plan.");
	};
	return (
		<div className="inline-notice">
			<Repeat size={18} aria-hidden="true" />
			<span>
				Pay this every month? Marking it as a subscription creates a monthly
				rule and links this transaction to its first occurrence.
			</span>
			<button type="button" className="button small" onClick={mark}>
				Mark as subscription
			</button>
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
		<div className="confirm-inline" role="alert">
			<p>Discard the changes in this form?</p>
			<button type="button" className="button secondary" onClick={onContinue}>
				Continue
			</button>
			<button type="button" className="button danger" onClick={onDiscard}>
				Discard changes
			</button>
		</div>
	);
}

function fromAccountOptions(plan: Plan): Account[] {
	return visibleAccounts(plan.accounts).filter(
		(account) => account.kind !== "debt",
	);
}

/**
 * Read-friendly view of one projected or recorded occurrence. Clicking a
 * value turns the same blocks into controls in place: the dialog, the
 * header, and the layout never move. Save/Discard appear once editing.
 */
export function TransactionDetail({
	transaction,
	movement,
	accounts,
	plan,
	claimRuleName,
	shortfallLabel,
	onClose,
}: {
	transaction: AccountTransaction;
	movement: Movement;
	accounts: AccountRef[];
	plan: Plan;
	claimRuleName?: string | null;
	shortfallLabel?: string;
	onClose: () => void;
}) {
	const kind =
		transaction.category === "transfer"
			? ("transfer" as const)
			: transaction.direction;
	const edit = useMovementEdit({ movement, plan, onClose });
	const once = movement.frequency === "once";
	const canEdit = !edit.readOnlyReason;
	const showShortfall = transaction.shortfall > 0.01;
	const showExcluded = transaction.excluded && !transaction.pending;
	const postedDiffers =
		movement.postedDate !== null &&
		movement.postedDate !== edit.draft.startDate;
	const fromAccount = accountFor(accounts, edit.draft.fromId || null);
	const toAccount = accountFor(accounts, edit.draft.toId || null);
	const hasStatusPill =
		transaction.pending ||
		transaction.source === "historical" ||
		showExcluded ||
		showShortfall ||
		(!movement.enabled && !transaction.pending && !showExcluded);
	const editHeading = (
		<>
			<span className="sr-only">{edit.draft.name}</span>
			<span className="transaction-detail-heading">
				<span
					className={`movement-icon square ${kind === "transfer" ? "transfer" : kind === "in" ? "inflow" : "outflow"}`}
				>
					<DirectionIcon kind={kind} size={22} />
				</span>
				<span className="transaction-detail-eyebrow">Transaction details</span>
			</span>
		</>
	);
	return (
		<DetailPortal>
			<Modal
				title={editHeading}
				titleSize="plain"
				className="transaction-detail-modal"
				actions={edit.actions}
				onClose={edit.close}
				focusPanelOnOpen
			>
				<form id={edit.formId} onSubmit={edit.submit}>
					<div className="transaction-name-row">
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
							className="transaction-name-input"
						/>
						{movement.frequency !== "once" && (
							<span
								title="Recurring transaction"
								aria-label="Recurring transaction"
								role="img"
								className="transaction-repeat-badge"
							>
								<Repeat size={16} aria-hidden="true" />
							</span>
						)}
					</div>
					<div className="transaction-detail-hero">
						<div>
							<span
								className={`transaction-amount-edit${transaction.direction === "in" ? " positive" : ""}`}
							>
								<span aria-hidden="true">
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
									value={edit.draft.amount}
									onChange={(event) =>
										edit.updateDraft({ amount: event.target.value }, "amount")
									}
									readOnly={!canEdit}
									className={`transaction-amount-input${transaction.direction === "in" ? " positive" : ""}`}
								/>
							</span>
						</div>
					</div>
					<div className="transaction-status">
						{transaction.pending ? (
							<Badge tone="amber">
								<Clock3 size={10} aria-hidden="true" />
								Pending
							</Badge>
						) : transaction.source === "historical" ? (
							<Badge tone="green">
								<Check size={10} aria-hidden="true" />
								Posted
							</Badge>
						) : null}
						{showExcluded && <Badge tone="amber">Excluded from plan</Badge>}
						{showShortfall && (
							<Badge tone="amber">
								<TriangleAlert size={10} aria-hidden="true" />
								{shortfallLabel ?? "Shortfall"}
							</Badge>
						)}
						{!movement.enabled && !transaction.pending && !showExcluded && (
							<Badge tone="amber">Excluded</Badge>
						)}
						{hasStatusPill && <span aria-hidden="true">·</span>}
						<span className="transaction-category">{categoryLabel(kind)}</span>
					</div>
					{(once || transaction.pending || postedDiffers) && (
						<div className="transaction-meta">
							{once && (
								<MetaRow icon={CalendarDays} label="Transaction date">
									<input
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
								</MetaRow>
							)}
							{(transaction.pending || postedDiffers) && (
								<MetaRow icon={CalendarCheck2} label="Date posted">
									{transaction.pending ? (
										<span className="transaction-muted">Not yet posted</span>
									) : (
										<input
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
								</MetaRow>
							)}
						</div>
					)}
					{kind === "transfer" && (
						<div className="transaction-transfer">
							<h3>Transfer details</h3>
							<div className="transaction-transfer-box">
								<div className="transaction-transfer-row">
									{fromAccount ? (
										<AccountIcon account={fromAccount} />
									) : (
										<span className="transaction-transfer-icon">
											<Banknote size={15} aria-hidden="true" />
										</span>
									)}
									<div>
										<span aria-hidden="true">FROM ACCOUNT</span>
										<select
											id={`${edit.formId}-from`}
											aria-label="From"
											name="fromId"
											value={edit.draft.fromId}
											onChange={(event) =>
												edit.updateDraft({ fromId: event.target.value }, "from")
											}
											disabled={!canEdit}
											className={
												edit.activeField === "from" ? "editing" : undefined
											}
										>
											<option value="">External income</option>
											<AccountOptions accounts={fromAccountOptions(plan)} />
										</select>
									</div>
								</div>
								<div className="transaction-transfer-mid" aria-hidden="true">
									<ArrowDown size={16} />
									<span />
								</div>
								<div className="transaction-transfer-row">
									{toAccount ? (
										<AccountIcon account={toAccount} />
									) : (
										<span className="transaction-transfer-icon">
											<Banknote size={15} aria-hidden="true" />
										</span>
									)}
									<div>
										<span aria-hidden="true">TO ACCOUNT</span>
										<select
											id={`${edit.formId}-to`}
											aria-label="To"
											name="toId"
											value={edit.draft.toId}
											onChange={(event) =>
												edit.updateDraft({ toId: event.target.value }, "to")
											}
											disabled={!canEdit}
											className={
												edit.activeField === "to" ? "editing" : undefined
											}
										>
											<option value="">External spending</option>
											<AccountOptions
												accounts={visibleAccounts(plan.accounts)}
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
						movement={movement}
						plan={plan}
						locked={!canEdit}
						onDone={onClose}
					/>
					<MoreOptions
						movement={movement}
						plan={plan}
						draft={edit.draft}
						updateDraft={edit.updateDraft}
						locked={!canEdit}
					/>
					{edit.error && <ErrorNotice message={edit.error} />}
					{edit.confirmCancel && (
						<DiscardConfirm
							onContinue={() => edit.setConfirmCancel(false)}
							onDiscard={edit.discardAndClose}
						/>
					)}
					<ReadOnlyNotice movement={movement} />
				</form>
			</Modal>
		</DetailPortal>
	);
}

/**
 * Read-friendly view of a plan rule (no single occurrence date). Used by the
 * plan list and the recurring tab where the row represents the rule itself.
 * Every value is always its own control: read mode is an attribute flip
 * (readOnly/disabled plus armed styling), so clicking a value edits it in
 * place with no component swap.
 */
export function MovementDetail({
	movement,
	accounts,
	plan,
	resolvedAmount,
	resolvedDate,
	claimRuleName,
	onClose,
}: {
	movement: Movement;
	accounts: AccountRef[];
	plan: Plan;
	resolvedAmount?: number;
	resolvedDate?: string;
	claimRuleName?: string | null;
	onClose: () => void;
}) {
	const kind = directionKindFor(movement);
	const edit = useMovementEdit({ movement, plan, onClose });
	const once = movement.frequency === "once";
	const canEdit = !edit.readOnlyReason;
	const postedDiffers =
		movement.postedDate !== null &&
		movement.postedDate !== edit.draft.startDate;
	const fromAccount = accountFor(accounts, edit.draft.fromId || null);
	const toAccount = accountFor(accounts, edit.draft.toId || null);
	const editHeading = (
		<>
			<span className="sr-only">{edit.draft.name}</span>
			<span className="transaction-detail-heading">
				<span
					className={`movement-icon square ${kind === "transfer" ? "transfer" : kind === "in" ? "inflow" : "outflow"}`}
				>
					<DirectionIcon kind={kind} size={22} />
				</span>
				<span className="transaction-detail-eyebrow">Transaction details</span>
			</span>
		</>
	);
	return (
		<DetailPortal>
			<Modal
				title={editHeading}
				titleSize="plain"
				className="transaction-detail-modal"
				actions={edit.actions}
				onClose={edit.close}
				focusPanelOnOpen
			>
				<form id={edit.formId} onSubmit={edit.submit}>
					<div className="transaction-name-row">
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
							className="transaction-name-input"
						/>
						{movement.frequency !== "once" && (
							<span
								title="Recurring transaction"
								aria-label="Recurring transaction"
								role="img"
								className="transaction-repeat-badge"
							>
								<Repeat size={16} aria-hidden="true" />
							</span>
						)}
					</div>
					<div className="transaction-detail-hero">
						<div>
							<span className="transaction-amount-edit">
								<span aria-hidden="true">$</span>
								<input
									id={`${edit.formId}-amount`}
									aria-label="Amount (USD)"
									name="amount"
									type="number"
									required
									min="0.01"
									max="10000000000"
									step="0.01"
									value={edit.draft.amount}
									onChange={(event) =>
										edit.updateDraft({ amount: event.target.value }, "amount")
									}
									readOnly={!canEdit}
									className="transaction-amount-input"
								/>
							</span>
							<span>
								{movement.amountKnown
									? "Per occurrence"
									: resolvedAmount !== undefined && resolvedDate
										? `Calculated · ${money(resolvedAmount)} on ${dateLabel(resolvedDate, true)}`
										: "Calculated each occurrence"}
							</span>
						</div>
						{(once || postedDiffers) && (
							<div className="transaction-meta">
								{once && (
									<MetaRow icon={CalendarDays} label="Transaction date">
										<input
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
									</MetaRow>
								)}
								{postedDiffers && (
									<MetaRow icon={CalendarCheck2} label="Date posted">
										<input
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
									</MetaRow>
								)}
							</div>
						)}
					</div>
					<div className="transaction-status">
						{movement.readOnly && <Badge tone="neutral">Synced</Badge>}
						{movement.amountKnown === false && (
							<Badge tone="neutral">Varies</Badge>
						)}
						{!movement.enabled && <Badge tone="amber">Excluded</Badge>}
						{(movement.readOnly ||
							movement.amountKnown === false ||
							!movement.enabled) && <span aria-hidden="true">·</span>}
						<span className="transaction-category">{categoryLabel(kind)}</span>
					</div>
					{kind === "transfer" && (
						<div className="transaction-transfer">
							<h3>Transfer details</h3>
							<div className="transaction-transfer-box">
								<div className="transaction-transfer-row">
									{fromAccount ? (
										<AccountIcon account={fromAccount} />
									) : (
										<span className="transaction-transfer-icon">
											<Banknote size={15} aria-hidden="true" />
										</span>
									)}
									<div>
										<span aria-hidden="true">FROM ACCOUNT</span>
										<select
											id={`${edit.formId}-from`}
											aria-label="From"
											name="fromId"
											value={edit.draft.fromId}
											onChange={(event) =>
												edit.updateDraft({ fromId: event.target.value }, "from")
											}
											disabled={!canEdit}
											className={
												edit.activeField === "from" ? "editing" : undefined
											}
										>
											<option value="">External income</option>
											<AccountOptions accounts={fromAccountOptions(plan)} />
										</select>
									</div>
								</div>
								<div className="transaction-transfer-mid" aria-hidden="true">
									<ArrowDown size={16} />
									<span />
								</div>
								<div className="transaction-transfer-row">
									{toAccount ? (
										<AccountIcon account={toAccount} />
									) : (
										<span className="transaction-transfer-icon">
											<Banknote size={15} aria-hidden="true" />
										</span>
									)}
									<div>
										<span aria-hidden="true">TO ACCOUNT</span>
										<select
											id={`${edit.formId}-to`}
											aria-label="To"
											name="toId"
											value={edit.draft.toId}
											onChange={(event) =>
												edit.updateDraft({ toId: event.target.value }, "to")
											}
											disabled={!canEdit}
											className={
												edit.activeField === "to" ? "editing" : undefined
											}
										>
											<option value="">External spending</option>
											<AccountOptions
												accounts={visibleAccounts(plan.accounts)}
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
						movement={movement}
						plan={plan}
						locked={!canEdit}
						onDone={onClose}
					/>
					<MoreOptions
						movement={movement}
						plan={plan}
						draft={edit.draft}
						updateDraft={edit.updateDraft}
						locked={!canEdit}
					/>
					{edit.error && <ErrorNotice message={edit.error} />}
					{edit.confirmCancel && (
						<DiscardConfirm
							onContinue={() => edit.setConfirmCancel(false)}
							onDiscard={edit.discardAndClose}
						/>
					)}
					<ReadOnlyNotice movement={movement} />
				</form>
			</Modal>
		</DetailPortal>
	);
}
