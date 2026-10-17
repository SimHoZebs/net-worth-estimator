import { describe, expect, it } from "vitest";
import { resolveStatementCycle } from "./cardCycle.ts";

describe("resolveStatementCycle", () => {
	it("anchors the cycle to the statement day within the same month", () => {
		const cycle = resolveStatementCycle({
			todayIso: "2026-09-20",
			statementDay: 15,
		});
		expect(cycle.cycleStart).toBe("2026-09-15");
		expect(cycle.cycleEnd).toBe("2026-10-14");
		expect(cycle.daysTotal).toBe(30);
		expect(cycle.daysLeft).toBe(25);
	});

	it("uses the prior month anchor when today precedes the statement day", () => {
		const cycle = resolveStatementCycle({
			todayIso: "2026-09-10",
			statementDay: 15,
		});
		expect(cycle.cycleStart).toBe("2026-08-15");
		expect(cycle.cycleEnd).toBe("2026-09-14");
		expect(cycle.daysLeft).toBe(5);
	});
});
