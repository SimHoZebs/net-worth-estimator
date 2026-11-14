import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table.tsx";
import type {
	FinancialIndependenceAnalysis,
	IndependenceCandidate,
} from "@/domain/financialIndependence.ts";
import { dateLabel, exactMoney, money, percent } from "@/domain/format.ts";
import { useRouter } from "@tanstack/react-router";
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
	const router = useRouter();
	const openAccount = (accountId: string) => {
		void router.navigate({
			to: "/accounts/$accountId",
			params: { accountId },
		});
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
				<h3 className="m-0 text-xs font-semibold text-foreground">
					Funding sources · {dateLabel(candidate.date)}
				</h3>
				<Table
					containerProps={{
						role: "region",
						"aria-label": "Selected financial independence funding sources",
					}}
				>
					<TableCaption className="sr-only">
						Selected financial independence funding sources
					</TableCaption>
					<TableHeader>
						<TableRow>
							{["Source", "Balance", "Withdrawal rate", "Available / year"].map(
								(column, index) => (
									<TableHead
										key={column}
										scope="col"
										className={index ? "text-right" : undefined}
									>
										{column}
									</TableHead>
								),
							)}
						</TableRow>
					</TableHeader>
					<TableBody>
						<TableRow>
							<TableHead scope="row">Selected income</TableHead>
							<TableCell className="text-right">—</TableCell>
							<TableCell className="text-right">—</TableCell>
							<TableCell className="text-right">
								{amount(candidate.annualIncome)}
							</TableCell>
						</TableRow>
						{candidate.assets.map((asset) => (
							<TableRow key={asset.accountId}>
								<TableHead scope="row">
									<button
										type="button"
										className="cursor-pointer border-0 bg-transparent p-0 text-left text-success-text underline underline-offset-4"
										onClick={() => openAccount(asset.accountId)}
									>
										{analysis.accountNames[asset.accountId] ?? asset.accountId}
									</button>
								</TableHead>
								<TableCell className="text-right">
									{money(asset.balance)}
								</TableCell>
								<TableCell className="text-right">
									{percent(asset.rate)}
								</TableCell>
								<TableCell className="text-right">
									{money(asset.capacity)}
								</TableCell>
							</TableRow>
						))}
						{!candidate.assets.length && (
							<TableRow>
								<TableHead scope="row">Asset withdrawals</TableHead>
								<TableCell className="text-right">—</TableCell>
								<TableCell className="text-right">—</TableCell>
								<TableCell className="text-right">
									{amount(candidate.annualWithdrawals)}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
				{!!analysis.incomeNames.length && (
					<p className="m-0 text-xs text-muted-foreground">
						Income sources: {analysis.incomeNames.join(", ")}
					</p>
				)}
				<p className="m-0 text-xs text-muted-foreground">
					{analysis.expenseBasis === "projection-start-purchasing-power"
						? "Spending grows from projection-start purchasing power."
						: "Spending is stated in independence start-date dollars."}
				</p>
			</section>
			{firstShortfallDate && (
				<section className="grid gap-3" aria-label="First spending shortfall">
					<h3 className="m-0 text-xs font-semibold text-foreground">
						First spending shortfall · {dateLabel(firstShortfallDate, true)}
					</h3>
					{failure ? (
						<>
							<Table
								containerProps={{
									role: "region",
									"aria-label": "First spending shortfall amounts",
								}}
							>
								<TableCaption className="sr-only">
									First spending shortfall amounts
								</TableCaption>
								<TableHeader>
									<TableRow>
										{["Required withdrawal", "Withdrawn", "Unfunded"].map(
											(column) => (
												<TableHead
													key={column}
													scope="col"
													className="text-right"
												>
													{column}
												</TableHead>
											),
										)}
									</TableRow>
								</TableHeader>
								<TableBody>
									<TableRow>
										<TableCell className="text-right">
											{exactAmount(failure.requested)}
										</TableCell>
										<TableCell className="text-right">
											{exactAmount(failure.realized)}
										</TableCell>
										<TableCell className="text-right">
											{exactAmount(failure.shortfall)}
										</TableCell>
									</TableRow>
								</TableBody>
							</Table>
							{!!failure.constraints.length && (
								<p className="m-0 text-xs text-muted-foreground">
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
						<p className="m-0 text-xs text-muted-foreground">
							Detailed withdrawal amounts are unavailable.
						</p>
					)}
				</section>
			)}
			{outcome?.attempted &&
				assetValues.some(([, value]) => value !== null) && (
					<section className="grid gap-3">
						<h3 className="m-0 text-xs font-semibold text-foreground">
							Assets after the projected independence start
						</h3>
						<Table
							containerProps={{
								role: "region",
								"aria-label": "Projected asset values",
							}}
						>
							<TableCaption className="sr-only">
								Projected asset values
							</TableCaption>
							<TableHeader>
								<TableRow>
									<TableHead scope="col">Measure</TableHead>
									<TableHead scope="col" className="text-right">
										Amount
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{assetValues.map(([label, value]) => (
									<TableRow key={label}>
										<TableHead scope="row">{label}</TableHead>
										<TableCell className="text-right">
											{amount(value)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
						<p className="m-0 text-xs text-muted-foreground">
							Start-date dollars adjust the ending value for configured spending
							growth.
						</p>
						<IndependenceBranchChart candidate={candidate} />
					</section>
				)}
			{!!analysis.continuingNames.length && (
				<p className="m-0 text-xs text-muted-foreground">
					Continuing transactions: {analysis.continuingNames.join(", ")}
				</p>
			)}
		</div>
	);
}
