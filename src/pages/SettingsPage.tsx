import { useCallback, useEffect, useState } from "react";
import { useBeforeUnload, useBlocker } from "react-router-dom";
import { BackendAccessCard } from "@/components/BackendAccessCard";
import { HouseholdCycleSettingsCard } from "@/components/dashboard/HouseholdCycleSettingsCard";
import { EvaluationSettings } from "@/components/evaluations/EvaluationSettings";
import { PageHeader, SectionCard } from "@/components/present/present";
import { StochasticControls } from "@/components/StochasticControls";
import { ModelAssumptionsCard } from "@/components/sidebar/ModelAssumptionsCard";
import { SimulationSettingsCard } from "@/components/sidebar/SimulationSettingsCard";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useModelRuntime } from "@/runtime/modelRuntime";
import { useThemeStore } from "@/themeStore";

export function SettingsPage() {
	const model = useModelRuntime();
	const [dirtyDrafts, setDirtyDrafts] = useState<ReadonlySet<string>>(
		new Set(),
	);
	// FI editors reset their drafts whenever the model reloads (their
	// revision includes dataUpdatedAt), so their dirty flags must reset too.
	// Threshold editors only reset when their own committed value changes,
	// which is already notified explicitly, so their flags are preserved.
	const [syncedDataUpdatedAt, setSyncedDataUpdatedAt] = useState(
		model.dataUpdatedAt,
	);
	if (syncedDataUpdatedAt !== model.dataUpdatedAt) {
		setSyncedDataUpdatedAt(model.dataUpdatedAt);
		setDirtyDrafts((current) => {
			const next = new Set(
				[...current].filter((key) => !key.startsWith("financialIndependence:")),
			);
			return next.size === current.size ? current : next;
		});
	}
	const hasDirtyDrafts = dirtyDrafts.size > 0;
	const blocker = useBlocker(hasDirtyDrafts);
	const handleDraftDirtyChange = useCallback((key: string, dirty: boolean) => {
		setDirtyDrafts((current) => {
			const alreadyMatches = current.has(key) === dirty;
			if (alreadyMatches) return current;
			const next = new Set(current);
			if (dirty) next.add(key);
			else next.delete(key);
			return next;
		});
	}, []);

	useBeforeUnload(
		useCallback(
			(event) => {
				if (!hasDirtyDrafts) return;
				event.preventDefault();
				event.returnValue = "";
			},
			[hasDirtyDrafts],
		),
	);

	useEffect(() => {
		const header = document.querySelector("header");
		if (blocker.state === "blocked" && header instanceof HTMLElement)
			header.inert = true;
		return () => {
			if (header instanceof HTMLElement) header.inert = false;
		};
	}, [blocker.state]);

	const stayOnSettings = useCallback(() => {
		blocker.reset?.();
	}, [blocker]);

	return (
		<>
			<main
				className="space-y-6"
				inert={blocker.state === "blocked" ? true : undefined}
			>
				<PageHeader
					eyebrow="Projection configuration"
					title="Settings"
					description="Session-only settings. Configure the simulation plan, uncertainty, goals, and appearance — changes apply instantly and are never written to the canonical model."
				/>

				{model.loadError && !model.document ? (
					<SectionCard
						title="Financial model could not be loaded"
						description={model.loadError}
						className="border-destructive/30"
					>
						<Button type="button" size="sm" onClick={model.reload}>
							Retry loading
						</Button>
					</SectionCard>
				) : model.document ? (
					<div className="space-y-6">
						<SimulationSettingsCard />
						<StochasticControls />
						<EvaluationSettings onDraftDirtyChange={handleDraftDirtyChange} />
						<HouseholdCycleSettingsCard
							document={model.effectiveDocument ?? model.document}
						/>
						<div className="max-w-2xl">
							<ModelAssumptionsCard />
						</div>
						<BackendAccessCard />
					</div>
				) : (
					<SectionCard contentClassName="p-6 type-muted">
						Settings will be available after the financial model loads.
					</SectionCard>
				)}
				<AppearanceSettings />
			</main>
			{blocker.state === "blocked" ? (
				<Dialog
					role="alertdialog"
					ariaLabelledby="discard-settings-title"
					ariaDescribedby="discard-settings-description"
					onClose={stayOnSettings}
					className="max-w-md rounded-[1.8rem] border border-border bg-card p-6 shadow-2xl"
				>
					<h2 id="discard-settings-title" className="type-title text-xl">
						Discard unapplied changes?
					</h2>
					<p id="discard-settings-description" className="mt-2 type-muted">
						One or more evaluation editors contain changes that have not been
						applied to the projection.
					</p>
					<div className="mt-6 flex justify-end gap-2">
						<Button type="button" variant="secondary" onClick={stayOnSettings}>
							Stay on Settings
						</Button>
						<Button type="button" onClick={() => blocker.proceed()}>
							Discard and leave
						</Button>
					</div>
				</Dialog>
			) : null}
		</>
	);
}

function AppearanceSettings() {
	const theme = useThemeStore((state) => state.theme);
	const setTheme = useThemeStore((state) => state.setTheme);
	return (
		<SectionCard
			title="Appearance"
			description="Choose how the workspace follows your display."
			className="rounded-[1.4rem] border-border/80"
		>
			<fieldset className="grid grid-cols-3 gap-2">
				<legend className="sr-only">Color theme</legend>
				{(["light", "dark", "system"] as const).map((option) => (
					<button
						key={option}
						type="button"
						aria-pressed={theme === option}
						onClick={() => setTheme(option)}
						className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold capitalize transition ${theme === option ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-muted-foreground hover:border-ring hover:text-foreground"}`}
					>
						{option}
					</button>
				))}
			</fieldset>
		</SectionCard>
	);
}
