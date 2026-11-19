import { Link2, Repeat } from "lucide-react";
import { useId, type RefObject } from "react";
import { dateLabel } from "../../domain/format.ts";
import {
	ensureStartWeekday,
	type Recurrence,
} from "../../domain/recurrence.ts";
import type { Transaction } from "../../domain/model.ts";
import { timeOfDay } from "../editors/transactionBodies.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
	Card,
	CardAction,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Field, FieldLabel } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select.tsx";
import { RecurrenceFields } from "../editors/RecurrenceFields.tsx";
import { TransactionCategory } from "./TransactionCategory.tsx";

export type EditField =
	| "name"
	| "amount"
	| "from"
	| "to"
	| "schedule"
	| "posted";

export type TransactionDraft = {
	name: string;
	amount: string;
	fromId: string;
	toId: string;
	/** Schedule recurrence. Null on a one-time transaction. */
	recurrence: Recurrence | null;
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

export function draftFromTransaction(
	savedTransaction: Transaction,
	scheduleRecurrence: Recurrence | null,
): TransactionDraft {
	return {
		name: savedTransaction.name,
		amount: String(savedTransaction.amount),
		fromId: savedTransaction.fromId ?? "",
		toId: savedTransaction.toId ?? "",
		recurrence:
			savedTransaction.kind === "schedule" ? scheduleRecurrence : null,
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
export function canClaimOccurrence(transaction: Transaction): boolean {
	return (
		transaction.kind === "transaction" &&
		transaction.pending === true &&
		transaction.syncOwned === true
	);
}

export function ClaimFields({
	draft,
	updateDraft,
	claimEditable,
	occurrenceOptions,
	claimSchedules,
	idPrefix,
	staleClaimName,
}: {
	draft: TransactionDraft;
	updateDraft: (patch: Partial<TransactionDraft>, field: EditField) => void;
	claimEditable: boolean;
	/** Scheduled dates of the selected rule, closest to the posted day first. */
	occurrenceOptions: string[];
	claimSchedules: Transaction[];
	idPrefix: string;
	staleClaimName?: string | null;
}) {
	const scheduleLabel = (value: string | null): string => {
		if (!value) return "No link — standalone record";
		return (
			claimSchedules.find((rule) => rule.id === value)?.name ??
			staleClaimName ??
			"Unknown schedule"
		);
	};
	const occurrencePlaceholder = !draft.claimScheduleId
		? "Choose a schedule first"
		: occurrenceOptions.length === 0
			? "No claimable occurrences"
			: "Choose the occurrence";
	const occurrenceLabel = (value: string | null): string => {
		if (!value) return occurrencePlaceholder;
		return dateLabel(value, true);
	};
	return (
		<div className="flex min-w-0 flex-1 flex-col gap-3">
			<Field>
				<FieldLabel htmlFor={`${idPrefix}-schedule`}>
					Records an occurrence of
				</FieldLabel>
				<Select
					disabled={!claimEditable}
					value={draft.claimScheduleId ?? ""}
					onValueChange={(value) =>
						updateDraft({ claimScheduleId: value ?? "" }, "schedule")
					}
				>
					<SelectTrigger id={`${idPrefix}-schedule`} className="w-full">
						<SelectValue placeholder="No link — standalone record">
							{(value: string | null) => scheduleLabel(value)}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="">No link — standalone record</SelectItem>
						{claimSchedules.map((rule) => (
							<SelectItem key={rule.id} value={rule.id}>
								{rule.name}
							</SelectItem>
						))}
						{draft.claimScheduleId &&
							!claimSchedules.some(
								(rule) => rule.id === draft.claimScheduleId,
							) &&
							staleClaimName && (
								<SelectItem value={draft.claimScheduleId ?? ""}>
									{staleClaimName}
								</SelectItem>
							)}
					</SelectContent>
				</Select>
			</Field>
			<Field>
				<FieldLabel htmlFor={`${idPrefix}-occurrence`}>
					Replaces occurrence on
				</FieldLabel>
				<Select
					disabled={!claimEditable || !draft.claimScheduleId}
					value={draft.claimOccurrenceDate ?? ""}
					onValueChange={(value) =>
						updateDraft({ claimOccurrenceDate: value ?? "" }, "schedule")
					}
				>
					<SelectTrigger id={`${idPrefix}-occurrence`} className="w-full">
						<SelectValue
							placeholder={
								!draft.claimScheduleId
									? "Choose a schedule first"
									: occurrenceOptions.length === 0
										? "No claimable occurrences"
										: "Choose the occurrence"
							}
						>
							{(value: string | null) => occurrenceLabel(value)}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="">
							{!draft.claimScheduleId
								? "Choose a schedule first"
								: occurrenceOptions.length === 0
									? "No claimable occurrences"
									: "Choose the occurrence"}
						</SelectItem>
						{occurrenceOptions.map((date) => (
							<SelectItem key={date} value={date}>
								{dateLabel(date, true)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</Field>
		</div>
	);
}

export function MoreOptions({
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
	const schedule = savedTransaction.kind === "schedule";
	return (
		<section
			aria-label="Transaction options"
			className="mt-4 border-t border-border"
		>
			<div className="flex flex-col gap-4 pt-4">
				{!schedule && (
					<TransactionCategory
						transactionId={savedTransaction.id}
						category={savedTransaction.category}
						source={savedTransaction.categorySource}
						readOnly={categoryReadOnly}
					/>
				)}
				{schedule && (
					<>
						<RecurrenceFields
							recurrence={
								draft.recurrence ?? {
									unit: "month",
									interval: 1,
									monthlyMode: "byDate",
								}
							}
							startDate={draft.startDate}
							onChange={(recurrence) => updateDraft({ recurrence }, "schedule")}
							disabled={locked}
							compact
							idPrefix={`${id}-recurrence`}
						/>
						<Field>
							<FieldLabel htmlFor={`${id}-annual`}>
								Annual amount increase (%)
							</FieldLabel>
							<Input
								id={`${id}-annual`}
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
							/>
						</Field>
					</>
				)}
				{!schedule && (
					<ClaimFields
						draft={draft}
						updateDraft={updateDraft}
						claimEditable={claimEditable}
						occurrenceOptions={occurrenceOptions}
						claimSchedules={claimSchedules}
						idPrefix={id}
					/>
				)}
			</div>
		</section>
	);
}

/**
 * Schedule dates for recurring rules: one-time transactions need no card.
 * The card holds the date controls only; the cadence lives in the options
 * below and is never restated here.
 */
export function ScheduleCapsule({
	savedTransaction,
	draft,
	updateDraft,
	claimScheduleName,
	locked,
	scheduleControlId,
	controlRef,
	onRemoveOccurrence,
	removingOccurrence,
}: {
	savedTransaction: Transaction;
	draft: TransactionDraft;
	updateDraft: (patch: Partial<TransactionDraft>, field: EditField) => void;
	claimScheduleName?: string | null;
	locked: boolean;
	/** DOM id for the first schedule control. */
	scheduleControlId?: string;
	/** Ref for the first schedule control, used by the footer shortcut. */
	controlRef?: RefObject<HTMLInputElement | null>;
	/** Scheduled dates of the selected rule, closest to the posted day first. */
	occurrenceOptions: string[];
	/** Direct release of the saved occurrence without opening claim controls. */
	onRemoveOccurrence?: () => void;
	removingOccurrence?: boolean;
}) {
	const id = useId();
	const claimEditable = !locked || canClaimOccurrence(savedTransaction);
	if (savedTransaction.kind === "transaction") {
		if (!draft.claimScheduleId) return null;
		return (
			<div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-[1.6] text-muted-foreground">
				<p className="flex items-center gap-2">
					<Link2 size={15} aria-hidden="true" />
					<span>
						Happened {dateLabel(draft.startDate, true)} · Replaces{" "}
						{claimScheduleName ?? draft.claimScheduleId} occurrence on{" "}
						{draft.claimOccurrenceDate
							? dateLabel(draft.claimOccurrenceDate, true)
							: "an unclaimed date"}
					</span>
				</p>
				{onRemoveOccurrence && claimEditable && (
					<Button
						type="button"
						variant="link"
						className="text-destructive"
						disabled={removingOccurrence}
						onClick={onRemoveOccurrence}
						aria-label={`Remove occurrence recorded by ${savedTransaction.name}`}
					>
						{removingOccurrence ? "Removing…" : "Remove"}
					</Button>
				)}
			</div>
		);
	}
	return (
		<Card size="sm" className="mt-5">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Repeat size={16} aria-hidden="true" />
					Recurring schedule
				</CardTitle>
				{savedTransaction.enabled === false && (
					<CardAction>
						<Badge variant="secondary">Excluded</Badge>
					</CardAction>
				)}
			</CardHeader>
			<CardContent>
				<div className="flex flex-wrap items-center gap-2">
					<Field className="min-w-32 flex-1">
						<FieldLabel htmlFor={scheduleControlId}>
							First occurrence
						</FieldLabel>
						<Input
							id={scheduleControlId}
							ref={controlRef}
							type="date"
							name="startDate"
							required
							readOnly={locked}
							value={draft.startDate}
							onChange={(event) => {
								const startDate = event.target.value;
								const recurrence = draft.recurrence
									? ensureStartWeekday(draft.recurrence, startDate)
									: null;
								updateDraft(
									recurrence && recurrence !== draft.recurrence
										? { startDate, recurrence }
										: { startDate },
									"schedule",
								);
							}}
						/>
					</Field>
					<Field className="min-w-32 flex-1">
						<FieldLabel htmlFor={`${id}-end`}>Last occurrence</FieldLabel>
						<Input
							id={`${id}-end`}
							type="date"
							name="endDate"
							disabled={draft.noEndDate || locked}
							readOnly={locked}
							value={draft.endDate}
							onChange={(event) =>
								updateDraft({ endDate: event.target.value }, "schedule")
							}
						/>
					</Field>
					<Field orientation="horizontal" className="w-full">
						<Checkbox
							id={`${id}-no-end-date`}
							name="noEndDate"
							disabled={locked}
							checked={draft.noEndDate}
							onCheckedChange={(checked) =>
								updateDraft({ noEndDate: checked === true }, "schedule")
							}
						/>
						<FieldLabel htmlFor={`${id}-no-end-date`}>No end date</FieldLabel>
					</Field>
				</div>
			</CardContent>
		</Card>
	);
}
