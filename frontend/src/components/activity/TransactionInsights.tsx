import { useEffect, useRef, useState } from "react";
import { Check, Info, Link2, Repeat, Sparkles, Wallet, X } from "lucide-react";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import { providerLabel } from "@/domain/analysisFindings.ts";
import { dateLabel, money } from "@/domain/format.ts";
import type { Transaction } from "@/domain/model.ts";
import type { SettleCandidateRow } from "@/api/generated/model/settleCandidateRow.ts";
import {
	cadenceLabel,
	directionLabel,
	groupRecurringPatterns,
	patternTitle,
	type RecurringPattern,
} from "@/domain/recurringPatterns.ts";
import {
	useDismissAnalysisFinding,
	useReviewAnalysisFinding,
} from "@/state/analyses.ts";
import { Badge } from "../Badge.tsx";
import { Button, TextButton } from "../Button.tsx";
import { FieldError } from "../ErrorNotice.tsx";
import { InputField, SelectField } from "../Field.tsx";
import { mergeStyles } from "../mergeStyles.ts";
import { detailFooterClassName } from "./transactionDetailStyles.ts";
import {
	ExistingScheduleDialog,
	NewScheduleDialog,
} from "../analysis/RecurringPatterns.tsx";

export type InsightSuggestion =
	| {
			kind: "void";
			voidRow: Transaction;
			candidates: SettleCandidateRow[];
			priority: number;
	  }
	| { kind: "bnpl"; finding: AnalysisFinding; priority: number }
	| {
			kind: "recurring";
			pattern: RecurringPattern;
			priority: number;
	  };

function isPendingBnpl(finding: AnalysisFinding): boolean {
	if (finding.kind !== "bnpl") return false;
	if (finding.dismissed) return false;
	if (finding.stale) return false;
	if (finding.status === "withdrawn") return false;
	return !finding.review || !finding.review.decision;
}

/**
 * A confirmed plan still missing its length stays in the queue: the
 * detail step collects it. Findings with a duration are facts and leave.
 */
function needsDuration(finding: AnalysisFinding): boolean {
	if (finding.kind !== "bnpl") return false;
	if (finding.review?.decision !== "confirmed") return false;
	if (finding.review.duration) return false;
	if (finding.dismissed) return false;
	if (finding.stale) return false;
	return finding.status !== "withdrawn";
}

function isActionablePattern(pattern: RecurringPattern): boolean {
	const anchor = pattern.anchor;
	if (pattern.confirmed) return false;
	if (anchor.review?.decision) return false;
	if (anchor.dismissed) return false;
	if (anchor.stale) return false;
	return anchor.status !== "withdrawn";
}

/**
 * Quiet suggestion queue for one transaction. BNPL leads; a repeating
 * pattern follows. Confirmed facts stay in the detail body; only open
 * questions enter the queue. Mirrors the transaction-insights prototype
 * structure while using the app style and backend authority.
 */
export function buildInsightSuggestions({
	findings,
	transactionId,
	voidRow,
	candidates,
}: {
	findings: AnalysisFinding[];
	transactionId: string;
	/** Settling a void hold is an action too, not just a badge. */
	voidRow?: Transaction;
	/** Server-ranked posted charges for this hold. */
	candidates?: SettleCandidateRow[];
}): InsightSuggestion[] {
	const suggestions: InsightSuggestion[] = [];
	if (voidRow?.id === transactionId && voidRow.void && candidates?.length) {
		suggestions.push({
			kind: "void",
			voidRow,
			candidates,
			priority: 0,
		});
	}
	const bnpl = findings.find(
		(finding) =>
			finding.transactionId === transactionId &&
			(isPendingBnpl(finding) || needsDuration(finding)),
	);
	if (bnpl) {
		suggestions.push({ kind: "bnpl", finding: bnpl, priority: 1 });
	}
	for (const pattern of groupRecurringPatterns(findings)) {
		const touchesCurrent =
			pattern.findings.some(
				(finding) => finding.transactionId === transactionId,
			) || pattern.anchor.transactionId === transactionId;
		if (!touchesCurrent) continue;
		if (!isActionablePattern(pattern)) continue;
		suggestions.push({ kind: "recurring", pattern, priority: 2 });
	}
	return suggestions.sort((a, b) => a.priority - b.priority);
}

