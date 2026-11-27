import { Repeat } from "lucide-react";
import { useId, type RefObject } from "react";
import { dateLabel } from "../../domain/format.ts";
import {
	ensureStartWeekday,
	type Recurrence,
} from "../../domain/recurrence.ts";
import type { Transaction } from "../../domain/model.ts";
import { timeOfDay } from "../editors/transactionBodies.ts";
import {
	transactionDetailControlStyles,
	transactionDetailFieldStyles,
	transactionDetailLabelStyles,
	transactionDetailRowStackStyles,
} from "./activityStyles.ts";
import { Badge } from "@/components/ui/badge.tsx";
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
		if (!value) return "Standalone record";
		return (
			claimSchedules.find((rule) => rule.id === value)?.name ??
			staleClaimName ??
			"Unknown schedule"
		);
	};
	const occurrencePlaceholder =
		occurrenceOptions.length === 0
			? "No claimable occurrences"
			: "Choose the occurrence";
	const occurrenceLabel = (value: string | null): string =>
		value ? dateLabel(value, true) : occurrencePlaceholder;
	return (
		<div className={`${transactionDetailRowStackStyles} flex-1`}>
			<Field
				data-detail-row
				orientation="horizontal"
				className={transactionDetailFieldStyles}
			>
				<FieldLabel
					htmlFor={`${idPrefix}-schedule`}
					className={transactionDetailLabelStyles}
				>
					Records an occurrence of
				</FieldLabel>
				<Select
					disabled={!claimEditable}
					value={draft.claimScheduleId ?? ""}
					onValueChange={(value) => {
						const claimScheduleId = value ?? "";
						updateDraft(
							claimScheduleId === draft.claimScheduleId
								? { claimScheduleId }
								: { claimScheduleId, claimOccurrenceDate: "" },
							"schedule",
						);
					}}
				>
					<SelectTrigger
						id={`${idPrefix}-schedule`}
						className={`${transactionDetailControlStyles} w-full min-w-0`}
					>
						<SelectValue placeholder="Standalone record">
							{(value: string | null) => scheduleLabel(value)}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="">Standalone record</SelectItem>
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
			{draft.claimScheduleId && (
				<Field
					data-detail-row
					orientation="horizontal"
					className={transactionDetailFieldStyles}
				>
					<FieldLabel
						htmlFor={`${idPrefix}-occurrence`}
						className={transactionDetailLabelStyles}
					>
						Replaces occurrence on
					</FieldLabel>
					<Select
						disabled={!claimEditable}
						value={draft.claimOccurrenceDate ?? ""}
						onValueChange={(value) =>
							updateDraft({ claimOccurrenceDate: value ?? "" }, "schedule")
						}
					>
						<SelectTrigger
							id={`${idPrefix}-occurrence`}
							className={`${transactionDetailControlStyles} w-full min-w-0`}
						>
							<SelectValue placeholder={occurrencePlaceholder}>
								{(value: string | null) => occurrenceLabel(value)}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="">{occurrencePlaceholder}</SelectItem>
							{occurrenceOptions.map((date) => (
								<SelectItem key={date} value={date}>
									{dateLabel(date, true)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>
			)}
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
	staleClaimName,
}: {
	savedTransaction: Transaction;
	transactions: Transaction[];
	draft: TransactionDraft;
	updateDraft: (patch: Partial<TransactionDraft>, field: EditField) => void;
	locked: boolean;
	categoryReadOnly: boolean;
	/** Scheduled dates of the selected rule, closest to the posted day first. */
	occurrenceOptions: string[];
	staleClaimName?: string | null;
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
			className={transactionDetailRowStackStyles}
		>
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
					<Field
						data-detail-row
						orientation="horizontal"
						className={transactionDetailFieldStyles}
					>
						<FieldLabel
							htmlFor={`${id}-annual`}
							className={transactionDetailLabelStyles}
						>
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
							className={transactionDetailControlStyles}
							onChange={(event) =>
								updateDraft({ annualIncrease: event.target.value }, "schedule")
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
					staleClaimName={staleClaimName}
				/>
			)}
		</section>
	);
}

/**
 * Date controls for a recurring rule, rendered only for schedule records.
 * One-time transactions keep their scheduling in the claim fields below and
 * render no card here; the cadence is never restated in this card.
 */
export function ScheduleCapsule({
	savedTransaction,
	draft,
	updateDraft,
	locked,
	scheduleControlId,
	controlRef,
}: {
	savedTransaction: Transaction;
	draft: TransactionDraft;
	updateDraft: (patch: Partial<TransactionDraft>, field: EditField) => void;
	locked: boolean;
	/** DOM id for the first schedule control. */
	scheduleControlId?: string;
	/** Ref for the first schedule control, used by the footer shortcut. */
	controlRef?: RefObject<HTMLInputElement | null>;
}) {
	const id = useId();
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
				<div className={transactionDetailRowStackStyles}>
					<Field
						data-detail-row
						orientation="horizontal"
						className={`${transactionDetailFieldStyles} w-full`}
					>
						<FieldLabel
							htmlFor={scheduleControlId}
							className={transactionDetailLabelStyles}
						>
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
							className={transactionDetailControlStyles}
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
					<Field
						data-detail-row
						orientation="horizontal"
						className={`${transactionDetailFieldStyles} w-full`}
					>
						<FieldLabel
							htmlFor={`${id}-end`}
							className={transactionDetailLabelStyles}
						>
							Last occurrence
						</FieldLabel>
						<Input
							id={`${id}-end`}
							type="date"
							name="endDate"
							disabled={draft.noEndDate || locked}
							readOnly={locked}
							value={draft.endDate}
							className={transactionDetailControlStyles}
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
