import { useState } from "react";
import { Tabs } from "../../components/Tabs.tsx";
import { Modal, Progress } from "../../components/ui.tsx";
import type { CycleSpendGroup } from "../../domain/cardCycle.ts";
import { dateLabel, money } from "../../domain/format.ts";
import type { MandatorySpendingGroup } from "../../domain/householdTiming.ts";

export type TimingDetailTab = "mandatory" | "cycle" | "configure";

export interface TimingMandatorySection {
	title: string;
	subtitle: string;
	total: number;
	groups: MandatorySpendingGroup[];
}

export interface TimingCycleGroup extends CycleSpendGroup {
	accountId: string;
	accountName: string;
}

export interface TimingConfigHints {
	statementDay: number;
	reserve: number;
	spentOverride: number | null;
	paycheckOverride: number | null;
	fixedOverride: number | null;
	checkingOverride: number | null;
	remainingOverride: number | null;
	paycheckHint: { date: string; amount: number } | null;
	fixedHint: { total: number; start: string; end: string };
	checkingHint: number | null;
	remainingHint: { total: number; monthEnd: string };
	spentHint: number;
	cards: { id: string; name: string }[];
	trackedIds: string[];
}

function MandatorySectionView({
	section,
}: {
	section: TimingMandatorySection;
}) {
	if (!section.groups.length) {
		return (
			<div className="cycle-breakdown">
				<p>No mandatory spending projected for this period.</p>
			</div>
		);
	}
	return (
		<div>
			<p className="section-note">
				{section.subtitle} · <strong>{money(section.total)}</strong>
			</p>
			<ul className="mandatory-list">
				{section.groups.map((group) => {
					const share =
						section.total > 0 ? (group.total / section.total) * 100 : 0;
					const when =
						group.dates.length === 1
							? dateLabel(group.dates[0]!, true)
							: `${dateLabel(group.dates[0]!, true)} → ${dateLabel(group.dates[group.dates.length - 1]!, true)}`;
					return (
						<li key={group.movementId}>
							<div className="mandatory-row">
								<span>
									<strong>{group.name}</strong>
									<small>
										{when} · {group.count}{" "}
										{group.count === 1 ? "charge" : "charges"}
									</small>
								</span>
								<strong>{money(group.total)}</strong>
							</div>
							<Progress
								value={share}
								label={`${group.name} share of ${section.title}`}
								tone="green"
							/>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

export function TimingDetailDialog({
	eyebrow,
	thisMonth,
	nextMonth,
	cycleGroups,
	cycleSummary,
	config,
	onToggleAccount,
	onUpdateConfig,
	onResetConfig,
	initialTab,
	onClose,
}: {
	eyebrow: string;
	thisMonth: TimingMandatorySection;
	nextMonth: TimingMandatorySection;
	cycleGroups: TimingCycleGroup[];
	cycleSummary: string;
	config: TimingConfigHints;
	onToggleAccount: (accountId: string) => void;
	onUpdateConfig: (next: {
		statementDay?: number;
		reserve?: number;
		spentOverride?: number | null;
		paycheckOverride?: number | null;
		fixedOverride?: number | null;
		checkingOverride?: number | null;
		remainingOverride?: number | null;
		accountIds?: string[] | null;
	}) => void;
	onResetConfig: (
		key: "paycheck" | "fixed" | "spent" | "checking" | "remaining",
	) => void;
	initialTab: TimingDetailTab;
	onClose: () => void;
}) {
	const [tab, setTab] = useState<TimingDetailTab>(initialTab);
	return (
		<Modal
			title="Timing detail"
			eyebrow={eyebrow}
			onClose={onClose}
			className="modal-drawer"
		>
			<Tabs
				items={[
					{ id: "mandatory", label: "Mandatory spending" },
					{ id: "cycle", label: "Cycle breakdown", count: cycleGroups.length },
					{ id: "configure", label: "Configure" },
				]}
				value={tab}
				onChange={setTab}
				label="Timing detail view"
				className="account-view-tabs"
			>
				{tab === "mandatory" ? (
					<div className="timing-mandatory">
						<h3>{thisMonth.title}</h3>
						<MandatorySectionView section={thisMonth} />
						<h3>{nextMonth.title}</h3>
						<MandatorySectionView section={nextMonth} />
						<p className="section-note">
							Mandatory spending leaves checking. Card charges do not appear
							here; they are budgeted against your next paycheck in the cycle
							allowance.
						</p>
					</div>
				) : tab === "cycle" ? (
					<div className="cycle-breakdown">
						<p className="section-note">{cycleSummary}</p>
						{cycleGroups.length ? (
							<ul>
								{cycleGroups.map((group) => (
									<li key={`${group.accountId}-${group.key}`}>
										<span>
											<strong>{group.name}</strong>
											<small>
												{group.accountName} · {group.counterparty} ·{" "}
												{group.count} {group.count === 1 ? "charge" : "charges"}
											</small>
										</span>
										<strong>{money(group.total)}</strong>
									</li>
								))}
							</ul>
						) : (
							<p>No charges in this cycle yet.</p>
						)}
					</div>
				) : (
					<div className="cycle-config">
						<label className="field">
							<span>Statement starts on day (1–28)</span>
							<input
								type="number"
								min={1}
								max={28}
								value={config.statementDay}
								onChange={(event) =>
									onUpdateConfig({
										statementDay: Math.min(
											28,
											Math.max(1, Math.floor(Number(event.target.value) || 20)),
										),
									})
								}
							/>
						</label>
						<label className="field">
							<span>
								Expected next paycheck ($) —{" "}
								{config.paycheckHint
									? `${money(config.paycheckHint.amount)} on ${dateLabel(config.paycheckHint.date, true)}`
									: "no upcoming inflow in projection"}
							</span>
							<input
								type="number"
								min={0}
								step="10"
								placeholder={String(
									Math.round(config.paycheckHint?.amount ?? 0),
								)}
								value={config.paycheckOverride ?? ""}
								onChange={(event) =>
									onUpdateConfig({
										paycheckOverride:
											event.target.value === ""
												? null
												: Math.max(0, Number(event.target.value) || 0),
									})
								}
							/>
						</label>
						{config.paycheckOverride !== null && (
							<button
								type="button"
								className="text-button"
								onClick={() => onResetConfig("paycheck")}
							>
								Use projected {money(config.paycheckHint?.amount ?? 0)} instead
							</button>
						)}
						<label className="field">
							<span>
								Next month fixed obligations ($) —{" "}
								{money(config.fixedHint.total)} for{" "}
								{dateLabel(config.fixedHint.start, true)} to{" "}
								{dateLabel(config.fixedHint.end, true)}
							</span>
							<input
								type="number"
								min={0}
								step="10"
								placeholder={String(Math.round(config.fixedHint.total))}
								value={config.fixedOverride ?? ""}
								onChange={(event) =>
									onUpdateConfig({
										fixedOverride:
											event.target.value === ""
												? null
												: Math.max(0, Number(event.target.value) || 0),
									})
								}
							/>
						</label>
						{config.fixedOverride !== null && (
							<button
								type="button"
								className="text-button"
								onClick={() => onResetConfig("fixed")}
							>
								Use projected {money(config.fixedHint.total)} instead
							</button>
						)}
						<label className="field">
							<span>Protected reserve ($)</span>
							<input
								type="number"
								min={0}
								step="5"
								value={config.reserve}
								onChange={(event) =>
									onUpdateConfig({
										reserve: Math.max(0, Number(event.target.value) || 0),
									})
								}
							/>
						</label>
						<label className="field">
							<span>
								Actual spent ($) — empty uses {money(config.spentHint)} tracked
							</span>
							<input
								type="number"
								min={0}
								step="1"
								placeholder={String(Math.round(config.spentHint))}
								value={config.spentOverride ?? ""}
								onChange={(event) =>
									onUpdateConfig({
										spentOverride:
											event.target.value === ""
												? null
												: Math.max(0, Number(event.target.value) || 0),
									})
								}
							/>
						</label>
						{config.spentOverride !== null && (
							<button
								type="button"
								className="text-button"
								onClick={() => onResetConfig("spent")}
							>
								Use tracked {money(config.spentHint)} instead
							</button>
						)}
						<label className="field">
							<span>
								Checking balance ($) — {money(config.checkingHint ?? 0)} in plan
							</span>
							<input
								type="number"
								min={0}
								step="10"
								placeholder={String(Math.round(config.checkingHint ?? 0))}
								value={config.checkingOverride ?? ""}
								onChange={(event) =>
									onUpdateConfig({
										checkingOverride:
											event.target.value === ""
												? null
												: Math.max(0, Number(event.target.value) || 0),
									})
								}
							/>
						</label>
						{config.checkingOverride !== null && (
							<button
								type="button"
								className="text-button"
								onClick={() => onResetConfig("checking")}
							>
								Use plan {money(config.checkingHint ?? 0)} instead
							</button>
						)}
						<label className="field">
							<span>
								Remaining bills this month ($) —{" "}
								{money(config.remainingHint.total)} through{" "}
								{dateLabel(config.remainingHint.monthEnd, true)}
							</span>
							<input
								type="number"
								min={0}
								step="10"
								placeholder={String(Math.round(config.remainingHint.total))}
								value={config.remainingOverride ?? ""}
								onChange={(event) =>
									onUpdateConfig({
										remainingOverride:
											event.target.value === ""
												? null
												: Math.max(0, Number(event.target.value) || 0),
									})
								}
							/>
						</label>
						{config.remainingOverride !== null && (
							<button
								type="button"
								className="text-button"
								onClick={() => onResetConfig("remaining")}
							>
								Use projected {money(config.remainingHint.total)} instead
							</button>
						)}
						<fieldset className="cycle-accounts">
							<legend>Accounts in this total</legend>
							{config.cards.map((card) => {
								const checked = config.trackedIds.includes(card.id);
								return (
									<label key={card.id} className="cycle-account-option">
										<input
											type="checkbox"
											checked={checked}
											onChange={() => onToggleAccount(card.id)}
										/>
										<span>{card.name}</span>
									</label>
								);
							})}
						</fieldset>
					</div>
				)}
			</Tabs>
		</Modal>
	);
}
