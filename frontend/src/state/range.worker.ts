import * as errore from "errore";
import { validatePlan } from "../domain/model.ts";
import { calculateRange } from "../domain/projection.ts";

class CalculationError extends errore.createTaggedError({
	name: "CalculationError",
	message: "The scenario calculation failed. Retry with a shorter horizon.",
}) {}

self.onmessage = (event: MessageEvent<{ plan: unknown; years: number }>) => {
	const plan = validatePlan(event.data.plan);
	if (plan instanceof Error) {
		self.postMessage({ type: "error", message: plan.message });
		return;
	}
	const result = errore.try({
		try: () =>
			calculateRange({
				plan,
				years: event.data.years,
				onProgress: (progress) =>
					self.postMessage({ type: "progress", progress }),
			}),
		catch: (cause) => new CalculationError({ cause }),
	});
	if (result instanceof Error) {
		self.postMessage({ type: "error", message: result.message });
		return;
	}
	self.postMessage({ type: "result", result });
};
