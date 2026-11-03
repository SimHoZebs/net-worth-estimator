import { useEffect, useRef, useState } from "react";
import {
	Check,
	Info,
	Repeat,
	Sparkles,
	Wallet,
	X,
} from "lucide-react";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import { providerLabel } from "@/domain/analysisFindings.ts";
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
import { ErrorNotice } from "../ErrorNotice.tsx";
import { InputField, SelectField } from "../Field.tsx";
import {
	ExistingRuleDialog,
	NewRuleDialog,
} from "../analysis/RecurringPatterns.tsx";

export type InsightSuggestion =
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
	postingId,
}: {
	findings: AnalysisFinding[];
	postingId: string;
}): InsightSuggestion[] {
	const suggestions: InsightSuggestion[] = [];
	const bnpl = findings.find(
		(finding) =>
			finding.postingId === postingId &&
			(isPendingBnpl(finding) || needsDuration(finding)),
	);
	if (bnpl) {
		suggestions.push({ kind: "bnpl", finding: bnpl, priority: 1 });
	}
	for (const pattern of groupRecurringPatterns(findings)) {
		const touchesCurrent =
			pattern.findings.some((finding) => finding.postingId === postingId) ||
			pattern.anchor.postingId === postingId;
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
	return suggestion.kind === "bnpl"
		? suggestion.finding.id
		: suggestion.pattern.anchor.id;
}

function suggestionEvidence(suggestion: InsightSuggestion): string {
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
}: {
	suggestions: InsightSuggestion[];
	names: Map<string, string>;
	readOnly: boolean;
	onDone: () => void;
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
	const [ruleDialog, setRuleDialog] = useState<"new" | "existing" | null>(
		null,
	);
	// A confirmed repeating pattern leaves the queue on refetch, so the
	// detail step keeps its own snapshot to offer rule creation.
	const [recurringSnapshot, setRecurringSnapshot] =
		useState<RecurringPattern | null>(null);
	const durationRef = useRef<HTMLInputElement>(null);

	const open = suggestions.filter(
		(suggestion) => !handled.includes(suggestionKey(suggestion)),
	);
	const active = open[0] ?? null;
	const activeKey = active ? suggestionKey(active) : null;

	// A fresh queue entry starts at its question; a confirmed plan still
	// missing its length starts at the duration step. A snapshot-held
	// repeating pattern keeps its detail step across refetches. The sync
	// below is a render-phase adjustment, so a refetched queue never
	// strands the user on the wrong step.
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
	};

	// The detail step for a confirmed repeating pattern survives the
	// refetch that drops it from the queue.
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
				<h3 className="m-0 text-lg font-semibold tracking-tight">
					All caught up
				</h3>
				<p className="mt-2 mb-6 text-xs leading-relaxed text-muted">
					There are no more suggestions to review.
				</p>
				<Button type="button" variant="primary" onClick={onDone}>
					Done
				</Button>
			</div>
		);
	}

	const busy = review.isPending || dismiss.isPending;
	const isBnpl = shown.kind === "bnpl";
	const Icon = shown.kind === "bnpl" ? Wallet : Repeat;
	const doneCount = handled.filter((key) =>
		suggestions.some((item) => suggestionKey(item) === key),
	).length;
	const dotCount = Math.max(doneCount + open.length, 1);
	const litCount = open.length === 0 ? dotCount : doneCount + 1;
	const position = doneCount + 1;
	const total = Math.max(doneCount + open.length, 1);
	const shownPosition = Math.min(position, total);
	const kicker =
		shown.kind === "bnpl"
			? `Payment plan · ${shownPosition} of ${total}`
			: `Repeating payment · ${shownPosition} of ${total}`;
	const question =
		shown.kind === "bnpl"
			? `Is this a buy now, pay later payment from ${providerLabel(shown.finding.provider)}?`
			: "Is this a repeating payment?";
	const findingId =
		shown.kind === "bnpl" ? shown.finding.id : shown.pattern.anchor.id;
	const runId =
		shown.kind === "bnpl" ? shown.finding.runId : shown.pattern.anchor.runId;
	const revision =
		shown.kind === "bnpl"
			? shown.finding.feedbackRevision
			: shown.pattern.anchor.feedbackRevision;
	const detailsPattern =
		recurringSnapshot ??
		(shown.kind === "recurring" ? shown.pattern : null);
	const patternTitleText = detailsPattern
		? patternTitle(detailsPattern, names)
		: "";

	const answer = (action: "confirm" | "reject") => {
		if (busy || readOnly) return;
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
						if (active?.kind === "recurring")
							setRecurringSnapshot(active.pattern);
						setPhase("details");
					} else if (active) markHandled(active);
				},
				onError: () =>
					setError("Your answer could not be saved. Try again."),
			},
		);
	};

	const snooze = () => {
		if (busy || readOnly) return;
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

	const saveDuration = (event?: { preventDefault?: () => void }) => {
		event?.preventDefault?.();
		if (busy || readOnly) return;
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
			<p className="mb-2 text-[10px] font-extrabold tracking-widest text-muted uppercase">
				{kicker}
			</p>
			<h3 className="m-0 mb-3 text-[22px] leading-snug font-bold tracking-tight">
				{question}
			</h3>
			<p className="mt-0 mb-6 flex items-start gap-2 rounded-surface bg-surface-2 p-3 text-[11px] leading-relaxed text-muted">
				<Info size={15} aria-hidden="true" className="mt-px flex-none" />
				<span>{suggestionEvidence(shown)}</span>
			</p>

			{phase === "question" && !recurringSnapshot ? (
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
				<form
					onSubmit={(event) => saveDuration(event)}
					className="grid gap-4"
				>
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
					<p className="m-0 text-[11px] leading-relaxed text-muted">
						Enter the full plan length. The bank charge alone does not
						establish the total, count, or due dates.
					</p>
				</form>
			) : (
				<div className="grid gap-2">
					<p className="m-0 text-xs leading-relaxed text-muted">
						Confirmed as repeating. Create its forecast rule or link its
						payments to an existing rule. Recorded payments stay unchanged.
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							aria-label={`Review forecast plan for ${patternTitleText}`}
							onClick={() => setRuleDialog("new")}
						>
							Review forecast plan
						</Button>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							aria-label={`Link repeating pattern for ${patternTitleText} to an existing rule`}
							onClick={() => setRuleDialog("existing")}
						>
							Link to existing rule
						</Button>
					</div>
				</div>
			)}

			{(error || review.isError || dismiss.isError) && (
				<ErrorNotice
					message={error ?? "Your answer could not be saved. Try again."}
				/>
			)}

			<div className="sticky bottom-0 z-10 -mx-8 -mb-8 mt-8 flex items-center justify-between gap-3 border-t border-line bg-surface px-8 pt-4 pb-1 max-sm:-mx-5 max-sm:-mb-5 max-sm:px-5">
				{phase === "question" ? (
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
						<span className="text-[10px] font-semibold text-muted">
							{open.length} to review
						</span>
					</>
				) : isBnpl ? (
					<>
						<span className="text-[10px] font-semibold text-muted">
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
						<span className="text-[10px] font-semibold text-muted">
							{open.length} to review
						</span>
					</>
				)}
			</div>

			{ruleDialog === "new" && detailsPattern && (
				<NewRuleDialog
					findingId={detailsPattern.anchor.id}
					title={patternTitleText}
					readOnly={readOnly}
					onClose={() => setRuleDialog(null)}
				/>
			)}
			{ruleDialog === "existing" && detailsPattern && (
				<ExistingRuleDialog
					findingId={detailsPattern.anchor.id}
					title={patternTitleText}
					names={names}
					readOnly={readOnly}
					onClose={() => setRuleDialog(null)}
				/>
			)}
		</div>
	);
}
