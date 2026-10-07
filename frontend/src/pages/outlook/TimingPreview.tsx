import { CalendarDays, ChevronDown } from "lucide-react";
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
import { dateLabel, money } from "../../domain/format.ts";
import type { Plan } from "../../domain/model.ts";
import type { Projection } from "../../domain/result.ts";

const STORAGE_KEY = "nwe.card-cycle.v2";

interface TotalCycleSettings {
	statementDay: number;
	budget: number;
	spentOverride: number | null;
	/** Null means every debt account counts toward the total. */
	accountIds: string[] | null;
}

const defaultSettings = (): TotalCycleSettings => ({
	statementDay: 1,
	budget: 0,
	spentOverride: null,
	accountIds: null,
});

function loadPersisted(): TotalCycleSettings {
	if (typeof window === "undefined" || !window.localStorage)
		return defaultSettings();
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return defaultSettings();
		const parsed = JSON.parse(raw) as Partial<TotalCycleSettings>;
		if (typeof parsed !== "object" || parsed === null) return defaultSettings();
		const rawOverride = parsed.spentOverride as unknown;
		const accountIds = Array.isArray(parsed.accountIds)
			? parsed.accountIds.filter(
					(id): id is string => typeof id === "string" && id !== "",
				)
			: null;
		return {
			statementDay: Math.min(
				28,
				Math.max(1, Math.floor(Number(parsed.statementDay) || 1)),
			),
			budget: Math.max(0, Number(parsed.budget) || 0),
			spentOverride:
				rawOverride === null || rawOverride === undefined || rawOverride === ""
					? null
					: Math.max(0, Number(rawOverride) || 0),
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
	const [expanded, setExpanded] = useState(false);
	const [configOpen, setConfigOpen] = useState(false);

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
	const spent = settings.spentOverride ?? derivedSpent;
	const remaining = settings.budget - spent;
	const daily = dailyAllowance({
		budget: settings.budget,
		spent,
		daysLeft: cycle.daysLeft,
	});
	const progress =
		settings.budget > 0 ? Math.min(100, (spent / settings.budget) * 100) : 0;

	const updateSettings = (next: Partial<TotalCycleSettings>) => {
		setSettings((previous) => ({
			statementDay: next.statementDay ?? previous.statementDay,
			budget: next.budget ?? previous.budget,
			spentOverride:
				next.spentOverride !== undefined
					? next.spentOverride
					: previous.spentOverride,
			accountIds:
				next.accountIds !== undefined ? next.accountIds : previous.accountIds,
		}));
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
					<span>Set aside for cycle</span>
					<strong>{money(settings.budget)}</strong>
				</div>
				<div>
					<span>Spent so far</span>
					<strong>{money(spent)}</strong>
				</div>
			</div>
			<div className="cycle-remaining">
				<div>
					<span>{remaining >= 0 ? "Left to spend" : "Over budget by"}</span>
					<strong>{money(Math.abs(remaining))}</strong>
				</div>
				<div>
					<span>Daily allowance</span>
					<strong>{money(Math.max(0, daily))}</strong>
				</div>
			</div>
			<div className="cycle-progress">
				<Progress
					value={progress}
					label="Total cycle spending"
					tone={remaining < 0 ? "amber" : "green"}
				/>
				<p>
					{settings.budget > 0 ? (
						<>
							{money(spent)} of {money(settings.budget)} used
							{scheduledRest > 0
								? ` · ${money(scheduledRest)} scheduled before ${dateLabel(cycle.cycleEnd, true)}`
								: ""}
						</>
					) : (
						"Set a total cycle budget to track daily room to spend."
					)}
				</p>
			</div>
			<div className="cycle-actions">
				<button
					type="button"
					className="text-button"
					aria-expanded={expanded}
					onClick={() => setExpanded((value) => !value)}
				>
					<ChevronDown
						size={15}
						style={{
							transform: expanded ? "rotate(180deg)" : undefined,
							transition: "transform 0.15s",
						}}
					/>
					{expanded
						? "Hide cycle breakdown"
						: `Where the cycle went (${groups.length})`}
				</button>
				<button
					type="button"
					className="text-button"
					aria-expanded={configOpen}
					onClick={() => setConfigOpen((value) => !value)}
				>
					Configure cycle
				</button>
			</div>
			{configOpen && (
				<div className="cycle-config">
					<label className="field">
						<span>Statement starts on day (1–28)</span>
						<input
							type="number"
							min={1}
							max={28}
							value={settings.statementDay}
							onChange={(event) =>
								updateSettings({
									statementDay: Math.min(
										28,
										Math.max(1, Math.floor(Number(event.target.value) || 1)),
									),
								})
							}
						/>
					</label>
					<label className="field">
						<span>Total set aside for cycle ($)</span>
						<input
							type="number"
							min={0}
							step="10"
							value={settings.budget}
							onChange={(event) =>
								updateSettings({
									budget: Math.max(0, Number(event.target.value) || 0),
								})
							}
						/>
					</label>
					<label className="field">
						<span>
							Actual spent ($) — empty uses {money(derivedSpent)} tracked
						</span>
						<input
							type="number"
							min={0}
							step="1"
							placeholder={String(Math.round(derivedSpent))}
							value={settings.spentOverride ?? ""}
							onChange={(event) =>
								updateSettings({
									spentOverride:
										event.target.value === ""
											? null
											: Math.max(0, Number(event.target.value) || 0),
								})
							}
						/>
					</label>
					{settings.spentOverride !== null && (
						<button
							type="button"
							className="text-button"
							onClick={() => updateSettings({ spentOverride: null })}
						>
							Use tracked {money(derivedSpent)} instead
						</button>
					)}
					<fieldset className="cycle-accounts">
						<legend>Accounts in this total</legend>
						{cards.map((card) => {
							const checked = trackedIds.includes(card.id);
							return (
								<label key={card.id} className="cycle-account-option">
									<input
										type="checkbox"
										checked={checked}
										onChange={() => toggleAccount(card.id)}
									/>
									<span>{card.name}</span>
								</label>
							);
						})}
					</fieldset>
				</div>
			)}
			{expanded && (
				<div className="cycle-breakdown">
					{groups.length ? (
						<ul>
							{groups.map((group) => (
								<li key={`${group.accountId}-${group.key}`}>
									<span>
										<strong>{group.name}</strong>
										<small>
											{group.accountName} · {group.counterparty} · {group.count}{" "}
											{group.count === 1 ? "charge" : "charges"}
										</small>
									</span>
									<strong>{money(group.total)}</strong>
								</li>
							))}
						</ul>
					) : (
						<p>
							No charges in this cycle yet. Tracked spend covers{" "}
							{dateLabel(cycle.cycleStart, true)} through{" "}
							{dateLabel(plan.startDate, true)}.
						</p>
					)}
				</div>
			)}
		</section>
	);
}
