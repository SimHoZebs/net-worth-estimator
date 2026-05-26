import { memo } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	estimateMonthlyPayment,
	findPaymentPosting,
	isDebtAccount,
} from "@/lib/debt-utils";
import { currency, formatDate } from "@/lib/format";
import type { ProjectionResult, ScenarioPack } from "@/lib/projection";

interface DebtSummaryProps {
	pack: ScenarioPack;
	result: ProjectionResult;
}

export const DebtSummary = memo(function DebtSummary({
	pack,
	result,
}: DebtSummaryProps) {
	// Get latest checkpoint per account
	const latestCheckpointByAccount = new Map<string, number>();
	for (const summary of result.accountSummaries) {
		latestCheckpointByAccount.set(summary.accountId, summary.startingBalance);
	}

	const debtAccounts = pack.accounts
		.filter((a) => a.enabled && (latestCheckpointByAccount.get(a.id) ?? 0) < 0)
		.map((a) => ({
			account: a,
			balance: latestCheckpointByAccount.get(a.id) ?? 0,
			paymentPosting: findPaymentPosting(pack, a.id),
		}));

	// Also include accounts whose label suggests debt even if balance is 0
	const debtByLabel = pack.accounts
		.filter(
			(a) =>
				a.enabled &&
				isDebtAccount(a.label) &&
				!debtAccounts.some((d) => d.account.id === a.id),
		)
		.map((a) => ({
			account: a,
			balance: latestCheckpointByAccount.get(a.id) ?? 0,
			paymentPosting: findPaymentPosting(pack, a.id),
		}));

	const allDebts = [...debtAccounts, ...debtByLabel];

	if (allDebts.length === 0) {
		return (
			<Card className="rounded-[1.6rem] border-border shadow-sm ">
				<CardContent className="p-5">
					<div className="type-muted">
						No debt accounts are currently tracked.
					</div>
				</CardContent>
			</Card>
		);
	}

	const totalDebt = allDebts.reduce((sum, d) => sum + Math.abs(d.balance), 0);

	const estimatedTotalInterest = allDebts.reduce((sum, d) => {
		const monthlyPmt = estimateMonthlyPayment(d.paymentPosting ?? undefined);
		if (monthlyPmt <= 0) return sum;
		const principal = Math.abs(d.balance);
		const totalAnnualPmt = monthlyPmt * 12;
		if (totalAnnualPmt <= 0) return sum;
		const approxYearsToPay = Math.min(principal / totalAnnualPmt, 30);
		const totalPayments = totalAnnualPmt * approxYearsToPay;
		return sum + Math.max(0, totalPayments - principal);
	}, 0);

	return (
		<Card className="rounded-[1.6rem] border-border shadow-sm ">
			<CardHeader>
				<div>
					<CardTitle>Debt summary</CardTitle>
					<CardDescription>
						Current debt balances, scheduled payments, and estimated interest.
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Debt</TableHead>
							<TableHead className="text-right">Balance</TableHead>
							<TableHead className="text-right">Payment</TableHead>
							<TableHead>Frequency</TableHead>
							<TableHead>Est. payoff</TableHead>
							<TableHead className="text-right">Priority</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{allDebts.map((d) => {
							const monthlyPmt = estimateMonthlyPayment(
								d.paymentPosting ?? undefined,
							);
							const principal = Math.abs(d.balance);
							const monthsToPayoff =
								monthlyPmt > 0 ? Math.ceil(principal / monthlyPmt) : Infinity;
							const payoffDate =
								monthsToPayoff < 1200
									? new Date(
											Date.now() + monthsToPayoff * 30 * 24 * 60 * 60 * 1000,
										)
											.toISOString()
											.slice(0, 10)
									: null;
							return (
								<TableRow key={d.account.id}>
									<TableCell className="type-body text-foreground/80">
										{d.account.label}
									</TableCell>
									<TableCell className="text-right type-value text-sm">
										{currency.format(d.balance)}
									</TableCell>
									<TableCell className="text-right type-body text-foreground/80">
										{d.paymentPosting ? d.paymentPosting.arithmetic : "—"}
									</TableCell>
									<TableCell className="type-muted">
										{d.paymentPosting ? d.paymentPosting.frequency : "—"}
									</TableCell>
									<TableCell className="type-muted">
										{payoffDate ? formatDate(payoffDate) : "Beyond 100 yr"}
									</TableCell>
									<TableCell className="text-right type-body tabular-nums text-muted-foreground">
										{d.paymentPosting?.priority ?? "—"}
									</TableCell>
								</TableRow>
							);
						})}
						<TableRow className="border-t-2 border-border">
							<TableCell className="type-title">Total debt</TableCell>
							<TableCell className="text-right type-title">
								{currency.format(-totalDebt)}
							</TableCell>
							<TableCell colSpan={4} />
						</TableRow>
					</TableBody>
				</Table>
				{estimatedTotalInterest > 0 ? (
					<div className="mt-3 rounded-xl border border-tertiary-border bg-tertiary-subtle px-4 py-3">
						<div className="type-caption type-value text-tertiary-foreground">
							Estimated interest over loan life
						</div>
						<div className="mt-0.5 type-title text-lg text-tertiary-foreground">
							{currency.format(estimatedTotalInterest)}
						</div>
						<div className="type-caption text-tertiary-foreground/80">
							Rough estimate based on current balance and payment schedule.
						</div>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
});
