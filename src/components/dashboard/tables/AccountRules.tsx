import { formatFrequency, formatRoute, pct } from "@/lib/format";
import type { Account, Posting } from "@/lib/projection";
import { PostingAmount } from "./PostingAmount";

interface AccountRulesProps {
	rules: Posting[];
	accountById: ReadonlyMap<string, Account>;
	showAdvanced: boolean;
}

export function AccountRules({
	rules,
	accountById,
	showAdvanced,
}: AccountRulesProps) {
	return (
		<div className="space-y-3">
			{rules.map((rule, index) => {
				const details = ruleDetails(rule, accountById);
				return (
					<article
						key={`${rule.id}-${index}`}
						className="min-w-0 rounded-xl border border-border/70 bg-card/75 p-3"
					>
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div className="min-w-0">
								<div className="type-value break-words [overflow-wrap:anywhere]">
									{rule.label}
								</div>
								{showAdvanced ? (
									<div className="type-code break-all">{rule.id}</div>
								) : null}
							</div>
							<div className="min-w-0 max-w-full type-value [&_.type-code]:break-all [&_.type-code]:whitespace-normal">
								<PostingAmount arithmetic={rule.arithmetic} />
							</div>
						</div>
						<div className="mt-3 grid min-w-0 gap-3 type-caption lg:grid-cols-3">
							<RuleDetail label="Route" value={details.route} />
							<RuleDetail label="Schedule" value={details.schedule} />
							<RuleDetail label="Assumptions" value={details.assumptions} />
						</div>
					</article>
				);
			})}
		</div>
	);
}

function RuleDetail({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0">
			<div className="type-label">{label}</div>
			<div className="break-words">{value}</div>
		</div>
	);
}

function ruleDetails(rule: Posting, accountById: ReadonlyMap<string, Account>) {
	const sourceLabel = rule.sourceAccountId
		? (accountById.get(rule.sourceAccountId)?.label ?? rule.sourceAccountId)
		: null;
	const destinations =
		rule.destinations?.map((id) => ({
			label: accountById.get(id)?.label ?? id,
		})) ?? null;
	const assumptions =
		[
			rule.annualRate ? `${pct.format(rule.annualRate)} rate` : null,
			rule.annualGrowthRate
				? `${pct.format(rule.annualGrowthRate)} growth`
				: null,
			rule.volatility ? `${pct.format(rule.volatility)} volatility` : null,
		]
			.filter(Boolean)
			.join(" · ") || "None";
	return {
		route: formatRoute(sourceLabel, destinations),
		schedule: `${formatFrequency(rule.frequency)} from ${rule.startDate}${rule.endDate ? ` through ${rule.endDate}` : ""}`,
		assumptions,
	};
}