export function TransactionInsightsTrigger({
	count,
	onClick,
}: {
	count: number;
	onClick: () => void;
}) {
	if (!count) return null;
	return (
		<TextButton
			type="button"
			onClick={onClick}
			aria-label={`Review ${count} suggestion${count === 1 ? "" : "s"}`}
		>
			<Sparkles size={14} aria-hidden="true" />
			<span>Review suggestions</span>
			<Badge tone="neutral">{count}</Badge>
		</TextButton>
	);
}

function suggestionKey(suggestion: InsightSuggestion): string {
	if (suggestion.kind === "void") return `void-${suggestion.voidRow.id}`;
	return suggestion.kind === "bnpl"
		? suggestion.finding.id
		: suggestion.pattern.anchor.id;
}

function suggestionEvidence(suggestion: InsightSuggestion): string {
	if (suggestion.kind === "void") {
		const first = suggestion.candidates[0];
		if (!first) return "A posted charge matches this vanished hold.";
		if (suggestion.candidates.length === 1)
			return `${first.name} for ${money(first.amount)} on ${dateLabel(first.date, true)} matches this hold.`;
		return `${suggestion.candidates.length} posted charges match this hold. Pick the one it posted as.`;
	}
	if (suggestion.kind === "bnpl") {
		const reasons = (suggestion.finding.evidence ?? [])
			.map((item) => item.reason)
			.filter(Boolean);
		if (reasons.length) return reasons.join(" ");
		return `${providerLabel(suggestion.finding.provider)} appears in the bank record.`;
	}
	const pattern = suggestion.pattern;
	const evidenceCount = pattern.findings.length;
	return `${cadenceLabel(pattern.cadence)} · ${directionLabel(pattern.anchor.role)} · ${evidenceCount} recorded ${evidenceCount === 1 ? "payment" : "payments"}.`;
}

