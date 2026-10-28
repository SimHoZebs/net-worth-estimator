import { useEffect, useMemo, useState } from "react";
import { updateEvaluation } from "@/api/generated/endpoints.ts";
import type { JsonValue } from "@/api/contracts.ts";
import { AccountToggle } from "@/components/AccountToggle.tsx";
import { InputField } from "@/components/Field.tsx";
import { finite, isRecord } from "@/domain/guards.ts";
import { TogglePill } from "@/pages/outlook/safe-spending/TogglePill.tsx";
import {
	reloadWorkspace,
	useServerModel,
	useServerStatus,
} from "@/state/workspaceResources.ts";

function numberConfig(
	config: Record<string, unknown>,
	key: string,
	fallback: number,
): number {
	const value = finite(config[key]);
	return value === null ? fallback : value;
}

function sourcesList(
	config: Record<string, unknown>,
): Record<string, unknown>[] {
	return Array.isArray(config.sources) ? config.sources.filter(isRecord) : [];
}

function selectedAssets(sources: Record<string, unknown>[]): Set<string> {
	const ids = new Set<string>();
	for (const source of sources) {
		if (source.type === "asset" && source.included === true) {
			const id = typeof source.accountId === "string" ? source.accountId : null;
			if (id) ids.add(id);
		}
	}
	return ids;
}

function selectedIncome(sources: Record<string, unknown>[]): Set<string> {
	const ids = new Set<string>();
	for (const source of sources) {
		if (source.type === "cashflow" && source.included === true) {
			const id = typeof source.postingId === "string" ? source.postingId : null;
			if (id) ids.add(id);
		}
	}
	return ids;
}

export function fiConfigureState(config: JsonValue | undefined) {
	const raw = isRecord(config) ? config : {};
	return {
		minimum: numberConfig(raw, "minimumNetWorth", 0),
		years: Math.max(
			1,
			Math.min(50, Math.trunc(numberConfig(raw, "evaluationYears", 10)) || 10),
		),
		assets: selectedAssets(sourcesList(raw)),
		income: selectedIncome(sourcesList(raw)),
		raw,
	};
}

export function buildFiConfig(
	raw: Record<string, unknown>,
	next: {
		minimum: number;
		years: number;
		assets: Set<string>;
		income: Set<string>;
	},
): Record<string, unknown> {
	const previous = sourcesList(raw);
	const overrides = new Map<string, unknown>();
	for (const source of previous) {
		if (
			source.type === "asset" &&
			typeof source.accountId === "string" &&
			source.withdrawalRateOverride !== undefined
		) {
			overrides.set(source.accountId, source.withdrawalRateOverride);
		}
	}
	const sources: Record<string, unknown>[] = [];
	for (const accountId of [...next.assets].sort()) {
		const override = overrides.get(accountId);
		sources.push(
			override === undefined
				? { type: "asset", accountId, included: true }
				: {
						type: "asset",
						accountId,
						included: true,
						withdrawalRateOverride: override,
					},
		);
	}
	for (const postingId of [...next.income].sort()) {
		sources.push({ type: "cashflow", postingId, included: true });
	}
	return {
		...raw,
		minimumNetWorth: next.minimum,
		evaluationYears: next.years,
		sources,
	};
}

