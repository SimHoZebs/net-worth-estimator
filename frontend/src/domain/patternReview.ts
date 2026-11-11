import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import {
	groupPaymentPatterns,
	isMainIncome,
	paymentAmount,
	type PaymentPattern,
} from "./paymentFindings.ts";
import {
	cadenceLabel,
	directionLabel,
	groupRecurringPatterns,
	type RecurringPattern,
} from "./recurringPatterns.ts";

export type PatternReviewTab = "review" | "saved" | "dismissed";

export interface PatternReviewRow {
	key: string;
	findings: AnalysisFinding[];
	payments: PaymentPattern[];
	repetition: RecurringPattern[];
	tab: PatternReviewTab;
}

export interface PatternReviewChip {
	key: string;
	label: string;
	tone: "success" | "neutral";
}

export interface PatternReviewAmount {
	text: string;
	direction: string;
	inflow: boolean;
}

/** Payment purposes and repetition share one review queue per stream. */
export function isPatternReviewFinding(finding: AnalysisFinding): boolean {
	return !!finding.pattern || finding.kind === "recurring";
}

/** Tab assignment is answers-only: any confirmed review saves the row. */
export function reviewTabFor(findings: AnalysisFinding[]): PatternReviewTab {
	if (findings.some((finding) => finding.review?.decision === "confirmed"))
		return "saved";
	if (
		findings.some(
			(finding) => finding.review?.decision === "rejected" || finding.dismissed,
		)
	)
		return "dismissed";
	return "review";
}

/**
 * Group findings by stream, keeping current and withdrawn evidence separate.
 * Findings without a stream stay standalone. Payment anchors keep the
 * most-recently-answered eligible occurrence; repetition keeps its
 * occurrence-set grouping for dialog actions.
 */
export function groupPatternReviews(
	findings: AnalysisFinding[],
): PatternReviewRow[] {
	const groups = new Map<string, AnalysisFinding[]>();
	for (const finding of findings) {
		if (!isPatternReviewFinding(finding)) continue;
		const key = finding.streamId
			? JSON.stringify(["stream", finding.streamId, finding.status])
			: JSON.stringify(["finding", finding.id]);
		const group = groups.get(key);
		if (group) group.push(finding);
		else groups.set(key, [finding]);
	}
	return [...groups.entries()]
		.map(([key, members]) => {
			const findings = [...members].sort((a, b) => a.id.localeCompare(b.id));
			const row: PatternReviewRow = {
				key,
				findings,
				payments: groupPaymentPatterns(members),
				repetition: groupRecurringPatterns(members),
				tab: reviewTabFor(members),
			};
			return row;
		})
		.sort(
			(a, b) =>
				Number(isMainReview(b)) - Number(isMainReview(a)) ||
				a.key.localeCompare(b.key),
		);
}

function isMainReview(row: PatternReviewRow): boolean {
	return row.payments.some((pattern) => isMainIncome(pattern.anchor));
}

/** Most-common saved name first, else capitalized provider, else kind. */
export function reviewTitle(
	row: PatternReviewRow,
	names: Map<string, string>,
): string {
	const counts = new Map<string, number>();
	let best = "";
	let bestCount = 0;
	for (const finding of row.findings) {
		const name = names.get(finding.transactionId) ?? "";
		if (!name) continue;
		const count = (counts.get(name) ?? 0) + 1;
		counts.set(name, count);
		if (count > bestCount) {
			best = name;
			bestCount = count;
		}
	}
	if (best) return best;
	const anchors = [
		...row.payments.map((pattern) => pattern.anchor),
		...row.repetition.map((pattern) => pattern.anchor),
		...row.findings,
	];
	const provider =
		anchors.map((finding) => (finding.provider ?? "").trim()).find(Boolean) ??
		"";
	const raw = provider || (row.findings[0]?.kind.trim() ?? "");
	return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Payment pattern";
}

export function reviewCadenceLabel(row: PatternReviewRow): string {
	const cadence =
		[
			...row.payments.map((pattern) => pattern.anchor.product),
			...row.repetition.map((pattern) => pattern.cadence),
		]
			.map((value) => (value ?? "").trim())
			.find(Boolean) ?? "";
	return cadence ? cadenceLabel(cadence) : "Repetition not established";
}

export function reviewRecordedCount(row: PatternReviewRow): number {
	return new Set(row.findings.map((finding) => finding.transactionId)).size;
}

export function reviewAmount(
	row: PatternReviewRow,
): PatternReviewAmount | null {
	const anchor = row.payments
		.map((pattern) => pattern.anchor)
		.find((finding) => finding.pattern);
	if (!anchor?.pattern) return null;
	return {
		text: `${paymentAmount(anchor.pattern.typicalAmount, anchor.pattern.currency)} typical`,
		direction: directionLabel(anchor.role),
		inflow: anchor.role === "inflow",
	};
}

/**
 * One chip per payment classification plus a repetition marker. Unanswered
 * suggestions read as kind questions, confirmed ones as the kind itself;
 * every other state reuses the existing finding words.
 */
export function reviewChipLabel(finding: AnalysisFinding): string {
	const kind = finding.kind;
	if (finding.status === "withdrawn") return "Withdrawn";
	if (finding.review?.decision === "rejected") return `Not ${kind}`;
	if (finding.review?.decision === "confirmed") return kind;
	if (finding.dismissed) return "Dismissed";
	if (finding.stale) return "Awaiting analysis";
	if (finding.judgment?.status === "pending") return "Review pending";
	if (finding.judgment?.decision === "unsupported") return `Not ${kind}`;
	if (finding.judgment?.decision === "uncertain") return `Possible ${kind}`;
	if (isMainIncome(finding)) return "Main income";
	return `${kind}?`;
}

export function reviewChips(row: PatternReviewRow): PatternReviewChip[] {
	const chips = row.payments.map((pattern) => ({
		key: `payment:${pattern.key}`,
		label: reviewChipLabel(pattern.anchor),
		tone: (pattern.anchor.review?.decision === "confirmed"
			? "success"
			: "neutral") as "success" | "neutral",
	}));
	row.repetition.forEach((pattern, index) => {
		chips.push({
			key: `repetition:${pattern.key}:${index}`,
			label: "Repeating",
			tone: pattern.confirmed ? "success" : "neutral",
		});
	});
	return chips;
}