export function TransactionInsightsPanel({
	suggestions,
	names,
	readOnly,
	onDone,
	onMergeVoid,
}: {
	suggestions: InsightSuggestion[];
	names: Map<string, string>;
	readOnly: boolean;
	onDone: () => void;
	/** Merge a vanished hold into its posted charge, then remove the hold. */
	onMergeVoid?: (candidateId: string) => Promise<boolean>;
}) {
	const review = useReviewAnalysisFinding();
	const dismiss = useDismissAnalysisFinding();
	const [handled, setHandled] = useState<string[]>([]);
	const [phase, setPhase] = useState<"question" | "details">("question");
	const [durationCount, setDurationCount] = useState("");
	const [durationUnit, setDurationUnit] = useState<"weeks" | "months">(
		"months",
	);
	const [error, setError] = useState<string | null>(null);
	const [voidCandidateId, setVoidCandidateId] = useState("");
	const [voidSaving, setVoidSaving] = useState(false);
	const [voidError, setVoidError] = useState<string | null>(null);
	const [ruleDialog, setRuleDialog] = useState<"new" | "existing" | null>(null);
	// Keep the pattern visible while a schedule action refreshes the queue.
	const [recurringSnapshot, setRecurringSnapshot] =
		useState<RecurringPattern | null>(null);
	const durationRef = useRef<HTMLInputElement>(null);

	const open = suggestions.filter(
		(suggestion) => !handled.includes(suggestionKey(suggestion)),
	);
	const active = open[0] ?? null;
	const activeKey = active ? suggestionKey(active) : null;

	// A render-phase sync resets the step when the queue changes.
	const [syncedKey, setSyncedKey] = useState<string | null>(null);
	if (activeKey !== syncedKey && !recurringSnapshot) {
		setSyncedKey(activeKey);
		setPhase(
			active?.kind === "bnpl" && active.finding.review?.decision
				? "details"
				: "question",
		);
		setError(null);
		setDurationCount("");
		setDurationUnit("months");
		setRuleDialog(null);
		setVoidCandidateId(
			active?.kind === "void"
				? (active.candidates[0]?.transactionId ?? "")
				: "",
		);
		setVoidError(null);
	}

	useEffect(() => {
		if (phase === "details" && active?.kind === "bnpl")
			durationRef.current?.focus();
	}, [phase, active]);

	const markHandled = (suggestion: InsightSuggestion) => {
		setHandled((previous) => [...previous, suggestionKey(suggestion)]);
		setRecurringSnapshot(null);
		setPhase("question");
		setError(null);
		setDurationCount("");
		setDurationUnit("months");
		setRuleDialog(null);
		setVoidCandidateId("");
		setVoidError(null);
	};

	// An open schedule dialog survives acceptance removing the pattern from the queue.
	const shown: InsightSuggestion | null =
		recurringSnapshot != null
			? { kind: "recurring", pattern: recurringSnapshot, priority: 2 }
			: active;

	if (!shown) {
		return (
			<div
				className="flex flex-col items-center py-12 text-center"
				aria-live="polite"
			>
				<span className="mb-5 grid size-12 place-items-center rounded-full bg-success-bg text-success-text">
					<Check size={24} aria-hidden="true" />
				</span>
				<h3 className="m-0 mb-6 text-lg font-semibold tracking-tight">
					All caught up
				</h3>
				<Button type="button" variant="primary" onClick={onDone}>
					Done
				</Button>
			</div>
		);
	}

	const busy = review.isPending || dismiss.isPending || voidSaving;
	const isBnpl = shown.kind === "bnpl";
	const isVoid = shown.kind === "void";
	const Icon = isVoid ? Link2 : isBnpl ? Wallet : Repeat;
	const doneCount = handled.filter((key) =>
		suggestions.some((item) => suggestionKey(item) === key),
	).length;
	const dotCount = Math.max(doneCount + open.length, 1);
	const litCount = open.length === 0 ? dotCount : doneCount + 1;
	const position = doneCount + 1;
	const total = Math.max(doneCount + open.length, 1);
	const shownPosition = Math.min(position, total);
	const kicker = isVoid
		? `Vanished hold · ${shownPosition} of ${total}`
		: isBnpl
			? `Payment plan · ${shownPosition} of ${total}`
			: `Repeating payment · ${shownPosition} of ${total}`;
	const question = isVoid
		? "Did this hold post as one of these charges?"
		: isBnpl
			? `Is this a buy now, pay later payment from ${providerLabel(shown.finding.provider)}?`
			: "Add this repeating payment to your forecast?";
	const findingId =
		shown.kind === "bnpl"
			? shown.finding.id
			: shown.kind === "recurring"
				? shown.pattern.anchor.id
				: "";
	const runId =
		shown.kind === "bnpl"
			? shown.finding.runId
			: shown.kind === "recurring"
				? shown.pattern.anchor.runId
				: "";
	const revision =
		shown.kind === "bnpl"
			? shown.finding.feedbackRevision
			: shown.kind === "recurring"
				? shown.pattern.anchor.feedbackRevision
				: 0;
	const detailsPattern =
		recurringSnapshot ?? (shown.kind === "recurring" ? shown.pattern : null);
	const patternTitleText = detailsPattern
		? patternTitle(detailsPattern, names)
		: "";
	const selectedVoid =
		shown.kind === "void"
			? (shown.candidates.find(
					(candidate) => candidate.transactionId === voidCandidateId,
				) ??
				shown.candidates[0] ??
				null)
			: null;
	const movesVoidClaim = Boolean(
		shown.kind === "void" &&
		shown.voidRow.claimScheduleId &&
		shown.voidRow.claimOccurrenceDate &&
		!selectedVoid?.claimScheduleId,
	);

	const answer = (action: "confirm" | "reject") => {
		if (busy || readOnly || isVoid) return;
		setError(null);
		review.mutate(
			{
				id: findingId,
				input: {
					requestId: crypto.randomUUID(),
					runId,
					revision,
					action,
				},
			},
			{
				onSuccess: () => {
					if (action === "confirm") {
						setPhase("details");
					} else if (active) markHandled(active);
				},
				onError: () => setError("Your answer could not be saved."),
			},
		);
	};

	const snooze = () => {
		if (busy || readOnly) return;
		if (isVoid) {
			if (active) markHandled(active);
			return;
		}
		setError(null);
		dismiss.mutate(
			{ id: findingId, dismissed: true },
			{
				onSuccess: () => {
					if (active) markHandled(active);
				},
				onError: () => setError("The suggestion could not be deferred."),
			},
		);
	};

	const mergeVoid = async () => {
		if (shown.kind !== "void" || busy || readOnly) return;
		if (!voidCandidateId || !onMergeVoid) {
			setVoidError("Pick the posted charge first.");
			return;
		}
		setVoidError(null);
		setVoidSaving(true);
		const merged = await onMergeVoid(voidCandidateId);
		setVoidSaving(false);
		if (merged) markHandled(shown);
		else setVoidError("The hold could not be merged. Try again.");
	};

	const saveDuration = (event?: { preventDefault?: () => void }) => {
		event?.preventDefault?.();
		if (busy || readOnly || isVoid) return;
		const count = Number(durationCount);
		if (!Number.isInteger(count) || count < 1 || count > 5200) {
			setError("Check the plan length.");
			return;
		}
		setError(null);
		review.mutate(
			{
				id: findingId,
				input: {
					requestId: crypto.randomUUID(),
					runId,
					revision,
					action: "set-duration",
					duration: { count, unit: durationUnit },
				},
			},
			{
				onSuccess: () => {
					if (active) markHandled(active);
				},
				onError: () =>
					setError("The plan length could not be saved. Try again."),
			},
		);
	};

	return (
		<div aria-live="polite">
			<div className="mb-8 flex gap-2" aria-hidden="true">
				{Array.from({ length: dotCount }, (_, index) => (
					<span
						key={index}
						className={`h-0.5 flex-1 rounded-full ${index < litCount ? "bg-success-text" : "bg-line"}`}
					/>
				))}
			</div>
			<div className="mb-5 grid size-11 place-items-center rounded-surface bg-success-bg text-success-text">
				<Icon size={21} aria-hidden="true" />
			</div>
			<p className="mb-2 text-xs font-extrabold tracking-widest text-muted uppercase">
				{kicker}
			</p>
			<h3 className="m-0 mb-3 text-xl leading-snug font-bold tracking-tight">
				{question}
			</h3>
			<p className="mt-0 mb-6 flex items-start gap-2 rounded-surface bg-surface-2 p-3 text-xs leading-relaxed text-muted">
				<Info size={15} aria-hidden="true" className="mt-px flex-none" />
				<span>{suggestionEvidence(shown)}</span>
			</p>

			{shown.kind === "void" ? (
				<div className="grid gap-3">
					{shown.candidates.length > 1 && (
						<SelectField
							label="Posted as"
							name="suggestedPostedCharge"
							value={voidCandidateId}
							onChange={(event) => setVoidCandidateId(event.target.value)}
						>
							{shown.candidates.map((candidate) => (
								<option
									key={candidate.transactionId}
									value={candidate.transactionId}
								>
									{candidate.name} — {money(candidate.amount)} on{" "}
									{dateLabel(candidate.date, true)}
								</option>
							))}
						</SelectField>
					)}
					{movesVoidClaim && shown.voidRow.claimScheduleId && (
						<p className="m-0 text-xs leading-relaxed text-muted">
							The posted charge records the occurrence of{" "}
							{names.get(shown.voidRow.claimScheduleId) ?? "its rule"} on{" "}
							{dateLabel(shown.voidRow.claimOccurrenceDate ?? "", true)}.
						</p>
					)}
					{!movesVoidClaim &&
						shown.voidRow.claimScheduleId &&
						selectedVoid?.claimScheduleId && (
							<p className="m-0 text-xs leading-relaxed text-muted">
								The posted charge already records an occurrence. Its claim
								stays; this hold's claim is cleared with the hold.
							</p>
						)}
					<p className="m-0 text-xs leading-relaxed text-muted">
						The posted charge keeps its amount and date. This clears the
						vanished hold record.
					</p>
				</div>
			) : phase === "question" && !recurringSnapshot && isBnpl ? (
				<div className="grid grid-cols-2 gap-2">
					<Button
						type="button"
						variant="secondary"
						disabled={busy || readOnly}
						onClick={() => answer("reject")}
					>
						<X size={16} aria-hidden="true" /> No
					</Button>
					<Button
						type="button"
						variant="primary"
						disabled={busy || readOnly}
						onClick={() => answer("confirm")}
					>
						<Check size={16} aria-hidden="true" /> Yes
					</Button>
				</div>
			) : isBnpl && !recurringSnapshot ? (
				<form onSubmit={(event) => saveDuration(event)} className="grid gap-4">
					<div className="grid grid-cols-2 gap-3">
						<InputField
							label="Plan length"
							ref={durationRef}
							type="number"
							inputMode="numeric"
							min={1}
							max={5200}
							step={1}
							required
							value={durationCount}
							onChange={(event) => setDurationCount(event.target.value)}
							containerClassName="min-w-0"
						/>
						<SelectField
							label="Unit"
							value={durationUnit}
							onChange={(event) =>
								setDurationUnit(event.target.value as "weeks" | "months")
							}
						>
							<option value="weeks">Weeks</option>
							<option value="months">Months</option>
						</SelectField>
					</div>
					<p className="m-0 text-xs leading-relaxed text-muted">
						Enter the full plan length. The bank charge alone does not establish
						the total, count, or due dates.
					</p>
				</form>
			) : (
				<div className="grid gap-2">
					<p className="m-0 text-xs leading-relaxed text-muted">
						Create a forecast schedule or link payments to an existing schedule.
						Saving records your acceptance of the pattern. Recorded payments
						stay unchanged.
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="primary"
							size="sm"
							aria-label={`Create forecast schedule for ${patternTitleText}`}
							onClick={() => {
								setRecurringSnapshot(detailsPattern);
								setRuleDialog("new");
							}}
						>
							Create forecast schedule
						</Button>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							aria-label={`Link repeating pattern for ${patternTitleText} to an existing schedule`}
							onClick={() => {
								setRecurringSnapshot(detailsPattern);
								setRuleDialog("existing");
							}}
						>
							Link to existing schedule
						</Button>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							disabled={busy || readOnly}
							onClick={() => answer("reject")}
						>
							Not repeating
						</Button>
					</div>
				</div>
			)}

			<FieldError
				message={
					error ??
					voidError ??
					(review.isError || dismiss.isError
						? "Your answer could not be saved."
						: null)
				}
			/>

			<div
				className={mergeStyles(
					detailFooterClassName,
					"mt-8 max-sm:sticky max-sm:mx-0 max-sm:px-5",
				)}
			>
				{shown.kind === "void" ? (
					<>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={busy || readOnly}
							onClick={snooze}
						>
							Keep hold
						</Button>
						<Button
							type="button"
							variant="primary"
							size="sm"
							disabled={busy || readOnly || !selectedVoid}
							onClick={() => void mergeVoid()}
						>
							{voidSaving ? "Merging…" : "Merge and remove hold"}
						</Button>
					</>
				) : phase === "question" ? (
					<>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={busy || readOnly}
							onClick={snooze}
						>
							Not now
						</Button>
						<span className="text-xs font-semibold text-muted">
							{open.length} to review
						</span>
					</>
				) : isBnpl ? (
					<>
						<span className="text-xs font-semibold text-muted">
							{open.length} to review
						</span>
						<Button
							type="button"
							variant="primary"
							size="sm"
							disabled={busy || readOnly || !durationCount}
							onClick={() => saveDuration()}
						>
							{busy ? "Saving…" : "Save"}
						</Button>
					</>
				) : (
					<>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => {
								if (detailsPattern)
									setHandled((previous) =>
										previous.includes(detailsPattern.anchor.id)
											? previous
											: [...previous, detailsPattern.anchor.id],
									);
								setRecurringSnapshot(null);
								setPhase("question");
								setError(null);
								setRuleDialog(null);
							}}
						>
							Continue
						</Button>
						<span className="text-xs font-semibold text-muted">
							{open.length} to review
						</span>
					</>
				)}
			</div>

			{ruleDialog === "new" && detailsPattern && (
				<NewScheduleDialog
					findingId={detailsPattern.anchor.id}
					title={patternTitleText}
					readOnly={readOnly}
					onClose={() => {
						setRuleDialog(null);
						setRecurringSnapshot(null);
					}}
				/>
			)}
			{ruleDialog === "existing" && detailsPattern && (
				<ExistingScheduleDialog
					findingId={detailsPattern.anchor.id}
					title={patternTitleText}
					names={names}
					readOnly={readOnly}
					onClose={() => {
						setRuleDialog(null);
						setRecurringSnapshot(null);
					}}
				/>
			)}
		</div>
	);
}
