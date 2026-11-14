/**
 * Display-only classification for the card spending allowance hero.
 * Formulas live in buildCycleView; this helper only describes how to
 * render the already-computed allowance and hard-limit figures.
 */
export type AllowancePhase =
	| "unavailable"
	| "safe"
	| "into-reserve"
	| "over-limit";

export interface DescribeAllowanceInput {
	allowance: number;
	theoretical: number;
	reserve: number;
	available: boolean;
}

export interface AllowanceView {
	phase: AllowancePhase;
	/** Rendered hero value; null renders as "—". Over-limit renders $0. */
	primary: number | null;
	tone: "normal" | "positive" | "negative";
	/** Reserve dollars consumed by a negative allowance, capped at reserve. */
	intoReserve: number;
	/** Hard-limit overrun dollars; zero unless the theoretical is negative. */
	overLimit: number;
}

export function describeAllowance({
	allowance,
	theoretical,
	reserve,
	available,
}: DescribeAllowanceInput): AllowanceView {
	if (!available) {
		return {
			phase: "unavailable",
			primary: null,
			tone: "normal",
			intoReserve: 0,
			overLimit: 0,
		};
	}
	if (theoretical < 0) {
		return {
			phase: "over-limit",
			primary: 0,
			tone: "negative",
			intoReserve: Math.min(reserve, Math.max(0, -allowance)),
			overLimit: Math.max(0, -theoretical),
		};
	}
	if (allowance < 0) {
		return {
			phase: "into-reserve",
			primary: theoretical,
			tone: "normal",
			intoReserve: Math.min(reserve, Math.max(0, -allowance)),
			overLimit: 0,
		};
	}
	return {
		phase: "safe",
		primary: allowance,
		tone: "positive",
		intoReserve: 0,
		overLimit: 0,
	};
}
