import { CalendarDays } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Progress } from "../../components/ui.tsx";
import { accountTransactions } from "../../domain/accountActivity.ts";
import {
	cycleSpentSoFar,
	isCycleOutflow,
	resolveStatementCycle,
} from "../../domain/cardCycle.ts";
import {
	dateLabel,
	money,
	shiftDate,
	sum,
	todayIso,
} from "../../domain/format.ts";
import {
	cashCushion,
	checkingAccountId,
	cycleAllowance,
	cycleBudget,
	DEFAULT_CYCLE_STATEMENT_DAY,
	DEFAULT_PROTECTED_RESERVE,
	filterMovementsById,
	groupMandatorySpending,
	nextMonthObligations,
	nextPaycheck,
	realizedCheckingOutflows,
	remainingMonthlyObligations,
	spendingBalance,
} from "../../domain/householdTiming.ts";
import type { Plan } from "../../domain/model.ts";
import { visibleAccounts } from "../../domain/model.ts";
import type { EditorTarget } from "../../domain/planEdits.ts";
import type { Projection } from "../../domain/result.ts";
import {
	TimingDetailDialog,
	type TimingDetailTab,
} from "./TimingDetailDialog.tsx";

const STORAGE_KEY = "nwe.card-cycle.v4";
const LEGACY_STORAGE_KEYS = ["nwe.card-cycle.v3", "nwe.card-cycle.v2"];

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
	/** Null means the detected checking account alone counts as spendable. */
	spendingAccountIds: string[] | null;
	/** Null means every recurring outflow counts as a bill. */
	movementIds: string[] | null;
	/** Which window the drawer bills tab uses. Card figures stay calendar. */
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
	spendingAccountIds: null,
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
			LEGACY_STORAGE_KEYS.map((key) => window.localStorage.getItem(key)).find(
				(value) => value !== null && value !== undefined,
			) ??
			null;
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
		const spendingAccountIds = Array.isArray(parsed.spendingAccountIds)
			? parsed.spendingAccountIds.filter(
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
			spendingAccountIds: spendingAccountIds?.length
				? spendingAccountIds
				: null,
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
		() =>
			visibleAccounts(plan.accounts).filter(
				(account) => account.kind === "debt",
			),
		[plan.accounts],
	);
	const [settings, setSettings] = useState<TotalCycleSettings>(loadPersisted);
	const [detail, setDetail] = useState<TimingDetailTab | null>(null);

	// Display timing follows the real calendar day so due dates read
	// correctly, while the projection math stays on plan.startDate (the
	// latest balance checkpoint). Never before the projection start.
	const [displayToday] = useState(() => {
		const today = todayIso();
		const start = plan.startDate.slice(0, 10);
		return today >= start ? today : start;
	});
	const staleData = displayToday > plan.startDate.slice(0, 10);

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
				todayIso: displayToday,
				statementDay: settings.statementDay,
			}),
		[displayToday, settings.statementDay],
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
				return {
					accountId,
					name,
					derived: cycleSpentSoFar({
						transactions,
						cycleStart: cycle.cycleStart,
						todayIso: displayToday,
					}),
					inCycle: transactions.filter(
						(transaction) =>
							isCycleOutflow(transaction) &&
							transaction.date >= cycle.cycleStart &&
							transaction.date <= displayToday,
					),
				};
			}),
		[trackedIds, cards, plan, projection, cycle, displayToday],
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

	const spendableAccounts = useMemo(
		() =>
			visibleAccounts(plan.accounts).filter(
				(account) => account.kind !== "debt",
			),
		[plan.accounts],
	);
	const spendingIds = useMemo(() => {
		const known = new Set(spendableAccounts.map((account) => account.id));
		const fallbackId = checkingAccountId(plan);
		const fallback = fallbackId && known.has(fallbackId) ? [fallbackId] : [];
		if (!settings.spendingAccountIds) return fallback;
		const selected = settings.spendingAccountIds.filter((id) => known.has(id));
		return selected.length ? selected : fallback;
	}, [settings.spendingAccountIds, spendableAccounts, plan]);
	const spendingDerived = useMemo(
		() => spendingBalance(plan, spendingIds),
		[plan, spendingIds],
	);
	const obligationMovements = useMemo(
		() => filterMovementsById(projection.movements, settings.movementIds),
		[projection.movements, settings.movementIds],
	);
	const remainingDerived = useMemo(() => {
		if (!spendingIds.length)
			return { total: 0, monthEnd: displayToday.slice(0, 10) };
		return remainingMonthlyObligations({
			movements: obligationMovements,
			checkingIds: spendingIds,
			todayIso: displayToday,
		});
	}, [obligationMovements, spendingIds, displayToday]);
	const fixedDerived = useMemo(() => {
		if (!spendingIds.length)
			return { total: 0, start: displayToday, end: displayToday };
		return nextMonthObligations({
			movements: obligationMovements,
			checkingIds: spendingIds,
			todayIso: displayToday,
		});
	}, [obligationMovements, spendingIds, displayToday]);
	const paycheckDerived = useMemo(() => {
		if (!spendingIds.length) return null;
		return nextPaycheck({
			movements: projection.movements,
			checkingIds: spendingIds,
			todayIso: displayToday,
		});
	}, [projection.movements, spendingIds, displayToday]);
	const spentSinceStart = useMemo(
		() =>
			spendingIds.length
				? realizedCheckingOutflows({
						movements: obligationMovements,
						checkingIds: spendingIds,
						after: plan.startDate,
						through: displayToday,
					})
				: 0,
		[obligationMovements, spendingIds, plan.startDate, displayToday],
	);

	const billCandidates = useMemo(() => {
		if (!spendingIds.length) return [];
		return plan.movements
			.filter(
				(movement) =>
					movement.fromId !== null &&
					spendingIds.includes(movement.fromId) &&
					movement.frequency !== "once",
			)
			.map((movement) => ({
				id: movement.id,
				name: movement.name,
				amount: movement.amount,
				frequency: movement.frequency,
			}));
	}, [plan.movements, spendingIds]);

	const trackedBillIds = useMemo(() => {
		const known = new Set(billCandidates.map((bill) => bill.id));
		if (!settings.movementIds) return billCandidates.map((bill) => bill.id);
		const selected = settings.movementIds.filter((id) => known.has(id));
		return selected.length ? selected : billCandidates.map((bill) => bill.id);
	}, [settings.movementIds, billCandidates]);

	const mandatoryThisMonth = useMemo(() => {
		if (!spendingIds.length) return [];
		return groupMandatorySpending({
			movements: obligationMovements,
			checkingIds: spendingIds,
			start: shiftDate({ date: displayToday, days: 1 }),
			end: remainingDerived.monthEnd,
		});
	}, [
		obligationMovements,
		spendingIds,
		displayToday,
		remainingDerived.monthEnd,
	]);
	const mandatoryNextMonth = useMemo(() => {
		if (!spendingIds.length) return [];
		return groupMandatorySpending({
			movements: obligationMovements,
			checkingIds: spendingIds,
			start: fixedDerived.start,
			end: fixedDerived.end,
		});
	}, [obligationMovements, spendingIds, fixedDerived.start, fixedDerived.end]);
	const nextCycle = useMemo(
		() =>
			resolveStatementCycle({
				todayIso: shiftDate({ date: cycle.cycleEnd, days: 1 }),
				statementDay: settings.statementDay,
			}),
		[cycle.cycleEnd, settings.statementDay],
	);
	const cycleThisGroups = useMemo(() => {
		if (!spendingIds.length) return [];
		return groupMandatorySpending({
			movements: obligationMovements,
			checkingIds: spendingIds,
			start: shiftDate({ date: displayToday, days: 1 }),
			end: cycle.cycleEnd,
		});
	}, [obligationMovements, spendingIds, displayToday, cycle.cycleEnd]);
	const cycleNextGroups = useMemo(() => {
		if (!spendingIds.length) return [];
		return groupMandatorySpending({
			movements: obligationMovements,
			checkingIds: spendingIds,
			start: nextCycle.cycleStart,
			end: nextCycle.cycleEnd,
		});
	}, [obligationMovements, spendingIds, nextCycle]);

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

	const checking = settings.checkingOverride ?? spendingDerived;
	const remainingObligations =
		settings.remainingOverride ?? remainingDerived.total;
	const cushion = cashCushion({
		checking,
		spentSinceStart,
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

	const spendingAccounts = spendingIds
		.map((id) => plan.accounts.find((account) => account.id === id))
		.filter((account) => account !== undefined);
	const confirmedObservedOn = spendingAccounts
		.filter((account) => account.balanceCheck)
		.map((account) => account.observedOn)
		.sort();
	const heroes = {
		cushion,
		cushionProvisional:
			spendingAccounts.length === 0 ||
			spendingAccounts.some((account) => !account.balanceCheck),
		checkingAmount: checking,
		checkingObservedOn: confirmedObservedOn.at(-1) ?? null,
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
			spendingAccountIds:
				next.spendingAccountIds !== undefined
					? next.spendingAccountIds
					: previous.spendingAccountIds,
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

	const toggleSpendingAccount = (accountId: string) => {
		const known = new Set(spendableAccounts.map((account) => account.id));
		const fallbackId = checkingAccountId(plan);
		const fallback = fallbackId && known.has(fallbackId) ? [fallbackId] : [];
		const explicit = settings.spendingAccountIds ?? fallback;
		const next = explicit.includes(accountId)
			? explicit.filter((id) => id !== accountId)
			: [...explicit, accountId];
		updateSettings({ spendingAccountIds: next.length ? next : null });
	};

	const narrowedAccounts = trackedIds.length !== cards.length;
	const accountLabel = narrowedAccounts
		? trackedCards.map((card) => card.name).join(", ")
		: null;

	const activeThisMonth =
		settings.mandatoryFrame === "calendar"
			? {
					title: "Due before month-end",
					subtitle: `${dateLabel(displayToday, true)} to ${dateLabel(remainingDerived.monthEnd, true)}`,
					total: remainingObligations,
					groups: mandatoryThisMonth,
				}
			: {
					title: "Due before cycle end",
					subtitle: `${dateLabel(displayToday, true)} to ${dateLabel(cycle.cycleEnd, true)}`,
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
				{staleData ? ` · balances ${dateLabel(plan.startDate, true)}` : ""}
				{accountLabel ? ` · ${accountLabel}` : ""}
			</p>
			<div className="spend-answer">
				<span>
					{allowance >= 0
						? `You can spend until ${dateLabel(cycle.cycleEnd, true)}`
						: `Over budget until ${dateLabel(cycle.cycleEnd, true)}`}
				</span>
				<strong>{money(Math.abs(allowance))}</strong>
				<span>
					{money(Math.max(0, dailySafe))} a day · {money(spent)} committed
				</span>
			</div>
			<div className="cycle-remaining">
				<div>
					<span>
						Left to spend{" "}
						{heroes.cushionProvisional && <Badge tone="amber">Estimated</Badge>}
					</span>
					<strong>{money(cushion)}</strong>
				</div>
				<div>
					<span>Balance</span>
					<strong>{money(checking)}</strong>
				</div>
			</div>
			<div className="cycle-progress">
				<Progress
					value={progress}
					label="Total cycle spending"
					tone={allowance < 0 ? "amber" : "green"}
				/>
				<p>
					{money(checking)} balance · paycheck {money(paycheck)} − fixed{" "}
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
					Bills ({money(fixedObligations)} next month
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
					today={displayToday}
					heroes={heroes}
					cashNow={{
						checking,
						spentSinceStart,
						bills: remainingObligations,
						cushion,
						since: plan.startDate.slice(0, 10),
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
						checkingHint: spendingDerived,
						remainingHint: remainingDerived,
						spentHint: derivedSpent,
						cards: cards.map((card) => ({ id: card.id, name: card.name })),
						trackedIds,
						spendingAccounts: spendableAccounts.map((account) => ({
							id: account.id,
							name: account.name,
						})),
						trackedSpendingIds: spendingIds,
					}}
					onToggleAccount={toggleAccount}
					onToggleSpendingAccount={toggleSpendingAccount}
					onUpdateConfig={updateSettings}
					onResetConfig={resetConfig}
					initialTab={detail}
					onClose={() => setDetail(null)}
				/>
			)}
		</section>
	);
}
