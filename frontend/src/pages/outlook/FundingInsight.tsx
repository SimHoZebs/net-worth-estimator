import { ArrowUpRight, ShieldCheck, TriangleAlert } from "lucide-react";
import { AccountEntry } from "../../components/AccountEntry.tsx";
import { Progress, Skeleton } from "../../components/ui.tsx";
import { externalCounterpartyName } from "../../domain/accountActivity.ts";
import { dateLabel, money } from "../../domain/format.ts";
import type { Plan } from "../../domain/model.ts";
import type { MovementResult } from "../../domain/result.ts";

export function FundingInsight({
	failure,
	plan,
	onFailure,
	onPlan,
	pending = false,
}: {
	failure: MovementResult | null;
	plan: Plan | null;
	onFailure: () => void;
	onPlan: () => void;
	pending?: boolean;
}) {
	// A null failure with settled data is genuinely good news; a null failure
	// with pending data is unknowable, so the card stays neutral instead of
	// claiming either branch.
	if (pending)
		return (
			<article className="insight-card" aria-busy="true">
				<div className="eyebrow">
					<Skeleton width={150} height={14} />
				</div>
				<Skeleton width={110} height={30} />
				<Skeleton width={"100%"} height={44} />
			</article>
		);
	const action = failure ? onFailure : onPlan;
	if (!failure)
		return (
			<article className="insight-card insight-positive">
				<div className="eyebrow">
					<span className="insight-symbol">
						<ShieldCheck size={16} />
					</span>
				</div>
				<p>
					No underfunded transactions appear within the selected horizon.
					Investment returns remain uncertain.
				</p>
				<button
					type="button"
					className="text-button insight-stretched"
					onClick={action}
				>
					Review planned transactions <ArrowUpRight size={14} />
				</button>
			</article>
		);
	const source =
		plan?.accounts.find((account) => account.id === failure.fromId) ?? null;
	const destination =
		plan?.accounts.find((account) => account.id === failure.toId) ?? null;
	const sourceName = source?.name ?? externalCounterpartyName("in");
	const destinationName = destination?.name ?? externalCounterpartyName("out");
	return (
		<article className="insight-card">
			<div className="eyebrow">
				<span className="insight-symbol">
					<TriangleAlert size={16} />
				</span>
				<span>First shortfall in the base case</span>
			</div>
			<h2>{money(failure.requested - failure.realized)} short</h2>
			<p>
				<strong>{failure.name}</strong> in {dateLabel(failure.date)}
			</p>
			<ul
				className="account-entries"
				aria-label={`Shortfall flow from ${sourceName} to ${destinationName}`}
			>
				<AccountEntry
					account={source}
					name={sourceName}
					caption="From · Available"
					value={money(failure.realized)}
					external="in"
				/>
				<AccountEntry
					account={destination}
					name={destinationName}
					caption="To · Planned"
					value={money(failure.requested)}
					external="out"
				/>
			</ul>
			<Progress
				value={(failure.realized / failure.requested) * 100}
				label="Funded portion of first shortfall"
				tone="amber"
			/>
			<button
				type="button"
				className="text-button insight-stretched"
				onClick={action}
			>
				Inspect this expense <ArrowUpRight size={14} />
			</button>
		</article>
	);
}
