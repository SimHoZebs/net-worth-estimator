import {
	isNumericArithmetic,
	parseNumericArithmetic,
} from "@/lib/postingCategories";
import { type FinancialModelDocument, getExpression } from "@/lib/projection";

/** Paycheck-cycle inputs. Pure UI-side derivation; never touches simulation. */
export interface HouseholdCycleInputs {
	checkingBalance: number;
	unpaidCashObligations: number;
	primeExposure: number;
	ultimateExposure: number;
	wifeCurrentCycle: number;
	expectedPaycheck: number;
	nextMonthFixedObligations: number;
	protectedReserve: number;
}

export interface HouseholdCycleResult {
	cashCushion: number;
	currentCycleCommitted: number;
	theoreticalRoom: number;
	conservativeRoom: number;
}

/** Household cycle cutoff day of month (the 19th). */
export const HOUSEHOLD_CYCLE_CUTOFF_DAY = 19;

export const DEFAULT_HOUSEHOLD_CYCLE_INPUTS: HouseholdCycleInputs = {
	checkingBalance: 0,
	unpaidCashObligations: 0,
	primeExposure: 0,
	ultimateExposure: 0,
	wifeCurrentCycle: 0,
	expectedPaycheck: 0,
	nextMonthFixedObligations: 0,
	protectedReserve: 725,
};

function toFinite(value: number): number {
	return Number.isFinite(value) ? value : 0;
}

/** Cash cushion ignores card exposure; card capacity ignores checking. */
export function computeHouseholdCycle(
	inputs: HouseholdCycleInputs,
): HouseholdCycleResult {
	const checking = toFinite(inputs.checkingBalance);
	const unpaid = toFinite(inputs.unpaidCashObligations);
	const prime = toFinite(inputs.primeExposure);
	const ultimate = toFinite(inputs.ultimateExposure);
	const wife = toFinite(inputs.wifeCurrentCycle);
	const paycheck = toFinite(inputs.expectedPaycheck);
	const fixed = toFinite(inputs.nextMonthFixedObligations);
	const reserve = toFinite(inputs.protectedReserve);

	const cashCushion = checking - unpaid;
	const currentCycleCommitted = prime + ultimate + wife;
	const theoreticalRoom = paycheck - fixed - currentCycleCommitted;
	const conservativeRoom = theoreticalRoom - reserve;

	return {
		cashCushion,
		currentCycleCommitted,
		theoreticalRoom,
		conservativeRoom,
	};
}

/** Latest observed checking checkpoint balance; null when unobserved. */
export function latestCheckingBalance(
	document: FinancialModelDocument,
): number | null {
	let latest: { date: string; balance: number } | null = null;
	for (const checkpoint of document.checkpoints) {
		if (checkpoint.AccountId !== "checking") continue;
		if (latest === null || checkpoint.Date > latest.date) {
			latest = { date: checkpoint.Date, balance: checkpoint.Balance };
		}
	}
	return latest?.balance ?? null;
}

/** Sync-owned rows carry this source flag from the backend. */
export const SYNC_SOURCE = "simplefin";

/** Sync pending-posting id prefix from the backend namespace. */
export const SYNC_PENDING_PREFIX = "sfin-pending-";

/** Classify a sync pending posting into a card slot; null stays unclassified. */
export function classifySyncAccount(
	accountId: string,
	label: string | null,
): "prime" | "ultimate" | "wife" | null {
	const haystack = `${accountId} ${label ?? ""}`.toLowerCase();
	if (haystack.includes("prime")) return "prime";
	if (haystack.includes("ultimate")) return "ultimate";
	if (haystack.includes("wife")) return "wife";
	return null;
}

export interface SyncExposureSeed {
	prime: number;
	ultimate: number;
	wife: number;
	unclassified: Array<{ accountId: string; label: string; amount: number }>;
}

/** Sum projection-disabled sync pending postings per card slot. */
export function seedExposureFromSync(
	document: FinancialModelDocument,
): SyncExposureSeed {
	const seed: SyncExposureSeed = {
		prime: 0,
		ultimate: 0,
		wife: 0,
		unclassified: [],
	};
	const labelByAccountId = new Map(
		document.accounts.map((account) => [account.id, account.label]),
	);
	for (const posting of document.postings) {
		if (
			posting.source !== SYNC_SOURCE ||
			posting.enabled ||
			!posting.id.startsWith(SYNC_PENDING_PREFIX)
		)
			continue;
		const expression = getExpression(posting);
		if (expression === null || !isNumericArithmetic(expression)) continue;
		const amount = Math.abs(parseNumericArithmetic(expression));
		if (!Number.isFinite(amount) || amount === 0) continue;
		const accountId = posting.sourceAccountId ?? "";
		const slot = classifySyncAccount(
			accountId,
			labelByAccountId.get(accountId) ?? null,
		);
		if (slot === null) {
			seed.unclassified.push({
				accountId,
				label: labelByAccountId.get(accountId) ?? accountId,
				amount,
			});
			continue;
		}
		seed[slot] += amount;
	}
	return seed;
}

export interface SyncBalanceInfo {
	date: string;
	syncedAccounts: number;
	ageDays: number;
}

/** Latest sync-owned checkpoint for the staleness badge; null when never synced. */
export function latestSyncBalance(
	document: FinancialModelDocument,
	today: string = new Date().toISOString().slice(0, 10),
): SyncBalanceInfo | null {
	let latest: string | null = null;
	const accounts = new Set<string>();
	for (const checkpoint of document.checkpoints) {
		if (checkpoint.source !== SYNC_SOURCE) continue;
		accounts.add(checkpoint.AccountId);
		if (latest === null || checkpoint.Date > latest) latest = checkpoint.Date;
	}
	if (latest === null) return null;
	const ageDays = Math.max(
		0,
		Math.round((Date.parse(today) - Date.parse(latest)) / 86_400_000),
	);
	return {
		date: latest,
		syncedAccounts: accounts.size,
		ageDays: Number.isFinite(ageDays) ? ageDays : 0,
	};
}
