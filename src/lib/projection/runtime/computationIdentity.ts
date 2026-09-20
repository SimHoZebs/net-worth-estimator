import type { IncomeDataSnapshot } from "../types/income";
import type {
	EvaluationTables,
	FinancialModelDocument,
	ProjectionRuntimeSettings,
} from "../types/model";
import { canonicalSerialize, fnv1aHex } from "../utils/canonical";

export function evaluationComputationDescriptor(evaluations: EvaluationTables) {
	const describe = <
		T extends { instanceId: string; enabled: boolean; config: unknown },
	>(
		item: T,
	) => ({
		instanceId: item.instanceId,
		enabled: item.enabled,
		config: item.enabled ? item.config : null,
	});
	return {
		financialIndependence: evaluations.financialIndependence.map(describe),
		netWorthThreshold: evaluations.netWorthThreshold.map(describe),
		postingFulfillment: evaluations.postingFulfillment.map(describe),
	};
}

// The server ignores evaluation labels for cache identity (its artifact
// descriptor strips labels and disabled configs), so the client request key
// uses this label-neutral descriptor while request bodies pass labels
// through for labeled result envelopes.
export function projectionRequestIdentity(options: {
	document: FinancialModelDocument | null;
	settings: ProjectionRuntimeSettings;
	incomeData?: IncomeDataSnapshot;
	extra?: unknown;
}): string {
	return canonicalSerialize({
		document: options.document ? simulationDocument(options.document) : null,
		settings: {
			fallbackProjectionStartDate: options.settings.fallbackProjectionStartDate,
			horizonYears: options.settings.horizonYears,
			evaluations: evaluationComputationDescriptor(
				options.settings.evaluations,
			),
		},
		extra: options.extra ?? null,
		incomeData: options.incomeData ?? null,
	});
}

export function simulationDocument(
	document: FinancialModelDocument,
): Pick<FinancialModelDocument, "accounts" | "checkpoints" | "postings"> {
	return {
		accounts: document.accounts,
		checkpoints: document.checkpoints,
		postings: document.postings,
	};
}

export interface ComputationSummary {
	accounts: number;
	postings: number;
	checkpoints: number;
	horizonYears: number;
	evaluations: string;
	incomeData: boolean;
	extra: string;
}

// summarizeComputation compresses request inputs to one loggable line so
// recalculation triggers stay explainable: identical summaries mean the
// recompute was redundant (cache/attach should have served it).
export function summarizeComputation(options: {
	document: FinancialModelDocument | null;
	settings: ProjectionRuntimeSettings;
	incomeData?: IncomeDataSnapshot;
	extra?: unknown;
}): ComputationSummary {
	const tables = options.settings.evaluations;
	return {
		accounts: options.document?.accounts.length ?? 0,
		postings: options.document?.postings.length ?? 0,
		checkpoints: options.document?.checkpoints.length ?? 0,
		horizonYears: options.settings.horizonYears,
		evaluations: [
			`fi:${tables.financialIndependence.filter((item) => item.enabled).length}`,
			`nw:${tables.netWorthThreshold.filter((item) => item.enabled).length}`,
			`pf:${tables.postingFulfillment.filter((item) => item.enabled).length}`,
		].join("/"),
		incomeData: options.incomeData != null,
		extra: canonicalSerialize(options.extra ?? null).slice(0, 120),
	};
}

// diffComputationSummaries names which facets changed between two
// recalculation triggers. An empty result means same data recomputed —
// either a spurious restart or a backend that lost its cache/registry.
export function diffComputationSummaries(
	previous: ComputationSummary,
	next: ComputationSummary,
): string[] {
	const changed: string[] = [];
	(
		[
			"accounts",
			"postings",
			"checkpoints",
			"horizonYears",
			"evaluations",
			"incomeData",
			"extra",
		] as const
	).forEach((facet) => {
		if (previous[facet] !== next[facet]) changed.push(facet);
	});
	return changed;
}

export function formatComputationSummary(summary: ComputationSummary): string {
	return (
		`accounts=${summary.accounts} postings=${summary.postings} ` +
		`checkpoints=${summary.checkpoints} horizon=${summary.horizonYears} ` +
		`evals=${summary.evaluations} income=${summary.incomeData ? "yes" : "no"} ` +
		`extra=${summary.extra}`
	);
}

// identityPrefix shortens a request identity for logs. It does not match
// the backend key_prefix (different hash), but the summary line beside it
// lets both sides be correlated by hand.
export function identityPrefix(identity: string): string {
	return fnv1aHex(identity);
}

// logRecalculation is the single client funnel for computation lifecycle
// lines (console.debug: hidden by default, visible when debugging missed
// cache/attach cases). Shape mirrors the backend key=value lines.
export function logRecalculation(
	event: string,
	fields: Record<string, string | number | boolean>,
): void {
	const detail = Object.entries(fields)
		.map(([key, value]) => `${key}=${value}`)
		.join(" ");
	console.debug(`[projection] ${event} ${detail}`);
}
