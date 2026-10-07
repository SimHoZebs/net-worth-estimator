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

const STORAGE_KEY = "nwe.card-cycle.v1";

interface AccountCycleSettings {
	statementDay: number;
	budget: number;
	spentOverride: number | null;
}

interface PersistedCycleState {
	selectedId: string | null;
	settings: Record<string, AccountCycleSettings>;
}

const defaultSettings = (): AccountCycleSettings => ({
	statementDay: 1,
	budget: 0,
	spentOverride: null,
});

function loadPersisted(): PersistedCycleState {
	if (typeof window === "undefined" || !window.localStorage)
		return { selectedId: null, settings: {} };
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return { selectedId: null, settings: {} };
		const parsed = JSON.parse(raw) as Partial<PersistedCycleState>;
		if (typeof parsed !== "object" || parsed === null)
			return { selectedId: null, settings: {} };
		const settings: Record<string, AccountCycleSettings> = {};
		for (const [key, value] of Object.entries(parsed.settings ?? {})) {
			if (typeof value !== "object" || value === null) continue;
			const entry = value as Partial<AccountCycleSettings> & {
				spentOverride?: number | null | string | undefined;
			};
			const rawOverride = entry.spentOverride as unknown;
			settings[key] = {
				statementDay: Math.min(
					28,
					Math.max(1, Math.floor(Number(entry.statementDay) || 1)),
				),
				budget: Math.max(0, Number(entry.budget) || 0),
				spentOverride:
					rawOverride === null ||
					rawOverride === undefined ||
					rawOverride === ""
						? null
						: Math.max(0, Number(rawOverride) || 0),
			};
		}
		return {
			selectedId:
				typeof parsed.selectedId === "string" ? parsed.selectedId : null,
			settings,
		};
	} catch {
		return { selectedId: null, settings: {} };
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
	const [persisted, setPersisted] =
		useState<PersistedCycleState>(loadPersisted);
	const [expanded, setExpanded] = useState(false);
	const [configOpen, setConfigOpen] = useState(false);

	const selectedId = useMemo(() => {
		if (
			persisted.selectedId &&
			cards.some((card) => card.id === persisted.selectedId)
		)
			return persisted.selectedId;
		return cards[0]?.id ?? null;
	}, [persisted.selectedId, cards]);

	const settings = useMemo<AccountCycleSettings>(
		() =>
			selectedId
				? (persisted.settings[selectedId] ?? defaultSettings())
				: defaultSettings(),
		[selectedId, persisted.settings],
	);

	useEffect(() => {
		if (typeof window === "undefined" || !window.localStorage) return;
		try {
			window.localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ selectedId, settings: persisted.settings }),
			);
		} catch {
			// Storage is best-effort; the tracker still works for this session.
		}
	}, [selectedId, persisted.settings]);

	const selectedCard = cards.find((card) => card.id === selectedId) ?? null;

	const transactions = useMemo(
		() =>
			selectedId
				? accountTransactions({ accountId: selectedId, plan, projection })
				: [],
		[selectedId, plan, projection],
	);

	const cycle = useMemo(
		() =>
			resolveStatementCycle({
				todayIso: plan.startDate,
				statementDay: settings.statementDay,
			}),
		[plan.startDate, settings.statementDay],
	);

	const derivedSpent = useMemo(
		() =>
			cycleSpentSoFar({
				transactions,
				cycleStart: cycle.cycleStart,
				todayIso: plan.startDate,
			}),
		[transactions, cycle.cycleStart, plan.startDate],
	);

	const scheduledRest = useMemo(
		() =>
			cycleScheduledRest({
				transactions,
				cycleEnd: cycle.cycleEnd,
				todayIso: plan.startDate,
			}),
		[transactions, cycle.cycleEnd, plan.startDate],
	);

	const groups = useMemo(
		() =>
			groupCycleSpending({
				transactions,
				cycleStart: cycle.cycleStart,
				todayIso: plan.startDate,
			}),
		[transactions, cycle.cycleStart, plan.startDate],
	);

	if (!selectedCard || !selectedId) {
		return (
			<section className="timing-preview" aria-label="Current card cycle">
				<div className="section-top">
					<h2>
						<CalendarDays size={18} />
						Current card cycle
					</h2>
					<Badge tone="outline">Card timing</Badge>
				</div>
				<p className="section-note">
					Add a debt account to track a card statement cycle here.
				</p>
			</section>
		);
	}

	const spent = settings.spentOverride ?? derivedSpent;
	const remaining = settings.budget - spent;
	const daily = dailyAllowance({
		budget: settings.budget,
		spent,
		daysLeft: cycle.daysLeft,
	});
	const progress =
		settings.budget > 0 ? Math.min(100, (spent / settings.budget) * 100) : 0;

	const updateSettings = (next: Partial<AccountCycleSettings>) => {
		setPersisted((previous) => ({
			selectedId,
			settings: {
				...previous.settings,
				[selectedId]: {
					statementDay: next.statementDay ?? settings.statementDay,
					budget: next.budget ?? settings.budget,
					spentOverride:
						next.spentOverride !== undefined
							? next.spentOverride
							: settings.spentOverride,
				},
			},
		}));
	};

	return (
		<section className="timing-preview" aria-label="Current card cycle">
			<div className="section-top">
				<h2>
					<CalendarDays size={18} />
					Current card cycle
				</h2>
				<Badge tone="outline">Card timing</Badge>
			</div>
			<div className="cycle-card-row">
				<label className="field cycle-card-select">
					<span>Card</span>
					<select
						value={selectedId}
						onChange={(event) =>
							setPersisted((previous) => ({
								selectedId: event.target.value,
								settings: previous.settings,
							}))
						}
						aria-label="Tracked card"
					>
						{cards.map((card) => (
							<option key={card.id} value={card.id}>
								{card.name}
							</option>
						))}
					</select>
				</label>
				<p className="cycle-dates">
					{dateLabel(cycle.cycleStart, true)} to{" "}
					{dateLabel(cycle.cycleEnd, true)} · {cycle.daysLeft}{" "}
					{cycle.daysLeft === 1 ? "day" : "days"} left
				</p>
			</div>
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
					label={`${selectedCard.name} cycle spending`}
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
						"Set a cycle budget to track daily room to spend."
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
						<span>Set aside for cycle ($)</span>
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
				</div>
			)}
			{expanded && (
				<div className="cycle-breakdown">
					{groups.length ? (
						<ul>
							{groups.map((group) => (
								<li key={group.key}>
									<span>
										<strong>{group.name}</strong>
										<small>
											{group.counterparty} · {group.count}{" "}
											{group.count === 1 ? "charge" : "charges"}
										</small>
									</span>
									<strong>{money(group.total)}</strong>
								</li>
							))}
						</ul>
					) : (
						<p>
							No {selectedCard.name} charges in this cycle yet. Tracked spend
							covers {dateLabel(cycle.cycleStart, true)} through{" "}
							{dateLabel(plan.startDate, true)}.
						</p>
					)}
				</div>
			)}
		</section>
	);
}
