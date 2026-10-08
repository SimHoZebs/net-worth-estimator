import { CalendarDays } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, Progress } from "../../components/ui.tsx";
import { accountTransactions } from "../../domain/accountActivity.ts";
import {
	cycleScheduledRest,
	cycleSpentSoFar,
	dailyAllowance,
	groupCycleSpending,
	resolveStatementCycle,
} from "../../domain/cardCycle.ts";
import { dateLabel, money, shiftDate } from "../../domain/format.ts";
import {
	cashCushion,
	checkingAccountId,
	checkingBalance,
	cycleAllowance,
	cycleBudget,
	DEFAULT_CYCLE_STATEMENT_DAY,
	DEFAULT_PROTECTED_RESERVE,
	groupMandatorySpending,
	nextMonthObligations,
	nextPaycheck,
	remainingMonthlyObligations,
} from "../../domain/householdTiming.ts";
import type { Plan } from "../../domain/model.ts";
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
		return {
			statementDay: Math.min(
				28,
				Math.max(
					1,
					Math.floor(
						Number(parsed.statementDay) || DEFAULT_CYCLE_STATEMENT_DAY,
					),
				),
			),
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
		};
	} catch {
		return defaultSettings();
	}
}

export function TimingPreview({
	plan,
	projection,
}: {
	plan: Plan;
	projection: Projection;
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
		if (!settings.accountIds) return cards.map((card) => card.id);
		const selected = settings.accountIds.filter((id) => known.has(id));
		return selected.length ? selected : cards.map((card) => card.id);
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
				return {
					accountId,
					name,
					derived: cycleSpentSoFar({
						transactions,
						cycleStart: cycle.cycleStart,
						todayIso: plan.startDate,
					}),
					scheduled: cycleScheduledRest({
						transactions,
						cycleEnd: cycle.cycleEnd,
						todayIso: plan.startDate,
					}),
					groups: groupCycleSpending({
						transactions,
						cycleStart: cycle.cycleStart,
						todayIso: plan.startDate,
					}).map((group) => ({ ...group, accountId, accountName: name })),
				};
			}),
		[trackedIds, cards, plan, projection, cycle, plan.startDate],
	);

	const checkingId = useMemo(() => checkingAccountId(plan), [plan]);
	const checkingDerived = useMemo(() => checkingBalance(plan), [plan]);
	const remainingDerived = useMemo(() => {
		if (!checkingId) return { total: 0, monthEnd: plan.startDate.slice(0, 10) };
		return remainingMonthlyObligations({
			movements: projection.movements,
			checkingId,
			todayIso: plan.startDate,
		});
	}, [projection.movements, checkingId, plan.startDate]);
	const fixedDerived = useMemo(() => {
		if (!checkingId)
			return { total: 0, start: plan.startDate, end: plan.startDate };
		return nextMonthObligations({
			movements: projection.movements,
			checkingId,
			todayIso: plan.startDate,
		});
	}, [projection.movements, checkingId, plan.startDate]);
	const paycheckDerived = useMemo(() => {
		if (!checkingId) return null;
		return nextPaycheck({
			movements: projection.movements,
			checkingId,
			todayIso: plan.startDate,
		});
	}, [projection.movements, checkingId, plan.startDate]);

	const mandatoryThisMonth = useMemo(() => {
		if (!checkingId) return [];
		const today = plan.startDate.slice(0, 10);
		return groupMandatorySpending({
			movements: projection.movements,
			checkingId,
			start: shiftDate({ date: today, days: 1 }),
			end: remainingDerived.monthEnd,
		});
	}, [
		projection.movements,
		checkingId,
		plan.startDate,
		remainingDerived.monthEnd,
	]);
	const mandatoryNextMonth = useMemo(() => {
		if (!checkingId) return [];
		return groupMandatorySpending({
			movements: projection.movements,
			checkingId,
			start: fixedDerived.start,
			end: fixedDerived.end,
		});
	}, [projection.movements, checkingId, fixedDerived.start, fixedDerived.end]);

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
	const scheduledRest = perAccount.reduce(
		(sum, item) => sum + item.scheduled,
		0,
	);
	const groups = perAccount
		.flatMap((item) => item.groups)
		.sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));

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
	const daily = dailyAllowance({
		budget,
		spent,
		daysLeft: cycle.daysLeft,
	});
	const progress = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;

	const updateSettings = (next: Partial<TotalCycleSettings>) => {
		setSettings((previous) => ({
			statementDay: next.statementDay ?? previous.statementDay,
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
		}));
	};

	const resetConfig = (
		key: "paycheck" | "fixed" | "spent" | "checking" | "remaining",
	) => {
		updateSettings({ [`${key}Override`]: null } as Partial<TotalCycleSettings>);
	};

	const toggleAccount = (accountId: string) => {
		const explicit = settings.accountIds ?? cards.map((card) => card.id);
		const next = explicit.includes(accountId)
			? explicit.filter((id) => id !== accountId)
			: [...explicit, accountId];
		updateSettings({ accountIds: next.length ? next : null });
	};

	const accountLabel =
		trackedCards.length === cards.length
			? `All ${cards.length} cards`
			: trackedCards.map((card) => card.name).join(", ");

	return (
		<section className="timing-preview" aria-label="Total card cycle">
			<div className="section-top">
				<h2>
					<CalendarDays size={18} />
					Total card cycle
				</h2>
				<Badge tone="outline">Card timing</Badge>
			</div>
			<p className="cycle-dates">
				{dateLabel(cycle.cycleStart, true)} to {dateLabel(cycle.cycleEnd, true)}{" "}
				· {cycle.daysLeft} {cycle.daysLeft === 1 ? "day" : "days"} left ·{" "}
				{accountLabel}
			</p>
			<div className="timing-figures">
				<div>
					<span>Cash cushion</span>
					<strong>{money(cushion)}</strong>
				</div>
				<div>
					<span>Daily allowance</span>
					<strong>{money(Math.max(0, daily))}</strong>
				</div>
			</div>
			<div className="cycle-remaining">
				<div>
					<span>{allowance >= 0 ? "Left to spend" : "Over budget by"}</span>
					<strong>{money(Math.abs(allowance))}</strong>
				</div>
				<div>
					<span>Mandatory bills left</span>
					<strong>{money(remainingObligations)}</strong>
				</div>
			</div>
			<div className="cycle-progress">
				<Progress
					value={progress}
					label="Total cycle spending"
					tone={allowance < 0 ? "amber" : "green"}
				/>
				<p>
					{budget > 0 ? (
						<>
							{money(spent)} of {money(budget)} used
						</>
					) : (
						"Enter your expected paycheck to track daily room to spend."
					)}
				</p>
			</div>
			<div className="cycle-actions">
				<button
					type="button"
					className="text-button"
					onClick={() => setDetail("mandatory")}
				>
					Mandatory spending ({money(fixedObligations)} next month)
				</button>
				<button
					type="button"
					className="text-button"
					onClick={() => setDetail("cycle")}
				>
					{`Where the cycle went (${groups.length})`}
				</button>
				<button
					type="button"
					className="text-button"
					onClick={() => setDetail("configure")}
				>
					Configure cycle
				</button>
			</div>
			{detail && (
				<TimingDetailDialog
					eyebrow={`${dateLabel(cycle.cycleStart, true)} to ${dateLabel(cycle.cycleEnd, true)} · ${accountLabel}`}
					thisMonth={{
						title: "Due before month-end",
						subtitle: `${dateLabel(plan.startDate, true)} to ${dateLabel(remainingDerived.monthEnd, true)}`,
						total: remainingObligations,
						groups: mandatoryThisMonth,
					}}
					nextMonth={{
						title: "Next month fixed",
						subtitle: `${dateLabel(fixedDerived.start, true)} to ${dateLabel(fixedDerived.end, true)}`,
						total: fixedObligations,
						groups: mandatoryNextMonth,
					}}
					cycleGroups={groups}
					cycleSummary={`${money(spent)} of ${money(budget)} used · paycheck ${money(paycheck)} − fixed ${money(fixedObligations)} − reserve ${money(settings.reserve)}${scheduledRest > 0 ? ` · ${money(scheduledRest)} scheduled before ${dateLabel(cycle.cycleEnd, true)}` : ""}`}
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
