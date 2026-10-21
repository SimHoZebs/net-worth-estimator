import { finite, isRecord, stringValue } from "../domain/guards.ts";
import type { MovementResult } from "../domain/result.ts";
import type {
	FinancialModelDocument,
	MovementEvent,
	ProjectionResult,
} from "./contracts.ts";

function movementSource(
	event: MovementEvent,
	document: FinancialModelDocument | null,
) {
	return (
		document?.postings.find((item) => item.id === event.origin.postingId) ??
		document?.recurrenceRules?.find(
			(item) => item.id === event.origin.postingId,
		)
	);
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
	const startCheckpoint =
		document?.checkpoints.some((checkpoint) => checkpoint.Date === start) ??
		false;
	return (result.movementEvents ?? [])
		.filter(
			(event) =>
				event.date > start || (event.date === start && !startCheckpoint),
		)
		.map((event) => {
			const source = movementSource(event, document);
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
