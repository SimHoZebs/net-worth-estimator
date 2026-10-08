import { CalendarDays } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Progress } from "../../components/ui.tsx";
import { accountTransactions } from "../../domain/accountActivity.ts";
import {
	cycleSpentSoFar,
	isCycleOutflow,
	resolveStatementCycle,
} from "../../domain/cardCycle.ts";
import { dateLabel, money, shiftDate, sum } from "../../domain/format.ts";
import {
	cashCushion,
	checkingAccountId,
	checkingBalance,
	cycleAllowance,
	cycleBudget,
	DEFAULT_CYCLE_STATEMENT_DAY,
	DEFAULT_PROTECTED_RESERVE,
	filterMovementsById,
	groupMandatorySpending,
	nextMonthObligations,
	nextPaycheck,
	remainingMonthlyObligations,
} from "../../domain/householdTiming.ts";
import type { Plan } from "../../domain/model.ts";
import type { EditorTarget } from "../../domain/planEdits.ts";
import type { Projection } from "../../domain/result.ts";
import {
	TimingDetailDialog,
	type TimingDetailTab,
} from "./TimingDetailDialog.tsx";

const STORAGE_KEY = "nwe.card-cycle.v3";
const LEGACY_STORAGE_KEY = "nwe.card-cycle.v2";

interface TotalCycleSettings {
	statementDay: number;
	reserve: number;
	spentOverride: number | null;
	paycheckOverride: number | null;
	fixedOverride: number | null;
	checkingOverride: number | null;
	remainingOverride: number | null;
	/** Null means every debt account counts toward the total. */
	accountIds: string[] | null;
	/** Null means every recurring checking outflow counts as a bill. */
	movementIds: string[] | null;
	/** Which window the drawer mandatory tab uses. Card figures stay calendar. */
	mandatoryFrame: "calendar" | "cycle";
	/** True once the statement day is explicitly chosen. Untouched legacy 1st falls back to the household 20th. */
	statementDaySet: boolean;
}

const defaultSettings = (): TotalCycleSettings => ({
	statementDay: DEFAULT_CYCLE_STATEMENT_DAY,
	reserve: DEFAULT_PROTECTED_RESERVE,
	spentOverride: null,
	paycheckOverride: null,
	fixedOverride: null,
	checkingOverride: null,
	remainingOverride: null,
	accountIds: null,
	movementIds: null,
	mandatoryFrame: "calendar",
	statementDaySet: false,
});

function optionalMoney(value: unknown): number | null {
	if (value === null || value === undefined || value === "") return null;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) return null;
	return parsed;
}

function loadPersisted(): TotalCycleSettings {
	if (typeof window === "undefined" || !window.localStorage)
		return defaultSettings();
	try {
		const raw =
			window.localStorage.getItem(STORAGE_KEY) ??
			window.localStorage.getItem(LEGACY_STORAGE_KEY);
		if (!raw) return defaultSettings();
		const parsed = JSON.parse(raw) as Partial<TotalCycleSettings> & {
			budget?: unknown;
		};
		if (typeof parsed !== "object" || parsed === null) return defaultSettings();
		const accountIds = Array.isArray(parsed.accountIds)
			? parsed.accountIds.filter(
					(id): id is string => typeof id === "string" && id !== "",
				)
			: null;
		const movementIds = Array.isArray(parsed.movementIds)
			? parsed.movementIds.filter(
					(id): id is string => typeof id === "string" && id !== "",
				)
			: null;
		const statementDaySet = parsed.statementDaySet === true;
		const storedDay = Math.min(
			28,
			Math.max(
				1,
				Math.floor(Number(parsed.statementDay) || DEFAULT_CYCLE_STATEMENT_DAY),
			),
		);
		return {
			statementDay:
				!statementDaySet && storedDay === 1
					? DEFAULT_CYCLE_STATEMENT_DAY
					: storedDay,
			statementDaySet,
			reserve: Math.max(
				0,
				Number.isFinite(Number(parsed.reserve))
					? Number(parsed.reserve)
					: DEFAULT_PROTECTED_RESERVE,
			),
			spentOverride: optionalMoney(parsed.spentOverride),
			paycheckOverride: optionalMoney(parsed.paycheckOverride),
			fixedOverride: optionalMoney(parsed.fixedOverride),
			checkingOverride: optionalMoney(parsed.checkingOverride),
			remainingOverride: optionalMoney(parsed.remainingOverride),
			accountIds: accountIds?.length ? accountIds : null,
			movementIds: movementIds?.length ? movementIds : null,
			mandatoryFrame: parsed.mandatoryFrame === "cycle" ? "cycle" : "calendar",
		};
	} catch {
		return defaultSettings();
	}
}

