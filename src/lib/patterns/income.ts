import {
	type Account,
	createExpressionAmount,
	type Posting,
} from "@/lib/projection";
import { NO_CEILING, NO_FLOOR } from "@/lib/projection/constants";
import type { IncomeTemplateInput, TemplateGenerationResult } from "./types";

const DEFAULT_ACCOUNTS = {
	checking: { color: "#0f172a" },
	k401: { color: "#2563eb" },
	brokerage: { color: "#16a34a" },
};

function sanitizeStem(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_|_$/g, "")
		.replace(/_+/g, "_");
}

function makeAccount(id: string, label: string, color: string): Account {
	return {
		id,
		label,
		minBalance: NO_FLOOR,
		maxBalance: NO_CEILING,
		color,
		enabled: true,
	};
}

function makePosting(
	id: string,
	label: string,
	source: string | null,
	destinations: string[] | null,
	arithmetic: string,
	priority: number,
	startDate: string,
	annualCap: number | null = null,
): Posting {
	return {
		id,
		label,
		sourceAccountId: source,
		destinations,
		amount: createExpressionAmount(arithmetic),
		frequency: "monthly",
		annualRate: 0,
		annualGrowthRate: 0,
		volatility: 0,
		startDate,
		endDate: null,
		annualCap,
		priority,
		enabled: true,
	};
}

function uniqueId(desired: string, taken: Set<string>): string {
	if (!taken.has(desired)) return desired;
	let n = 2;
	while (taken.has(`${desired}_${n}`)) n++;
	return `${desired}_${n}`;
}

export function generateIncomePattern(
	input: IncomeTemplateInput,
	existingAccountIds: string[],
	existingPostingIds: string[],
): TemplateGenerationResult {
	const {
		label,
		grossMonthlyIncome,
		taxRate,
		k401ContributionRate,
		k401EmployerMatchRate,
		k401AnnualCap,
		autoInvestRate,
		startDate,
	} = input;

	const errors: string[] = [];
	if (!label.trim()) errors.push("Label is required.");
	if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate))
		errors.push("Start date must be YYYY-MM-DD.");
	if (grossMonthlyIncome <= 0)
		errors.push("Gross monthly income must be positive.");
	if (taxRate < 0 || taxRate > 1)
		errors.push("Tax rate must be between 0 and 1.");
	if (k401ContributionRate < 0 || k401ContributionRate > 1)
		errors.push("401(k) contribution rate must be between 0 and 1.");
	if (k401EmployerMatchRate < 0 || k401EmployerMatchRate > 1)
		errors.push("Employer match rate must be between 0 and 1.");
	if (autoInvestRate < 0 || autoInvestRate > 1)
		errors.push("Auto-invest rate must be between 0 and 1.");

	if (errors.length > 0) return { ok: false, error: errors.join(" ") };

	const existingAccountSet = new Set(existingAccountIds);
	const existingPostingSet = new Set(existingPostingIds);

	const stem = sanitizeStem(label);
	const salaryId = uniqueId(stem, existingPostingSet);
	existingPostingSet.add(salaryId);
	const k401EmpId = uniqueId(`${stem}_k401_emp`, existingPostingSet);
	existingPostingSet.add(k401EmpId);
	const taxId = uniqueId(`${stem}_tax`, existingPostingSet);
	existingPostingSet.add(taxId);
	const k401MatchId = uniqueId(`${stem}_k401_match`, existingPostingSet);
	existingPostingSet.add(k401MatchId);
	const brokerageAutoId = uniqueId(
		`${stem}_brokerage_auto`,
		existingPostingSet,
	);

	const accounts: Account[] = [];
	for (const [id, { color }] of Object.entries(DEFAULT_ACCOUNTS)) {
		if (!existingAccountSet.has(id)) {
			accounts.push(
				makeAccount(id, id.charAt(0).toUpperCase() + id.slice(1), color),
			);
		}
	}

	const postings: Posting[] = [];

	postings.push(
		makePosting(
			salaryId,
			label,
			null,
			["checking"],
			String(grossMonthlyIncome),
			1,
			startDate,
		),
	);

	if (k401ContributionRate > 0) {
		postings.push(
			makePosting(
				k401EmpId,
				`${label} 401(k) Employee`,
				"checking",
				["k401"],
				`${salaryId} * ${k401ContributionRate}`,
				2,
				startDate,
				k401AnnualCap > 0 ? k401AnnualCap : null,
			),
		);
	}

	postings.push(
		makePosting(
			taxId,
			`${label} Taxes`,
			"checking",
			null,
			`${salaryId} * ${taxRate}`,
			3,
			startDate,
		),
	);

	if (k401EmployerMatchRate > 0 && k401ContributionRate > 0) {
		postings.push(
			makePosting(
				k401MatchId,
				`${label} 401(k) Match`,
				null,
				["k401"],
				`${k401EmpId} * ${k401EmployerMatchRate}`,
				5,
				startDate,
			),
		);
	}

	if (autoInvestRate > 0) {
		postings.push(
			makePosting(
				brokerageAutoId,
				`${label} Brokerage Auto`,
				"checking",
				["brokerage"],
				`(${salaryId} - ${k401EmpId} - ${taxId}) * ${autoInvestRate}`,
				10,
				startDate,
			),
		);
	}

	return {
		ok: true,
		output: { accounts, postings },
	};
}