/** Editable minimum, test duration, and funding sources for one FI evaluation. */
export function IndependenceConfigure({ instanceId }: { instanceId: string }) {
	const document = useServerModel().data?.document ?? null;
	const readOnly = useServerStatus().data?.readOnly ?? false;
	const row = useMemo(
		() =>
			document?.evaluations.financialIndependence.find(
				(item) => item.instanceId === instanceId,
			) ?? null,
		[document, instanceId],
	);
	const accounts = useMemo(() => document?.accounts ?? [], [document]);
	const incomeCandidates = useMemo(() => {
		const postings = (document?.postings ?? []).map((posting) => ({
			id: posting.id,
			name: posting.name,
			detail: "One-time",
		}));
		const rules = (document?.recurrenceRules ?? []).map((rule) => ({
			id: rule.id,
			name: rule.name,
			detail: "Recurring",
		}));
		const seen = new Set<string>();
		return [...postings, ...rules].filter((item) =>
			seen.has(item.id) ? false : (seen.add(item.id), true),
		);
	}, [document]);

	const initial = useMemo(
		() => fiConfigureState(row?.config),
		// Reset when a different evaluation or a saved config arrives.
		// oxlint-disable-next-line react/exhaustive-deps
		[instanceId, JSON.stringify(row?.config ?? null)],
	);
	const [minimum, setMinimum] = useState(initial.minimum);
	const [years, setYears] = useState(initial.years);
	const [assets, setAssets] = useState(initial.assets);
	const [income, setIncome] = useState(initial.income);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		setMinimum(initial.minimum);
		setYears(initial.years);
		setAssets(initial.assets);
		setIncome(initial.income);
		setSaved(false);
		setError(null);
	}, [initial]);

	if (!row) {
		return <p className="m-0 text-xs text-muted">Configuration unavailable.</p>;
	}

	const toggleAsset = (accountId: string) => {
		setSaved(false);
		setAssets((previous) => {
			const next = new Set(previous);
			if (next.has(accountId)) next.delete(accountId);
			else next.add(accountId);
			return next;
		});
	};
	const toggleIncome = (postingId: string) => {
		setSaved(false);
		setIncome((previous) => {
			const next = new Set(previous);
			if (next.has(postingId)) next.delete(postingId);
			else next.add(postingId);
			return next;
		});
	};

	const onSave = async () => {
		setSaving(true);
		setError(null);
		setSaved(false);
		try {
			const config = buildFiConfig(initial.raw, {
				minimum: Math.max(0, minimum),
				years: Math.max(1, Math.min(50, Math.trunc(years) || 1)),
				assets,
				income,
			});
			await updateEvaluation(instanceId, {
				name: row.name,
				enabled: row.enabled,
				type: "financialIndependence",
				config,
			});
			await reloadWorkspace();
			setSaved(true);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "The configuration could not be saved.",
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="grid gap-3">
			<div className="grid gap-3 sm:grid-cols-2">
				<InputField
					label="Minimum net worth ($)"
					type="number"
					min={0}
					step="1000"
					value={minimum}
					disabled={saving || readOnly}
					onChange={(event) => {
						setSaved(false);
						setMinimum(Math.max(0, Number(event.target.value) || 0));
					}}
				/>
				<InputField
					label="Spending test duration (years)"
					type="number"
					min={1}
					max={50}
					step="1"
					value={years}
					disabled={saving || readOnly}
					onChange={(event) => {
						setSaved(false);
						setYears(Number(event.target.value) || 1);
					}}
				/>
			</div>
			<fieldset className="grid gap-2">
				<legend className="m-0 p-0 text-xs font-semibold text-muted">
					Funding accounts
				</legend>
				{accounts.length ? (
					<div className="flex flex-wrap gap-2">
						{accounts.map((account) => (
							<AccountToggle
								key={account.id}
								account={account}
								checked={assets.has(account.id)}
								disabled={saving || readOnly}
								onToggle={() => toggleAsset(account.id)}
							/>
						))}
					</div>
				) : (
					<p className="m-0 text-xs text-muted">No accounts available.</p>
				)}
			</fieldset>
			<fieldset className="grid gap-2" disabled={saving || readOnly}>
				<legend className="m-0 p-0 text-xs font-semibold text-muted">
					Funding income
				</legend>
				{incomeCandidates.length ? (
					<div className="flex flex-wrap gap-2">
						{incomeCandidates.map((item) => (
							<span
								key={item.id}
								className={saving || readOnly ? "opacity-50" : ""}
							>
								<TogglePill
									name={item.name || item.id}
									detail={item.detail}
									checked={income.has(item.id)}
									onToggle={() => toggleIncome(item.id)}
								/>
							</span>
						))}
					</div>
				) : (
					<p className="m-0 text-xs text-muted">No income sources available.</p>
				)}
			</fieldset>
			<div className="flex flex-wrap items-center gap-3">
				<button
					type="button"
					disabled={saving || readOnly}
					onClick={onSave}
					className="rounded-control border border-line-strong bg-surface px-3 py-2 text-xs font-semibold text-success-text hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
				>
					{saving ? "Saving…" : "Save configuration"}
				</button>
				{saved && (
					<p className="m-0 text-xs text-success-text" role="status">
						Saved. Updating projection…
					</p>
				)}
				{error && (
					<p className="m-0 text-xs text-danger-text" role="alert">
						{error}
					</p>
				)}
				{readOnly && (
					<p className="m-0 text-xs text-muted">
						Read-only mode blocks configuration changes.
					</p>
				)}
			</div>
		</div>
	);
}
