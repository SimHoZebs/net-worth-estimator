import type { Snapshot } from "../state/storage.ts";
import { money } from "./format.ts";
import { changesBetween, type Plan } from "./model.ts";
import { currentNetWorth, type Projection } from "./result.ts";

export function comparisonMetrics(projection: Projection) {
	return {
		current: currentNetWorth(projection),
		final: projection.points.at(-1)?.total ?? 0,
		goalDate:
			projection.goals.find((g) => g.goal.kind === "net-worth")?.firstDate ??
			null,
		shortfallDate: projection.firstFailure?.date ?? null,
	};
}

export type ComparisonMetrics = ReturnType<typeof comparisonMetrics>;
export type PlanChange = ReturnType<typeof changesBetween>[number];

function assumptionKey(plan: Plan) {
	return JSON.stringify({
		...plan.assumptions,
		rates: plan.accounts.map((a) => ({
			id: a.id,
			balance: a.balance,
			floor: a.floor,
			ceiling: a.ceiling,
			observedOn: a.observedOn,
			source: a.source,
		})),
	});
}

export function comparisonContext({
	saved,
	plan,
	projection,
	savedProjection,
	snapshot,
	years,
}: {
	saved: Plan;
	plan: Plan;
	projection: Projection;
	savedProjection: Projection;
	snapshot: Snapshot | null;
	years: number;
}) {
	const current = comparisonMetrics(projection);
	const previous = snapshot ?? comparisonMetrics(savedProjection);
	return {
		changes: changesBetween({ saved, current: plan }),
		current,
		previous,
		comparable:
			!snapshot ||
			(snapshot.years === years &&
				snapshot.startDate === plan.startDate &&
				snapshot.assumptions === assumptionKey(plan) &&
				snapshot.name === plan.name),
	};
}

export function captureComparison({
	plan,
	revision,
	years,
	changes,
	current,
	capturedAt,
}: {
	plan: Plan;
	revision: number;
	years: number;
	changes: number;
	current: ComparisonMetrics;
	capturedAt: string;
}): Snapshot {
	return {
		capturedAt,
		name: plan.name,
		years,
		startDate: plan.startDate,
		revision,
		changes,
		assumptions: assumptionKey(plan),
		...current,
	};
}

const fieldNames: Record<string, string> = {
	name: "Name",
	amount: "Amount",
	balance: "Balance",
	floor: "Protected balance",
	ceiling: "Maximum balance",
	annualIncrease: "Annual increase (%)",
	startDate: "Start date",
	endDate: "End date",
	frequency: "Frequency",
	target: "Target",
	enabled: "Included",
	fromId: "Source account",
	toId: "Destination account",
	accountId: "Account",
	observedOn: "Balance date",
	provenance: "Basis",
	source: "Source",
	volatility: "Investment variability (%)",
	inflation: "Inflation (%)",
	kind: "Type",
};

type FieldValue = string | number | boolean | null;
function display(value: FieldValue | undefined, key: string) {
	return value === null || value === undefined
		? "None"
		: typeof value === "boolean"
			? value
				? "Yes"
				: "No"
			: typeof value === "number" &&
					["amount", "balance", "floor", "ceiling", "target"].includes(key)
				? money(value)
				: String(value);
}

export type ChangeDetails =
	| { kind: "text"; before: string; after: string }
	| {
			kind: "fields";
			rows: { key: string; label: string; before: string; after: string }[];
	  };

export function changeDetails({
	before,
	after,
}: Pick<PlanChange, "before" | "after">): ChangeDetails {
	if ((before && !before.startsWith("{")) || (after && !after.startsWith("{")))
		return { kind: "text", before: before || "New", after: after || "Removed" };
	const a = before ? (JSON.parse(before) as Record<string, FieldValue>) : {};
	const b = after ? (JSON.parse(after) as Record<string, FieldValue>) : {};
	const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
		(key) => key !== "id" && key !== "readOnly" && a[key] !== b[key],
	);
	return {
		kind: "fields",
		rows: keys.map((key) => ({
			key,
			label: fieldNames[key] ?? key,
			before: display(a[key], key),
			after: display(b[key], key),
		})),
	};
}
