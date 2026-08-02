import { useCallback, useEffect, useState } from "react";
import { useBeforeUnload, useBlocker } from "react-router-dom";
import { EvaluationSettings } from "@/components/evaluations/EvaluationSettings";
import { StochasticControls } from "@/components/StochasticControls";
import { ModelAssumptionsCard } from "@/components/sidebar/ModelAssumptionsCard";
import { SimulationSettingsCard } from "@/components/sidebar/SimulationSettingsCard";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { useModelRuntime } from "@/runtime/modelRuntime";
import { useStore } from "@/store";

export function SettingsPage() {
	const model = useModelRuntime();
	const [dirtyDrafts, setDirtyDrafts] = useState<ReadonlySet<string>>(
		new Set(),
	);
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
				className="space-y-8"
				inert={blocker.state === "blocked" ? true : undefined}
			>
				<div>
					<div className="type-eyebrow text-primary">
						Projection configuration
					</div>
					<h1 className="mt-1 type-title text-3xl">Settings</h1>
					<p className="mt-1 max-w-2xl type-muted">
						Configure the simulation, evaluations, uncertainty analysis, and
						appearance. Projection settings remain session-only.
					</p>
				</div>

				{model.loadError && !model.document ? (
					<Card className="border-destructive/30">
						<CardHeader>
							<CardTitle>Financial model could not be loaded</CardTitle>
							<CardDescription>{model.loadError}</CardDescription>
						</CardHeader>
						<CardContent>
							<Button type="button" size="sm" onClick={model.reload}>
								Retry loading
							</Button>
						</CardContent>
					</Card>
				) : model.document ? (
					<>
						<div className="grid items-start gap-6 lg:grid-cols-2">
							<SimulationSettingsCard />
							<div className="space-y-6">
								<StochasticControls />
								<AppearanceSettings />
							</div>
						</div>
						<EvaluationSettings onDraftDirtyChange={handleDraftDirtyChange} />
						<div className="max-w-2xl">
							<ModelAssumptionsCard />
						</div>
					</>
				) : (
					<Card>
						<CardContent className="p-6 type-muted">
							Settings will be available after the financial model loads.
						</CardContent>
					</Card>
				)}
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
	const theme = useStore((state) => state.theme);
	const setTheme = useStore((state) => state.setTheme);
	return (
		<Card className="rounded-[1.4rem] border-border/80">
			<CardHeader>
				<CardTitle>Appearance</CardTitle>
				<CardDescription>
					Choose how the workspace follows your display.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<fieldset className="grid grid-cols-3 gap-2">
					<legend className="sr-only">Color theme</legend>
					{(["light", "dark", "system"] as const).map((option) => (
						<button
							key={option}
							type="button"
							aria-pressed={theme === option}
							onClick={() => setTheme(option)}
							className={`rounded-xl border px-3 py-2 text-sm font-semibold capitalize transition ${theme === option ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-muted-foreground hover:border-ring hover:text-foreground"}`}
						>
							{option}
						</button>
					))}
				</fieldset>
			</CardContent>
		</Card>
	);
}
