import { finite, isRecord, stringValue } from "../domain/guards.ts";
import type { MovementResult } from "../domain/result.ts";
import type { FinancialModelDocument, ProjectionResult } from "./contracts.ts";

type MovementSource = {
	name: string;
	sourceAccountId: string | null;
	destinations: string[] | null;
};

/** Index sources once per call so per-event lookup stays O(1). */
function movementSourceIndex(
	document: FinancialModelDocument | null,
): Map<string, MovementSource> {
	const index = new Map<string, MovementSource>();
	if (!document) return index;
	for (const item of document.postings) {
		if (!index.has(item.id))
			index.set(item.id, {
				name: item.name,
				sourceAccountId: item.sourceAccountId,
				destinations: item.destinations,
			});
	}
	for (const item of document.recurrenceRules ?? []) {
		if (!index.has(item.id))
			index.set(item.id, {
				name: item.name,
				sourceAccountId: item.sourceAccountId,
				destinations: item.destinations,
			});
	}
	for (const item of document.plannedPurchases ?? []) {
		if (!index.has(item.id))
			index.set(item.id, {
				name: item.name,
				sourceAccountId: item.fundingAccountId,
				destinations: null,
			});
	}
	return index;
}

function movementConstraintLabel(type: string): string {
	switch (type) {
		case "source-floor":
			return "Protected account balance";
		case "destination-ceiling":
			return "Destination account ceiling";
		case "action-limit":
			return "Annual transaction limit";
		case "source-unavailable":
			return "Funding account unavailable";
		default:
			return type
				.split("-")
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join(" ");
	}
}

/** Adapt engine evidence without selecting a configured evaluation's scope. */
export function projectionMovements(
	result: ProjectionResult,
	document: FinancialModelDocument | null,
): MovementResult[] {
	const start = result.milestones.projectionStartDate;
	const startCheckpoint = document?.checkpoints.some(
		(checkpoint) => checkpoint.Date === start,
	);
	const sources = movementSourceIndex(document);
	return (result.movementEvents ?? [])
		.filter(
			(event) =>
				event.date > start || (event.date === start && !startCheckpoint),
		)
		.map((event) => {
			const source = sources.get(event.origin.postingId);
			const deltas = event.accountDeltas ?? [];
			const constraints = Array.isArray(event.bindingConstraints)
				? event.bindingConstraints
				: [];
			const types = constraints.flatMap((value) => {
				const type = stringValue(isRecord(value) ? value.type : null);
				return type ? [type] : [];
			});
			return {
				date: event.date,
				movementId: event.origin.postingId,
				name: source?.name || event.origin.postingId,
				requested: event.requestedAmount,
				realized: event.realizedAmount,
				fromId:
					source?.sourceAccountId ??
					deltas.find((delta) => delta.delta < 0)?.accountId ??
					null,
				toId:
					source?.destinations?.[0] ??
					deltas.find((delta) => delta.delta > 0)?.accountId ??
					null,
				accountDeltas: deltas,
				available: finite(event.availableAmount),
				constraint: types.length
					? movementConstraintLabel(types[0]!)
					: event.realizedAmount + 0.01 < event.requestedAmount
						? "Backend funding constraint"
						: null,
				...(types.length ? { constraintTypes: types } : {}),
				...(event.fulfillment ? { fulfillment: event.fulfillment } : {}),
			};
		});
}
