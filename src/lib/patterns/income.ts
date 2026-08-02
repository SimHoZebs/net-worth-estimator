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
		incomeSourceId,
		taxProfileId,
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
	if (!incomeSourceId.trim()) errors.push("Income source is required.");
	if (!taxProfileId.trim()) errors.push("Tax profile is required.");
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

	const incomeResolvers = [];
	if (k401ContributionRate > 0) {
		incomeResolvers.push({
			resolver: "percentage",
			config: {
				rate: k401ContributionRate,
				annualCap: k401AnnualCap > 0 ? k401AnnualCap : null,
			},
			destinationAccountId: "k401",
			...(k401EmployerMatchRate > 0
				? { employerMatchRate: k401EmployerMatchRate }
				: {}),
		});
	}
	incomeResolvers.push({
		resolver: "progressive-bracket",
		config: { profileId: taxProfileId },
		destinationAccountId: null,
	});

	postings.push({
		...makePosting(salaryId, label, null, ["checking"], "0", 1, startDate),
		amount: {
			resolver: "income",
			config: { incomeSourceId, resolvers: incomeResolvers },
			inputs: {},
		},
	});

	if (autoInvestRate > 0) {
		postings.push(
			makePosting(
				brokerageAutoId,
				`${label} Brokerage Auto`,
				"checking",
				["brokerage"],
				`${salaryId} * ${autoInvestRate}`,
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