export function TimingPreview({
	plan,
	projection,
	onEdit,
}: {
	plan: Plan;
	projection: Projection;
	onEdit: (target: EditorTarget) => void;
}) {
	const cards = useMemo(
		() => plan.accounts.filter((account) => account.kind === "debt"),
		[plan.accounts],
	);
	const [settings, setSettings] = useState<TotalCycleSettings>(loadPersisted);
	const [detail, setDetail] = useState<TimingDetailTab | null>(null);

	useEffect(() => {
		if (typeof window === "undefined" || !window.localStorage) return;
		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
		} catch {
			// Storage is best-effort; the tracker still works for this session.
		}
	}, [settings]);

	const trackedIds = useMemo(() => {
		const known = new Set(cards.map((card) => card.id));
		// Spending cards are debt accounts by convention (`*_card`); loans
		// and other debt fall back to the full set when no card is present.
		const cardLike = cards
			.map((card) => card.id)
			.filter((id) => id.endsWith("_card"));
		const fallback = cardLike.length ? cardLike : cards.map((card) => card.id);
		if (!settings.accountIds) return fallback.filter((id) => known.has(id));
		const selected = settings.accountIds.filter((id) => known.has(id));
		return selected.length ? selected : fallback.filter((id) => known.has(id));
	}, [settings.accountIds, cards]);

	const trackedCards = useMemo(() => {
		const selected = new Set(trackedIds);
		return cards.filter((card) => selected.has(card.id));
	}, [trackedIds, cards]);

	const cycle = useMemo(
		() =>
			resolveStatementCycle({
				todayIso: plan.startDate,
				statementDay: settings.statementDay,
			}),
		[plan.startDate, settings.statementDay],
	);

	const perAccount = useMemo(
		() =>
			trackedIds.map((accountId) => {
				const transactions = accountTransactions({
					accountId,
					plan,
					projection,
				});
				const name =
					cards.find((card) => card.id === accountId)?.name ?? accountId;
				const today = plan.startDate.slice(0, 10);
				return {
					accountId,
					name,
					derived: cycleSpentSoFar({
						transactions,
						cycleStart: cycle.cycleStart,
						todayIso: plan.startDate,
					}),
					inCycle: transactions.filter(
						(transaction) =>
							isCycleOutflow(transaction) &&
							transaction.date >= cycle.cycleStart &&
							transaction.date <= today,
					),
				};
			}),
		[trackedIds, cards, plan, projection, cycle, plan.startDate],
	);
	const cycleTransactions = useMemo(
		() =>
			perAccount
				.flatMap((item) => item.inCycle)
				.sort(
					(left, right) =>
						left.date.localeCompare(right.date) ||
						left.id.localeCompare(right.id),
				),
		[perAccount],
	);

	const checkingId = useMemo(() => checkingAccountId(plan), [plan]);
	const checkingDerived = useMemo(() => checkingBalance(plan), [plan]);
	const obligationMovements = useMemo(
		() => filterMovementsById(projection.movements, settings.movementIds),
		[projection.movements, settings.movementIds],
	);
	const remainingDerived = useMemo(() => {
		if (!checkingId) return { total: 0, monthEnd: plan.startDate.slice(0, 10) };
		return remainingMonthlyObligations({
			movements: obligationMovements,
			checkingId,
			todayIso: plan.startDate,
		});
	}, [obligationMovements, checkingId, plan.startDate]);
	const fixedDerived = useMemo(() => {
		if (!checkingId)
			return { total: 0, start: plan.startDate, end: plan.startDate };
		return nextMonthObligations({
			movements: obligationMovements,
			checkingId,
			todayIso: plan.startDate,
		});
	}, [obligationMovements, checkingId, plan.startDate]);
	const paycheckDerived = useMemo(() => {
		if (!checkingId) return null;
		return nextPaycheck({
			movements: projection.movements,
			checkingId,
			todayIso: plan.startDate,
		});
	}, [projection.movements, checkingId, plan.startDate]);

	const billCandidates = useMemo(() => {
		if (!checkingId) return [];
		return plan.movements
			.filter(
				(movement) =>
					movement.fromId === checkingId && movement.frequency !== "once",
			)
			.map((movement) => ({
				id: movement.id,
				name: movement.name,
				amount: movement.amount,
				frequency: movement.frequency,
			}));
	}, [plan.movements, checkingId]);

	const trackedBillIds = useMemo(() => {
		const known = new Set(billCandidates.map((bill) => bill.id));
		if (!settings.movementIds) return billCandidates.map((bill) => bill.id);
		const selected = settings.movementIds.filter((id) => known.has(id));
		return selected.length ? selected : billCandidates.map((bill) => bill.id);
	}, [settings.movementIds, billCandidates]);

	const mandatoryThisMonth = useMemo(() => {
		if (!checkingId) return [];
		const today = plan.startDate.slice(0, 10);
		return groupMandatorySpending({
			movements: obligationMovements,
			checkingId,
			start: shiftDate({ date: today, days: 1 }),
			end: remainingDerived.monthEnd,
		});
	}, [
		obligationMovements,
		checkingId,
		plan.startDate,
		remainingDerived.monthEnd,
	]);
	const mandatoryNextMonth = useMemo(() => {
		if (!checkingId) return [];
		return groupMandatorySpending({
			movements: obligationMovements,
			checkingId,
			start: fixedDerived.start,
			end: fixedDerived.end,
		});
	}, [obligationMovements, checkingId, fixedDerived.start, fixedDerived.end]);
	const nextCycle = useMemo(
		() =>
			resolveStatementCycle({
				todayIso: shiftDate({ date: cycle.cycleEnd, days: 1 }),
				statementDay: settings.statementDay,
			}),
		[cycle.cycleEnd, settings.statementDay],
	);
	const cycleThisGroups = useMemo(() => {
		if (!checkingId) return [];
		const today = plan.startDate.slice(0, 10);
		return groupMandatorySpending({
			movements: obligationMovements,
			checkingId,
			start: shiftDate({ date: today, days: 1 }),
			end: cycle.cycleEnd,
		});
	}, [obligationMovements, checkingId, plan.startDate, cycle.cycleEnd]);
	const cycleNextGroups = useMemo(() => {
		if (!checkingId) return [];
		return groupMandatorySpending({
			movements: obligationMovements,
			checkingId,
			start: nextCycle.cycleStart,
			end: nextCycle.cycleEnd,
		});
	}, [obligationMovements, checkingId, nextCycle]);

	if (!cards.length) {
		return (
			<section className="timing-preview" aria-label="Total card cycle">
				<div className="section-top">
					<h2>
						<CalendarDays size={18} />
						Total card cycle
					</h2>
					<Badge tone="outline">Card timing</Badge>
				</div>
				<p className="section-note">
					Add a debt account to track a card statement cycle here.
				</p>
			</section>
		);
	}

	const derivedSpent = perAccount.reduce((sum, item) => sum + item.derived, 0);

	const checking = settings.checkingOverride ?? checkingDerived ?? 0;
	const remainingObligations =
		settings.remainingOverride ?? remainingDerived.total;
	const cushion = cashCushion({
		checking,
		remainingObligations,
	});

	const paycheck = settings.paycheckOverride ?? paycheckDerived?.amount ?? 0;
	const fixedObligations = settings.fixedOverride ?? fixedDerived.total;
	const budget = cycleBudget({
		paycheck,
		fixedObligations,
		reserve: settings.reserve,
	});
	const spent = settings.spentOverride ?? derivedSpent;
	const allowance = cycleAllowance({
		paycheck,
		fixedObligations,
		spent,
		reserve: settings.reserve,
	});
	const theoretical = paycheck - fixedObligations - spent;
	const fullDaysLeft = Math.max(1, cycle.daysLeft - 1);
	const dailySafe = allowance / fullDaysLeft;
	const dailyTheoretical = theoretical / fullDaysLeft;
	const progress = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;

	const checkingAccount = checkingId
		? (plan.accounts.find((account) => account.id === checkingId) ?? null)
		: null;
	const heroes = {
		cushion,
		cushionProvisional: !(checkingAccount?.balanceCheck ?? false),
		checkingAmount: checking,
		checkingObservedOn: checkingAccount?.balanceCheck
			? (checkingAccount?.observedOn ?? null)
			: null,
		safe: allowance,
		theoretical,
		dailySafe,
		dailyTheoretical,
		fullDaysLeft,
		cycleStart: cycle.cycleStart,
		cycleEnd: cycle.cycleEnd,
		committedTotal: spent,
		committedByCard: perAccount.map((item) => ({
			id: item.accountId,
			name: item.name,
			amount: item.derived,
		})),
		paycheckAmount: paycheck,
		fixedAmount: fixedObligations,
		reserveAmount: settings.reserve,
	};

	const updateSettings = (next: Partial<TotalCycleSettings>) => {
		setSettings((previous) => ({
			statementDay: next.statementDay ?? previous.statementDay,
			statementDaySet: next.statementDaySet ?? previous.statementDaySet,
			reserve: next.reserve ?? previous.reserve,
			spentOverride:
				next.spentOverride !== undefined
					? next.spentOverride
					: previous.spentOverride,
			paycheckOverride:
				next.paycheckOverride !== undefined
					? next.paycheckOverride
					: previous.paycheckOverride,
			fixedOverride:
				next.fixedOverride !== undefined
					? next.fixedOverride
					: previous.fixedOverride,
			checkingOverride:
				next.checkingOverride !== undefined
					? next.checkingOverride
					: previous.checkingOverride,
			remainingOverride:
				next.remainingOverride !== undefined
					? next.remainingOverride
					: previous.remainingOverride,
			accountIds:
				next.accountIds !== undefined ? next.accountIds : previous.accountIds,
			movementIds:
				next.movementIds !== undefined
					? next.movementIds
					: previous.movementIds,
			mandatoryFrame: next.mandatoryFrame ?? previous.mandatoryFrame,
		}));
	};

	const resetConfig = (
		key: "paycheck" | "fixed" | "spent" | "checking" | "remaining",
	) => {
		updateSettings({ [`${key}Override`]: null } as Partial<TotalCycleSettings>);
	};

	const toggleAccount = (accountId: string) => {
		const cardLike = cards
			.map((card) => card.id)
			.filter((id) => id.endsWith("_card"));
		const fallback = cardLike.length ? cardLike : cards.map((card) => card.id);
		const explicit = settings.accountIds ?? fallback;
		const next = explicit.includes(accountId)
			? explicit.filter((id) => id !== accountId)
			: [...explicit, accountId];
		updateSettings({ accountIds: next.length ? next : null });
	};

	const billsFiltered =
		settings.movementIds !== null &&
		settings.movementIds.length !== billCandidates.length;

	const toggleBill = (movementId: string) => {
		const explicit =
			settings.movementIds ?? billCandidates.map((bill) => bill.id);
		const next = explicit.includes(movementId)
			? explicit.filter((id) => id !== movementId)
			: [...explicit, movementId];
		updateSettings({
			movementIds:
				next.length === billCandidates.length || next.length === 0
					? null
					: next,
		});
	};

	const narrowedAccounts = trackedIds.length !== cards.length;
	const accountLabel = narrowedAccounts
		? trackedCards.map((card) => card.name).join(", ")
		: null;

	const activeThisMonth =
		settings.mandatoryFrame === "calendar"
			? {
					title: "Due before month-end",
					subtitle: `${dateLabel(plan.startDate, true)} to ${dateLabel(remainingDerived.monthEnd, true)}`,
					total: remainingObligations,
					groups: mandatoryThisMonth,
				}
			: {
					title: "Due before cycle end",
					subtitle: `${dateLabel(plan.startDate, true)} to ${dateLabel(cycle.cycleEnd, true)}`,
					total: sum(cycleThisGroups.map((group) => group.total)),
					groups: cycleThisGroups,
				};
	const activeNextMonth =
		settings.mandatoryFrame === "calendar"
			? {
					title: "Next month fixed",
					subtitle: `${dateLabel(fixedDerived.start, true)} to ${dateLabel(fixedDerived.end, true)}${billsFiltered ? ` · ${trackedBillIds.length} of ${billCandidates.length} bills` : ""}`,
					total: fixedObligations,
					groups: mandatoryNextMonth,
				}
			: {
					title: "Next cycle fixed",
					subtitle: `${dateLabel(nextCycle.cycleStart, true)} to ${dateLabel(nextCycle.cycleEnd, true)}${billsFiltered ? ` · ${trackedBillIds.length} of ${billCandidates.length} bills` : ""}`,
					total: sum(cycleNextGroups.map((group) => group.total)),
					groups: cycleNextGroups,
				};

	return (
		<section className="timing-preview" aria-label="Total card cycle">
			<button
				type="button"
				className="timing-open"
				onClick={() => setDetail("mandatory")}
			>
				<span className="sr-only">Open timing details</span>
			</button>
			<div className="section-top">
				<h2>
					<CalendarDays size={18} />
					Total card cycle
				</h2>
				<Badge tone="outline">Card timing</Badge>
			</div>
			<p className="cycle-dates">
				{dateLabel(cycle.cycleStart, true)} to {dateLabel(cycle.cycleEnd, true)}{" "}
				· {fullDaysLeft} {fullDaysLeft === 1 ? "day" : "days"} left
				{accountLabel ? ` · ${accountLabel}` : ""}
			</p>
			<div className="timing-figures">
				<div>
					<span>
						Cash cushion{" "}
						{heroes.cushionProvisional && (
							<Badge tone="amber">Provisional</Badge>
						)}
					</span>
					<strong>{money(cushion)}</strong>
				</div>
				<div>
					<span>Safe room</span>
					<strong>{money(allowance)}</strong>
				</div>
			</div>
			<div className="cycle-remaining">
				<div>
					<span>Daily safe</span>
					<strong>{money(Math.max(0, dailySafe))}</strong>
				</div>
				<div>
					<span>Committed</span>
					<strong>{money(spent)}</strong>
				</div>
			</div>
			<div className="cycle-progress">
				<Progress
					value={progress}
					label="Total cycle spending"
					tone={allowance < 0 ? "amber" : "green"}
				/>
				<p>
					{money(checking)} checking · paycheck {money(paycheck)} − fixed{" "}
					{money(fixedObligations)} − reserve {money(settings.reserve)}
				</p>
			</div>
			<div className="cycle-actions">
				<button
					type="button"
					className="text-button"
					onClick={(event) => {
						event.stopPropagation();
						setDetail("mandatory");
					}}
				>
					Mandatory spending ({money(fixedObligations)} next month
					{billsFiltered
						? ` · ${trackedBillIds.length} of ${billCandidates.length} bills`
						: ""}
					)
				</button>
				<button
					type="button"
					className="text-button"
					onClick={(event) => {
						event.stopPropagation();
						setDetail("cycle");
					}}
				>
					{`Where the cycle went (${cycleTransactions.length})`}
				</button>
			</div>
			{detail && (
				<TimingDetailDialog
					eyebrow={`${dateLabel(cycle.cycleStart, true)} to ${dateLabel(cycle.cycleEnd, true)}${accountLabel ? ` · ${accountLabel}` : ""}`}
					today={plan.startDate.slice(0, 10)}
					heroes={heroes}
					cashNow={{
						checking,
						bills: remainingObligations,
						cushion,
					}}
					paycheck={{
						paycheck,
						fixed: fixedObligations,
						reserve: settings.reserve,
						spent,
						allowance,
					}}
					thisMonth={activeThisMonth}
					nextMonth={activeNextMonth}
					frame={settings.mandatoryFrame}
					onFrameChange={(frame) => updateSettings({ mandatoryFrame: frame })}
					billsFiltered={billsFiltered}
					billCandidates={billCandidates}
					trackedBillIds={trackedBillIds}
					onToggleBill={toggleBill}
					plan={plan}
					onEdit={onEdit}
					cycleTransactions={cycleTransactions}
					cycleEnd={cycle.cycleEnd}
					config={{
						statementDay: settings.statementDay,
						reserve: settings.reserve,
						spentOverride: settings.spentOverride,
						paycheckOverride: settings.paycheckOverride,
						fixedOverride: settings.fixedOverride,
						checkingOverride: settings.checkingOverride,
						remainingOverride: settings.remainingOverride,
						paycheckHint: paycheckDerived,
						fixedHint: fixedDerived,
						checkingHint: checkingDerived,
						remainingHint: remainingDerived,
						spentHint: derivedSpent,
						cards: cards.map((card) => ({ id: card.id, name: card.name })),
						trackedIds,
					}}
					onToggleAccount={toggleAccount}
					onUpdateConfig={updateSettings}
					onResetConfig={resetConfig}
					initialTab={detail}
					onClose={() => setDetail(null)}
				/>
			)}
		</section>
	);
}
