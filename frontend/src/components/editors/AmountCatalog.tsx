import { useEffect, useState, type FormEvent } from "react";
import { ApiClient } from "../../api/client.ts";
import type { PostingAmountResolution } from "../../api/contracts.ts";
import {
	BUILT_IN_TEMPLATE_IDS,
	FALLBACK_INCOME_STEPS,
	FALLBACK_PROVIDERS,
	FALLBACK_RESOLVERS,
	FALLBACK_TEMPLATES,
	presetToTemplate,
} from "../../domain/amountCatalog.ts";
import { useWorkspaceStore } from "../../state/workspaceStore.ts";
import { InputField } from "../Field.tsx";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { ErrorNotice } from "../ui.tsx";
import { textValue } from "./formValues.ts";
import { AmountBuilder } from "./AmountBuilder.tsx";

function useRemoteNames() {
	const [remote, setRemote] = useState<{
		resolvers: { name: string; description?: string }[];
		providers: { name: string; description?: string }[];
		incomeSteps: { name: string; description?: string }[];
	} | null>(null);
	useEffect(() => {
		let cancelled = false;
		new ApiClient()
			.getAmountCatalog()
			.then((result) => {
				if (cancelled || result instanceof Error) return;
				setRemote({
					resolvers: result.resolvers ?? [],
					providers: result.providers ?? [],
					incomeSteps: result.incomeSteps ?? [],
				});
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);
	return remote;
}

type CopyEntry = { name: string; label?: string | null; summary?: string | null; description?: string | null };

// Frontend owns all human words. Backend names unknown here get a generic
// entry from the backend technical description.
function mergeCopy(
	local: CopyEntry[],
	remote: { name: string; description?: string }[],
) {
	const known = new Set(local.map((entry) => entry.name));
	const items = local.map((entry) => ({
		key: entry.name,
		title: entry.label ?? entry.name,
		text: entry.summary ?? entry.description ?? "",
	}));
	for (const entry of remote) {
		if (!known.has(entry.name)) {
			items.push({
				key: entry.name,
				title: entry.name,
				text: entry.description ?? "",
			});
		}
	}
	return items;
}

function CompactList({ items }: { items: { key: string; title: string; text: string }[] }) {
	return (
		<ul className="catalog-list">
			{items.map((item) => (
				<li key={item.key}>
					<strong>{item.title}</strong> — {item.text}
				</li>
			))}
		</ul>
	);
}

function slugify(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function AmountCatalog({
	accounts,
	postings,
	incomeSources,
	taxProfiles,
}: {
	accounts: { id: string; name: string }[];
	postings: { id: string; name: string }[];
	incomeSources: { id: string; name: string }[];
	taxProfiles: { id: string; name: string }[];
}) {
	const remote = useRemoteNames();
	const serverPresets = useWorkspaceStore((state) => state.serverPresets);
	const presetError = useWorkspaceStore((state) => state.presetError);
	const createPreset = useWorkspaceStore((state) => state.createPreset);
	const updatePreset = useWorkspaceStore((state) => state.updatePreset);
	const deletePreset = useWorkspaceStore((state) => state.deletePreset);
	const movePreset = useWorkspaceStore((state) => state.movePreset);
	const presetThunks = { createPreset, updatePreset, deletePreset, movePreset };
	const status = useWorkspaceStore((state) => state.status);
	const writeBlocked = useWorkspaceStore((state) => state.writeBlocked);
	const workspace = useWorkspaceStore((state) => state.workspace);
	const readOnly =
		(status?.readOnly ?? false) || writeBlocked || (workspace?.saved.readOnly ?? false);

	// Server presets are the source of truth; the local list only covers
	// the offline gap before the first load.
	const templates =
		serverPresets === null
			? FALLBACK_TEMPLATES
			: serverPresets.map(presetToTemplate);
	const [selectedId, setSelectedId] = useState("fixed");
	const selected =
		templates.find((item) => item.id === selectedId) ?? templates[0];
	const selectedPreset =
		serverPresets?.find((preset) => preset.name === selected?.id) ?? null;
	const customAmount =
		selected && !BUILT_IN_TEMPLATE_IDS.has(selected.id)
			? (selected.amount ?? undefined)
			: undefined;

	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [stagedAmount, setStagedAmount] = useState<PostingAmountResolution | null>(null);

	const recipes = mergeCopy(FALLBACK_RESOLVERS, remote?.resolvers ?? []);
	const steps = mergeCopy(FALLBACK_INCOME_STEPS, remote?.incomeSteps ?? []);
	const values = mergeCopy(FALLBACK_PROVIDERS, remote?.providers ?? []);

	const index =
		serverPresets?.findIndex((preset) => preset.name === selected?.id) ?? -1;
	const canMoveUp = index > 0;
	const canMoveDown =
		index >= 0 && serverPresets !== null && index < serverPresets.length - 1;

	function closeForms() {
		setCreating(false);
		setEditing(false);
		setStagedAmount(null);
	}

	async function submitCreate(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		const name = slugify(textValue(data, "name"));
		if (!name || !stagedAmount) return;
		const ok = await presetThunks.createPreset({
			id: "",
			name,
			label: textValue(data, "label") || name,
			summary: textValue(data, "summary") || null,
			whenUse: textValue(data, "whenUse") || null,
			amount: stagedAmount,
			enabled: textValue(data, "enabled") === "on",
		});
		if (ok) {
			setSelectedId(name);
			closeForms();
		}
	}

	async function submitEdit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!selectedPreset) return;
		const data = new FormData(event.currentTarget);
		const ok = await presetThunks.updatePreset({
			...selectedPreset,
			label: textValue(data, "label") || selectedPreset.label,
			summary: textValue(data, "summary") || null,
			whenUse: textValue(data, "whenUse") || null,
			amount: stagedAmount ?? selectedPreset.amount,
			enabled: textValue(data, "enabled") === "on",
		});
		if (ok) closeForms();
	}

	return (
		<section aria-label="How amounts are calculated">
			<h3>How amounts are calculated</h3>
			<p className="muted">
				Pick a starting point, fill in the blanks, copy the result.
			</p>
			<ul className="catalog-grid">
				{templates.map((template) => (
					<li key={template.id}>
						<button
							type="button"
							className="catalog-pick"
							aria-pressed={template.id === selected?.id}
							onClick={() => {
								setSelectedId(template.id);
								closeForms();
							}}
						>
							<strong>{template.label}</strong>
							<span className="muted">{template.summary}</span>
						</button>
					</li>
				))}
			</ul>
			{!readOnly && serverPresets !== null && (
				<div className="catalog-actions">
					<button
						type="button"
						className="button secondary"
						onClick={() => {
							closeForms();
							setCreating(true);
						}}
					>
						New recipe
					</button>
					{selectedPreset && (
						<>
							<button
								type="button"
								className="text-button"
								onClick={() => {
									closeForms();
									setEditing(true);
								}}
							>
								Rename
							</button>
							<button
								type="button"
								className="text-button"
								disabled={!canMoveUp}
								onClick={() => {
									const previous = serverPresets[index - 1];
									if (previous) void movePreset(selectedPreset.id, previous.id);
								}}
							>
								Move up
							</button>
							<button
								type="button"
								className="text-button"
								disabled={!canMoveDown}
								onClick={() => {
									const after = serverPresets[index + 2];
									void movePreset(selectedPreset.id, after ? after.id : null);
								}}
							>
								Move down
							</button>
							<button
								type="button"
								className="text-button"
								onClick={() => setDeleting(true)}
							>
								Delete
							</button>
						</>
					)}
				</div>
			)}
			{creating && (
				<form className="amount-builder" onSubmit={submitCreate}>
					<h4>New recipe</h4>
					<div className="form-grid">
						<InputField
							label="Name"
							name="name"
							required
							maxLength={100}
							placeholder="e.g. yearly-bonus"
							hint="Lowercase letters, numbers, and dashes."
						/>
						<InputField
							label="Label"
							name="label"
							required
							maxLength={100}
							placeholder="e.g. Yearly bonus"
						/>
						<InputField
							label="Summary"
							name="summary"
							wide
							maxLength={280}
							placeholder="e.g. Same bonus every December."
						/>
						<InputField
							label="When to use"
							name="whenUse"
							wide
							maxLength={280}
							placeholder="e.g. Annual bonuses."
						/>
					</div>
					<label className="checkbox-field">
						<input name="enabled" type="checkbox" defaultChecked />
						Enabled
					</label>
					<AmountBuilder
						accounts={accounts}
						postings={postings}
						incomeSources={incomeSources}
						taxProfiles={taxProfiles}
						templates={templates}
						initialTemplateId="fixed"
						onChange={setStagedAmount}
					/>
					{stagedAmount && (
						<p className="muted">Amount ready to save.</p>
					)}
					<div className="modal-actions">
						<button
							type="button"
							className="button secondary"
							onClick={closeForms}
						>
							Cancel
						</button>
						<button
							type="submit"
							className="button primary"
							disabled={!stagedAmount}
						>
							Save recipe
						</button>
					</div>
				</form>
			)}
			{editing && selectedPreset && (
				<form className="amount-builder" onSubmit={submitEdit}>
					<h4>Rename recipe</h4>
					<div className="form-grid">
						<InputField
							label="Label"
							name="label"
							required
							maxLength={100}
							defaultValue={selectedPreset.label}
						/>
						<InputField
							label="Summary"
							name="summary"
							wide
							maxLength={280}
							defaultValue={selectedPreset.summary ?? ""}
						/>
						<InputField
							label="When to use"
							name="whenUse"
							wide
							maxLength={280}
							defaultValue={selectedPreset.whenUse ?? ""}
						/>
					</div>
					<label className="checkbox-field">
						<input
							name="enabled"
							type="checkbox"
							defaultChecked={selectedPreset.enabled}
						/>
						Enabled
					</label>
					<details>
						<summary>Replace amount</summary>
						<AmountBuilder
							accounts={accounts}
							postings={postings}
							incomeSources={incomeSources}
							taxProfiles={taxProfiles}
							templates={templates}
							initialTemplateId={BUILT_IN_TEMPLATE_IDS.has(selectedPreset.name) ? selectedPreset.name : "fixed"}
							onChange={setStagedAmount}
						/>
					</details>
					<div className="modal-actions">
						<button
							type="button"
							className="button secondary"
							onClick={closeForms}
						>
							Cancel
						</button>
						<button type="submit" className="button primary">
							Save changes
						</button>
					</div>
				</form>
			)}
			{deleting && selectedPreset && (
				<ConfirmDialog
					title={`Delete ${selectedPreset.label}?`}
					cancelLabel="Keep recipe"
					confirmLabel="Delete recipe"
					onCancel={() => setDeleting(false)}
					onConfirm={() => {
						void deletePreset(selectedPreset.id).then((ok) => {
							if (ok) {
								setDeleting(false);
								setSelectedId(templates[0]?.id ?? "fixed");
							}
						});
					}}
				>
					<p>
						The recipe stops appearing as a starting point. Movements
						already using its amounts are unaffected.
					</p>
				</ConfirmDialog>
			)}
			{presetError && <ErrorNotice message={presetError} />}
			{selected && !creating && !editing && (
				<AmountBuilder
					key={selected.id}
					accounts={accounts}
					postings={postings}
					incomeSources={incomeSources}
					taxProfiles={taxProfiles}
					templates={templates}
					initialTemplateId={selected.id}
					hidePicker
					fixedAmount={customAmount}
				/>
			)}
			<details>
				<summary>
					All recipes and values ({recipes.length + steps.length + values.length})
				</summary>
				<h4>Recipes</h4>
				<CompactList items={recipes} />
				<h4>Paycheck steps</h4>
				<CompactList items={steps} />
				<h4>Named values</h4>
				<CompactList items={values} />
			</details>
		</section>
	);
}
