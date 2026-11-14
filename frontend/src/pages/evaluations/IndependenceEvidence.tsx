import type { ReactNode } from "react";
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

function EvidenceTable({
	caption,
	columns,
	children,
}: {
	caption: string;
	columns: string[];
	children: ReactNode;
}) {
	return (
		<div
			// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- A scroll region must accept focus so keyboard users can pan the table.
			tabIndex={0}
			role="region"
			aria-label={caption}
			className="relative max-w-full overflow-x-auto"
		>
			<Table className="w-full border-collapse text-left text-sm">
				<TableCaption className="sr-only">{caption}</TableCaption>
				<TableHeader className="border-b border-line bg-surface-2 text-muted">
					<TableRow className="border-b border-line last:border-b-0 hover:bg-transparent">
						{columns.map((column) => (
							<TableHead
								key={column}
								scope="col"
								className="h-auto border-0 px-5 py-4 font-medium whitespace-nowrap text-xs text-muted"
							>
								{column}
							</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>{children}</TableBody>
			</Table>
		</div>
	);
}

function EvidenceRow({ children }: { children: ReactNode }) {
	return (
		<TableRow className="border-b border-line last:border-b-0 hover:bg-transparent">
			{children}
		</TableRow>
	);
}

function EvidenceRowHeader({ children }: { children: ReactNode }) {
	return (
		<TableHead
			scope="row"
			className="h-auto border-0 px-5 py-4 font-medium whitespace-nowrap text-sm text-inherit"
		>
			{children}
		</TableHead>
	);
}

function EvidenceCell({ children }: { children: ReactNode }) {
	return (
		<TableCell className="border-0 px-5 py-4 whitespace-nowrap">
			{children}
		</TableCell>
	);
}

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
				<h3 className="m-0 text-xs font-semibold text-ink">
					Funding sources · {dateLabel(candidate.date)}
				</h3>
				<EvidenceTable
					caption="Selected financial independence funding sources"
					columns={["Source", "Balance", "Withdrawal rate", "Available / year"]}
				>
					<EvidenceRow>
						<EvidenceRowHeader>Selected income</EvidenceRowHeader>
						<EvidenceCell>—</EvidenceCell>
						<EvidenceCell>—</EvidenceCell>
						<EvidenceCell>{amount(candidate.annualIncome)}</EvidenceCell>
					</EvidenceRow>
					{candidate.assets.map((asset) => (
						<EvidenceRow key={asset.accountId}>
							<EvidenceRowHeader>
								<button
									type="button"
									className="cursor-pointer border-0 bg-transparent p-0 text-left text-success-text underline underline-offset-4"
									onClick={() => openAccount(asset.accountId)}
								>
									{analysis.accountNames[asset.accountId] ?? asset.accountId}
								</button>
							</EvidenceRowHeader>
							<EvidenceCell>{money(asset.balance)}</EvidenceCell>
							<EvidenceCell>{percent(asset.rate)}</EvidenceCell>
							<EvidenceCell>{money(asset.capacity)}</EvidenceCell>
						</EvidenceRow>
					))}
					{!candidate.assets.length && (
						<EvidenceRow>
							<EvidenceRowHeader>Asset withdrawals</EvidenceRowHeader>
							<EvidenceCell>—</EvidenceCell>
							<EvidenceCell>—</EvidenceCell>
							<EvidenceCell>{amount(candidate.annualWithdrawals)}</EvidenceCell>
						</EvidenceRow>
					)}
				</EvidenceTable>
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
							<EvidenceTable
								caption="First spending shortfall amounts"
								columns={["Required withdrawal", "Withdrawn", "Unfunded"]}
							>
								<EvidenceRow>
									<EvidenceCell>{exactAmount(failure.requested)}</EvidenceCell>
									<EvidenceCell>{exactAmount(failure.realized)}</EvidenceCell>
									<EvidenceCell>{exactAmount(failure.shortfall)}</EvidenceCell>
								</EvidenceRow>
							</EvidenceTable>
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
						<EvidenceTable
							caption="Projected asset values"
							columns={["Measure", "Amount"]}
						>
							{assetValues.map(([label, value]) => (
								<EvidenceRow key={label}>
									<EvidenceRowHeader>{label}</EvidenceRowHeader>
									<EvidenceCell>{amount(value)}</EvidenceCell>
								</EvidenceRow>
							))}
						</EvidenceTable>
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
