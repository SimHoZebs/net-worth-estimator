import type {
	TexturePattern,
	TextureTone,
} from "@/components/texture/texture.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

export interface CycleBudgetSegment {
	label: string;
	amount: number;
	tone: TextureTone;
	pattern: TexturePattern;
	testId?: string;
}

export interface CycleBudgetGraph {
	/** With cash cushion: the full width of the bar. */
	headline: number;
	/** Without cash cushion: the boundary after the first two segments. */
	boundary: number;
	segments: CycleBudgetSegment[];
}

/** All comparisons happen in integer cents so a rounded backend amount and a
 * settings amount cannot disagree by a floating-point artifact. */
const toCents = (value: number | null | undefined): number | null =>
	typeof value === "number" && Number.isFinite(value)
		? Math.round(value * 100)
		: null;

/**
 * fundingRoom = savingsAllowance + savingsTarget + (fundingRoom − incomeFunded)
 * and incomeFunded = savingsAllowance + savingsTarget. A graph is only honest
 * when every part is known, nonnegative and additive, so anything else falls
 * back to the signed amount rows.
 */
export function buildCycleBudgetGraph({
	fundingRoom,
	incomeFunded,
	savingsAllowance,
	savingsTarget,
}: {
	fundingRoom: number | null | undefined;
	incomeFunded: number | null | undefined;
	savingsAllowance: number | null | undefined;
	savingsTarget: number | null | undefined;
}): CycleBudgetGraph | null {
	const room = toCents(fundingRoom);
	const income = toCents(incomeFunded);
	const allowance = toCents(savingsAllowance);
	const target = toCents(savingsTarget);
	if (room == null || income == null || allowance == null || target == null) {
		return null;
	}
	if (room <= 0 || income < 0 || allowance < 0 || target < 0) return null;
	const cushion = room - income;
	if (cushion < 0 || allowance + target !== income) return null;

	const segments: CycleBudgetSegment[] = [];
	if (allowance > 0) {
		segments.push({
			label: labels.afterSavingsGoal,
			amount: allowance / 100,
			tone: "sage",
			pattern: "solid",
			testId: "savings-allowance",
		});
	}
	if (target > 0) {
		segments.push({
			label: labels.savingsGoalSetAside,
			amount: target / 100,
			tone: "blue",
			pattern: "dots",
			testId: "savings-target",
		});
	}
	if (cushion > 0) {
		segments.push({
			label: labels.cashCushion,
			amount: cushion / 100,
			tone: "plum",
			pattern: "stripes",
			testId: "cash-cushion",
		});
	}
	if (segments.length === 0) return null;
	return {
		headline: room / 100,
		boundary: income / 100,
		segments,
	};
}
