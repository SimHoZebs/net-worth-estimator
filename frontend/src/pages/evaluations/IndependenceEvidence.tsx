import {
	DataTable,
	TableCell,
	TableHeader,
	TableRow,
} from "@/components/DataTable.tsx";
import type {
	FinancialIndependenceAnalysis,
	IndependenceCandidate,
} from "@/domain/financialIndependence.ts";
import { dateLabel, exactMoney, money, percent } from "@/domain/format.ts";
import { evidenceHash } from "@/workspace/route.ts";
import { useWorkspaceNavigation } from "@/workspace/useWorkspaceNavigation.ts";
import { IndependenceBranchChart } from "./IndependenceBranchChart.tsx";

const amount = (value: number | null) => (value === null ? "—" : money(value));
const exactAmount = (value: number | null) =>
	value === null ? "—" : exactMoney(value);
const constraints: Record<string, string> = {
	"source-floor": "Protected account balance",
	"source-unavailable": "Funding account unavailable",
	"action-limit": "Annual withdrawal limit",
	"destination-ceiling": "Account ceiling",
};

/** Financial amounts and cash-flow evidence, without the engine's screening gates. */
export function IndependenceEvidence({
	candidate,
	analysis,
}: {
	candidate: IndependenceCandidate;
	analysis: FinancialIndependenceAnalysis;
}) {
	const { pushHash } = useWorkspaceNavigation();
	const openAccount = (accountId: string) => {
		pushHash(
			evidenceHash("accounts", { kind: "account", id: accountId }, null),
		);
	};
	const outcome = candidate.outcome;
	const failure = outcome?.attempted ? outcome.firstShortfall : null;
	const firstShortfallDate = outcome?.attempted
		? outcome.firstShortfallDate
		: null;
	const assetValues = [
		["Value at start", outcome?.startingBalance ?? null],
		["Value at end", outcome?.endingBalance ?? null],
		["End value in start-date dollars", outcome?.endingRealBalance ?? null],
	] as const;
	return (
		<div className="grid gap-6">
			<section className="grid gap-3" aria-label="Funding sources">
				<h3 className="m-0 text-xs font-semibold text-ink">
					Funding sources · {dateLabel(candidate.date)}
				</h3>
				<DataTable
					caption="Selected financial independence funding sources"
					showHeaders
					columns={[
						{ label: "Source" },
						{ label: "Balance" },
						{ label: "Withdrawal rate" },
						{ label: "Available / year" },
					]}
				>
					<TableRow>
						<TableHeader scope="row">Selected income</TableHeader>
						<TableCell>—</TableCell>
						<TableCell>—</TableCell>
						<TableCell>{amount(candidate.annualIncome)}</TableCell>
					</TableRow>
					{candidate.assets.map((asset) => (
						<TableRow key={asset.accountId}>
							<TableHeader scope="row">
								<button
									type="button"
									className="cursor-pointer border-0 bg-transparent p-0 text-left text-success-text underline underline-offset-4"
									onClick={() => openAccount(asset.accountId)}
								>
									{analysis.accountNames[asset.accountId] ?? asset.accountId}
								</button>
							</TableHeader>
							<TableCell>{money(asset.balance)}</TableCell>
							<TableCell>{percent(asset.rate)}</TableCell>
							<TableCell>{money(asset.capacity)}</TableCell>
						</TableRow>
					))}
					{!candidate.assets.length && (
						<TableRow>
							<TableHeader scope="row">Asset withdrawals</TableHeader>
							<TableCell>—</TableCell>
							<TableCell>—</TableCell>
							<TableCell>{amount(candidate.annualWithdrawals)}</TableCell>
						</TableRow>
					)}
				</DataTable>
				{!!analysis.incomeNames.length && (
					<p className="m-0 text-xs text-muted">
						Income sources: {analysis.incomeNames.join(", ")}
					</p>
				)}
				<p className="m-0 text-xs text-muted">
					{analysis.expenseBasis === "projection-start-purchasing-power"
						? "Spending grows from projection-start purchasing power."
						: "Spending is stated in independence start-date dollars."}
				</p>
			</section>
			{firstShortfallDate && (
				<section className="grid gap-3" aria-label="First spending shortfall">
					<h3 className="m-0 text-xs font-semibold text-ink">
						First spending shortfall · {dateLabel(firstShortfallDate, true)}
					</h3>
					{failure ? (
						<>
							<DataTable
								caption="First spending shortfall amounts"
								showHeaders
								columns={[
									{ label: "Required withdrawal" },
									{ label: "Withdrawn" },
									{ label: "Unfunded" },
								]}
							>
								<TableRow>
									<TableCell>{exactAmount(failure.requested)}</TableCell>
									<TableCell>{exactAmount(failure.realized)}</TableCell>
									<TableCell>{exactAmount(failure.shortfall)}</TableCell>
								</TableRow>
							</DataTable>
							{!!failure.constraints.length && (
								<p className="m-0 text-xs text-muted">
									{failure.constraints
										.map(
											(type) => constraints[type] ?? type.replaceAll("-", " "),
										)
										.join(" · ")}
								</p>
							)}
							{!!failure.accountIds.length && (
								<div className="flex flex-wrap gap-2">
									{failure.accountIds.map((id) => (
										<button
											key={id}
											type="button"
											className="cursor-pointer border-0 bg-transparent p-0 text-left text-xs text-success-text underline underline-offset-4"
											onClick={() => openAccount(id)}
										>
											{analysis.accountNames[id] ?? id}
										</button>
									))}
								</div>
							)}
						</>
					) : (
						<p className="m-0 text-xs text-muted">
							Detailed withdrawal amounts are unavailable.
						</p>
					)}
				</section>
			)}
			{outcome?.attempted &&
				assetValues.some(([, value]) => value !== null) && (
					<section className="grid gap-3">
						<h3 className="m-0 text-xs font-semibold text-ink">
							Assets after the projected independence start
						</h3>
						<DataTable
							caption="Projected asset values"
							showHeaders
							columns={[{ label: "Measure" }, { label: "Amount" }]}
						>
							{assetValues.map(([label, value]) => (
								<TableRow key={label}>
									<TableHeader scope="row">{label}</TableHeader>
									<TableCell>{amount(value)}</TableCell>
								</TableRow>
							))}
						</DataTable>
						<p className="m-0 text-xs text-muted">
							Start-date dollars adjust the ending value for configured spending
							growth.
						</p>
						<IndependenceBranchChart candidate={candidate} />
					</section>
				)}
			{!!analysis.continuingNames.length && (
				<p className="m-0 text-xs text-muted">
					Continuing transactions: {analysis.continuingNames.join(", ")}
				</p>
			)}
		</div>
	);
}
