import { ArrowDownLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Badge, EmptyState } from "../../components/ui.tsx";
import { TransactionItemRow } from "../../components/activity/TransactionItem.tsx";
import { MovementDetail } from "../../components/activity/TransactionDetail.tsx";
import { TransactionTable } from "../../components/activity/TransactionTable.tsx";
import {
	transactionAmountStyles,
	transactionBadgeStyles,
} from "../../components/activity/activityStyles.ts";
import { dateLabel, money } from "../../domain/format.ts";
import {
	isPendingMovement,
	type Account,
	type Movement,
	type Plan,
} from "../../domain/model.ts";
import type { ResolvedMovementAmount } from "../../domain/resolvedMovementAmounts.ts";

export function MovementsPanel({
	movements,
	accounts,
	plan,
	resolvedAmounts,
	showHeaders = false,
}: {
	movements: Movement[];
	accounts: Account[];
	plan: Plan;
	resolvedAmounts?: Map<string, ResolvedMovementAmount>;
	showHeaders?: boolean;
}) {
	if (!movements.length)
		return <EmptyState icon={ArrowRight} title="No matching transactions" />;
	const names = new Map(accounts.map((account) => [account.id, account.name]));
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selected = selectedId
		? (movements.find((movement) => movement.id === selectedId) ?? null)
		: null;
	const selectedResolved = selected
		? resolvedAmounts?.get(selected.id)
		: undefined;
	const selectedClaimRuleName = selected?.claimRuleId
		? (movements.find((movement) => movement.id === selected.claimRuleId)
				?.name ?? null)
		: null;
	return (
		<>
			<TransactionTable
				caption="Planned transactions with dates and amounts."
				showHeaders={showHeaders}
			>
				{movements.map((movement) => {
					const pending = isPendingMovement(movement);
					// External endpoints only restate the direction, so the route
					// names real accounts only. The date lives in its own column.
					const route = [movement.fromId, movement.toId]
						.map((id) => (id ? names.get(id) : null))
						.filter((name): name is string => Boolean(name))
						.join(" → ");
					const tone = movement.fromId
						? movement.toId
							? ("transfer" as const)
							: ("outflow" as const)
						: ("inflow" as const);
					const dateText =
						movement.frequency === "once"
							? dateLabel(movement.startDate, true)
							: movement.frequency === "monthly"
								? "Monthly"
								: "Yearly";
					return (
						<TransactionItemRow
							key={movement.id}
							dimmed={!movement.enabled && !pending}
							date={
								movement.frequency === "once" ? (
									<time dateTime={movement.startDate}>{dateText}</time>
								) : (
									dateText
								)
							}
							icon={
								movement.fromId ? (
									movement.toId ? (
										<ArrowRight size={16} aria-hidden="true" />
									) : (
										<ArrowUpRight size={16} aria-hidden="true" />
									)
								) : (
									<ArrowDownLeft size={16} aria-hidden="true" />
								)
							}
							tone={tone}
							title={movement.name}
							slots={{
								subtitle: route ? <span>{route}</span> : undefined,
								mobile: <span>{dateText}</span>,
								badges: (pending || !movement.enabled) && (
									<>
										{pending ? (
											<Badge
												tone="neutral"
												className={transactionBadgeStyles()}
											>
												Pending
											</Badge>
										) : (
											!movement.enabled && (
												<Badge
													tone="warning"
													className={transactionBadgeStyles()}
												>
													Excluded
												</Badge>
											)
										)}
									</>
								),
							}}
							amount={
								<>
									<MovementAmount
										movement={movement}
										resolved={resolvedAmounts?.get(movement.id)}
									/>
									{movement.claimRuleId && (
										<Badge tone="neutral">
											Records {movement.claimOccurrenceDate}
										</Badge>
									)}
								</>
							}
							actionLabel={`View ${movement.name} on ${movement.frequency === "once" ? dateText : movement.frequency}`}
							onSelect={() => setSelectedId(movement.id)}
						/>
					);
				})}
			</TransactionTable>
			{selected && (
				<MovementDetail
					movement={selected}
					accounts={accounts}
					plan={plan}
					resolvedAmount={selectedResolved?.amount}
					resolvedDate={selectedResolved?.date}
					claimRuleName={selectedClaimRuleName}
					onClose={() => setSelectedId(null)}
				/>
			)}
		</>
	);
}

function MovementAmount({
	movement,
	resolved,
}: {
	movement: Movement;
	resolved: ResolvedMovementAmount | undefined;
}) {
	if (movement.amountKnown)
		return (
			<strong className={transactionAmountStyles()}>
				{money(movement.amount)}
			</strong>
		);
	if (resolved) {
		const label =
			movement.frequency === "once"
				? `Calculated for ${dateLabel(resolved.date, true)}`
				: `Next calculated amount ${dateLabel(resolved.date, true)} · varies each occurrence`;
		return (
			<>
				<strong className={transactionAmountStyles()} title={label}>
					{money(resolved.amount)}
				</strong>
				<Badge tone="neutral">Varies</Badge>
			</>
		);
	}
	return (
		<strong
			className={transactionAmountStyles()}
			title="Calculated during projection · varies each occurrence"
		>
			Varies
		</strong>
	);
}
