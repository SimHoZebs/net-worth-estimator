import { CalendarDays, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
	Card,
	CardAction,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card.tsx";
import { useSavedAccounts, useSavedSchedules } from "@/state/savedState.ts";
import { scheduleToDisplay } from "@/domain/transactionRows.ts";
import { SafeSpendingConfigurePanel } from "./SafeSpendingConfigurePanel.tsx";
import { SafeSpendingDetailShell } from "./SafeSpendingDetailShell.tsx";
import {
	allowanceCaption,
	isSafeSpendingLedgerTab,
	type SafeSpendingDetailTab,
} from "./safeSpendingDetailModel.ts";
import { useSafeSpendingSettings } from "@/state/useSafeSpendingSettings.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";
import { useSafeSpendingSummary } from "@/state/useSafeSpendingSummary.ts";
import { SafeSpendingCashEvidence } from "./SafeSpendingCashEvidence.tsx";
import { SafeSpendingObligationLedger } from "./SafeSpendingObligationLedger.tsx";
import { SafeSpendingBudget } from "./SafeSpendingBudget.tsx";
import { buildAllowanceLedger } from "./allowanceLedger.ts";
import { capacityText, paymentCapacity } from "./paymentCapacity.ts";
import { amountText } from "./amountText.ts";
import { useSafeSpendingSelections } from "./useSafeSpendingSelections.ts";

function SafeSpendingCardHeader({ action }: { action?: React.ReactNode }) {
	return (
		<CardHeader>
			<CardTitle>
				<h2 className="flex min-h-8 items-center gap-2 [overflow-wrap:anywhere]">
					<CalendarDays
						size={16}
						className="shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
					{labels.title}
				</h2>
			</CardTitle>
			{action}
		</CardHeader>
	);
}

export function SafeSpendingPreview({
	detail,
	onDetail,
	onTabChange,
}: {
	detail: SafeSpendingDetailTab | null;
	onDetail: (tab: SafeSpendingDetailTab | null) => void;
	onTabChange: (tab: SafeSpendingDetailTab) => void;
}) {
	const accounts = useSavedAccounts();
	const savedRules = useSavedSchedules();
	const settingsState = useSafeSpendingSettings();
	const { updateSettings, ...settings } = settingsState;
	const summary = useSafeSpendingSummary();

	const rules = useMemo(
		() => (savedRules ?? []).map(scheduleToDisplay),
		[savedRules],
	);
	const selections = useSafeSpendingSelections({
		accounts: accounts ?? [],
		rules,
		savedRules: savedRules ?? [],
		settings,
		displayToday: summary.data?.cashAsOf ?? "",
		updateSettings,
	});
	const ledger = useMemo(
		() => (summary.data ? buildAllowanceLedger(summary.data) : undefined),
		[summary.data],
	);
	const capacity = useMemo(
		() => (summary.data ? paymentCapacity(summary.data) : null),
		[summary.data],
	);
	const caption = ledger
		? allowanceCaption({
				payday: ledger.allowance.payday,
				cashAsOf: ledger.allowance.cashAsOf,
			})
		: undefined;

	if (settingsState.error)
		return (
			<Alert variant="destructive" aria-label="Safe spending settings">
				<AlertDescription>
					Budget settings could not be loaded.
				</AlertDescription>
				<Button variant="link" onClick={settingsState.retry}>
					Retry
				</Button>
			</Alert>
		);

	return (
		<>
			<Card role="region" aria-label={labels.title}>
				<SafeSpendingCardHeader
					action={
						<CardAction>
							<Button
								variant="link"
								disabled={settingsState.pending}
								onClick={() => onDetail("configure")}
							>
								Configure
							</Button>
						</CardAction>
					}
				/>
				<CardContent className="grid content-start gap-4">
					{summary.isError && !ledger ? (
						<Alert variant="destructive" aria-label="Safe spending evidence">
							<AlertDescription>
								Safe spending evidence could not be loaded.
							</AlertDescription>
							<Button variant="link" onClick={() => void summary.refetch()}>
								Retry evidence
							</Button>
						</Alert>
					) : !ledger ||
					  !summary.data ||
					  summary.isPending ||
					  settingsState.pending ? (
						<div aria-busy="true">
							<Skeleton className="h-32 w-full" />
						</div>
					) : (
						<>
							<SafeSpendingBudget
								summary={summary.data}
								savingsTarget={settings.savingsTarget}
							/>
							<Button
								variant="link"
								className="justify-start gap-1 p-0 text-sm"
								onClick={() => onDetail("ledger")}
							>
								{labels.protectedSummary} · {amountText(ledger.protectedTotal)}{" "}
								· {ledger.obligationCount}{" "}
								{ledger.obligationCount === 1 ? "item" : "items"}
								<ChevronRight size={14} aria-hidden="true" />
							</Button>
						</>
					)}
				</CardContent>
			</Card>
			{detail && (
				<SafeSpendingDetailShell
					tab={detail}
					onTabChange={onTabChange}
					counts={{ ledger: ledger?.obligationCount }}
					caption={caption}
					onClose={() => onDetail(null)}
				>
					{isSafeSpendingLedgerTab(detail) && ledger && summary.data && (
						<div className="grid content-start gap-5">
							<section
								className="grid content-start gap-2"
								aria-label="Cash checks"
							>
								<h3 className="m-0 text-sm font-semibold">
									{labels.cashChecks}
								</h3>
								<dl className="m-0 grid gap-2 text-sm">
									<div className="flex justify-between gap-3">
										<dt className="text-muted-foreground">
											{labels.beforePayday}
										</dt>
										<dd className="m-0 tabular-nums">
											{amountText(ledger.allowance.prePaydayRoom)}
										</dd>
									</div>
									<div className="flex justify-between gap-3">
										<dt className="text-muted-foreground">
											{labels.afterPaydayPay}
										</dt>
										<dd className="m-0 tabular-nums">
											{amountText(ledger.allowance.postIncomeRoom)}
										</dd>
									</div>
									<div className="flex justify-between gap-3">
										<dt className="text-muted-foreground">
											{capacity ? "Payment capacity" : labels.paymentCovered}
										</dt>
										<dd className="m-0 tabular-nums">
											{capacity
												? capacityText(capacity)
												: amountText(ledger.allowance.paymentRoom)}
										</dd>
									</div>
									<div className="flex justify-between gap-3">
										<dt className="text-muted-foreground">
											{labels.immediateCashCheck}
										</dt>
										<dd className="m-0 tabular-nums">
											<span data-testid="safe-to-spend">
												{amountText(summary.data?.safeToSpend)}
											</span>
										</dd>
									</div>
									<div className="flex justify-between gap-3">
										<dt className="text-muted-foreground">
											{labels.expectedPay}
										</dt>
										<dd className="m-0 tabular-nums">
											{amountText(ledger.allowance.expectedPay)}
										</dd>
									</div>
									<div className="flex justify-between gap-3">
										<dt className="text-muted-foreground">{labels.reserve}</dt>
										<dd className="m-0 tabular-nums">
											{amountText(ledger.allowance.reserve)}
										</dd>
									</div>
								</dl>
							</section>
							<SafeSpendingCashEvidence
								evidence={ledger.evidence}
								pending={summary.isPending}
								error={summary.isError}
								onRetry={() => void summary.refetch()}
							/>
							<SafeSpendingObligationLedger sections={ledger.sections} />
						</div>
					)}
					{detail === "configure" && (
						<SafeSpendingConfigurePanel
							config={{
								reserve: settings.reserve,
								cycleStartDay: settings.cycleStartDay,
								paydayDay: settings.paydayDay,
								savingsTarget: settings.savingsTarget,
								cards: selections.candidateAccounts.map((account) => ({
									id: account.id,
									name: account.name,
								})),
								trackedIds: selections.trackedIds,
								spendingAccounts: selections.spendableAccounts.map(
									(account) => ({ id: account.id, name: account.name }),
								),
								trackedSpendingIds: selections.spendingIds,
							}}
							billCandidates={selections.billCandidates}
							trackedBillIds={selections.trackedBillIds}
							accounts={accounts ?? []}
							incomeCandidates={selections.incomeCandidates}
							incomeScheduleIds={settings.incomeScheduleIds}
							onToggleIncomeSource={selections.toggleIncomeSource}
							onToggleBill={selections.toggleBill}
							onToggleAccount={selections.toggleAccount}
							onToggleSpendingAccount={selections.toggleSpendingAccount}
							onUpdateConfig={updateSettings}
						/>
					)}
				</SafeSpendingDetailShell>
			)}
		</>
	);
}
