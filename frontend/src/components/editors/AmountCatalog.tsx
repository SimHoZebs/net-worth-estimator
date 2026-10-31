import { useId, useState, type FormEvent } from "react";
import type { PostingAmountResolution } from "../../api/contracts.ts";
import {
	BUILT_IN_TEMPLATE_IDS,
	FALLBACK_PROVIDERS,
	FALLBACK_RESOLVERS,
} from "../../domain/amountCatalog.ts";
import {
	useAmountPresets,
	useAmountResolvers,
	useTransactionCatalog,
} from "../../state/workspaceResources.ts";
import { useUserReadOnly } from "../../state/useUserScope.ts";
import { useSavedAccounts } from "../../state/savedRows.ts";
import {
	createPreset,
	updatePreset,
	deletePreset,
	movePreset,
} from "../../state/workspaceWrites.ts";
import { Button, TextButton } from "../Button.tsx";
import { dialogActionsStyles } from "../dialogStyles.ts";
import { Checkbox, InputField } from "../Field.tsx";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { textValue } from "./formValues.ts";
import { AmountBuilder } from "./AmountBuilder.tsx";
import { useAmountTemplates } from "./amountTemplates.ts";

type CopyEntry = {
	name: string;
	label?: string | null;
	summary?: string | null;
	description?: string | null;
};

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

function CompactList({
	items,
}: {
	items: { key: string; title: string; text: string }[];
}) {
	return (
		<ul className="mt-2 mb-5 list-none p-0">
			{items.map((item) => (
				<li
					key={item.key}
					className="border-0 border-b border-solid border-line py-2 text-sm"
				>
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

export function AmountCatalog() {
	const id = useId();
	const remote = useAmountResolvers().data;
	const serverPresets = useAmountPresets().data ?? null;
	const savedAccounts = useSavedAccounts();
	const catalog = useTransactionCatalog().data;
	const accounts = (savedAccounts ?? []).map((account) => ({
		id: account.id,
		name: account.name,
	}));
	const postings = (catalog?.items ?? []).map((item) => ({
		id: item.id,
		name: item.name,
	}));
	const presetThunks = { createPreset, updatePreset, deletePreset, movePreset };
	const readOnly = useUserReadOnly();

	// Server presets are the source of truth; the hook covers the offline gap.
	const templates = useAmountTemplates();
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
	const [stagedAmount, setStagedAmount] =
		useState<PostingAmountResolution | null>(null);

	const recipes = mergeCopy(FALLBACK_RESOLVERS, remote?.resolvers ?? []);
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
			<p className="text-muted">
				Pick a starting point, fill in the blanks, copy the result.
			</p>
			<ul className="mt-3 mb-5 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,var(--container-3xs)),1fr))] gap-3 p-0">
				{templates.map((template) => (
					<li key={template.id} className="m-0">
						<button
							type="button"
							className="block w-full cursor-pointer rounded-surface border border-solid border-line bg-transparent p-3 text-left text-inherit aria-pressed:border-success-border aria-pressed:bg-success-bg"
							aria-pressed={template.id === selected?.id}
							onClick={() => {
								setSelectedId(template.id);
								closeForms();
							}}
						>
							<strong className="mb-1 block">{template.label}</strong>
							<span className="m-0 text-xs text-muted">{template.summary}</span>
						</button>
					</li>
				))}
			</ul>
			{!readOnly && serverPresets !== null && (
				<div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
					<Button
						type="button"
						variant="secondary"
						onClick={() => {
							closeForms();
							setCreating(true);
						}}
					>
						New recipe
					</Button>
					{selectedPreset && (
						<>
							<TextButton
								type="button"
								onClick={() => {
									closeForms();
									setEditing(true);
								}}
							>
								Rename
							</TextButton>
							<TextButton
								type="button"
								disabled={!canMoveUp}
								onClick={() => {
									const previous = serverPresets[index - 1];
									if (previous) void movePreset(selectedPreset.id, previous.id);
								}}
							>
								Move up
							</TextButton>
							<TextButton
								type="button"
								disabled={!canMoveDown}
								onClick={() => {
									const after = serverPresets[index + 2];
									void movePreset(selectedPreset.id, after ? after.id : null);
								}}
							>
								Move down
							</TextButton>
							<TextButton type="button" onClick={() => setDeleting(true)}>
								Delete
							</TextButton>
						</>
					)}
				</div>
			)}
			{creating && (
				<form
					className="mt-3 mb-5 rounded-surface border border-solid border-line bg-transparent p-4"
					onSubmit={submitCreate}
				>
					<h4>New recipe</h4>
					<div className="grid grid-cols-2 gap-5 max-sm:gap-x-3 max-sm:gap-y-4 max-sm:grid-cols-1">
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
					<label
						htmlFor={`${id}-create-enabled`}
						className="flex min-h-11 items-center gap-3 text-sm text-muted"
					>
						<Checkbox
							id={`${id}-create-enabled`}
							name="enabled"
							defaultChecked
						/>
						Enabled
					</label>
					<AmountBuilder
						accounts={accounts}
						postings={postings}
						templates={templates}
						initialTemplateId="fixed"
						onChange={setStagedAmount}
					/>
					{stagedAmount && <p className="text-muted">Amount ready to save.</p>}
					<div className={dialogActionsStyles}>
						<Button type="button" variant="secondary" onClick={closeForms}>
							Cancel
						</Button>
						<Button type="submit" variant="primary" disabled={!stagedAmount}>
							Save recipe
						</Button>
					</div>
				</form>
			)}
			{editing && selectedPreset && (
				<form
					className="mt-3 mb-5 rounded-surface border border-solid border-line bg-transparent p-4"
					onSubmit={submitEdit}
				>
					<h4>Rename recipe</h4>
					<div className="grid grid-cols-2 gap-5 max-sm:gap-x-3 max-sm:gap-y-4 max-sm:grid-cols-1">
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
					<label
						htmlFor={`${id}-edit-enabled`}
						className="flex min-h-11 items-center gap-3 text-sm text-muted"
					>
						<Checkbox
							id={`${id}-edit-enabled`}
							name="enabled"
							defaultChecked={selectedPreset.enabled}
						/>
						Enabled
					</label>
					<details>
						<summary>Replace amount</summary>
						<AmountBuilder
							accounts={accounts}
							postings={postings}
							templates={templates}
							initialTemplateId={
								BUILT_IN_TEMPLATE_IDS.has(selectedPreset.name)
									? selectedPreset.name
									: "fixed"
							}
							onChange={setStagedAmount}
						/>
					</details>
					<div className={dialogActionsStyles}>
						<Button type="button" variant="secondary" onClick={closeForms}>
							Cancel
						</Button>
						<Button type="submit" variant="primary">
							Save changes
						</Button>
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
						The recipe stops appearing as a starting point. Transactions already
						using its amounts are unaffected.
					</p>
				</ConfirmDialog>
			)}
			{selected && !creating && !editing && (
				<AmountBuilder
					key={selected.id}
					accounts={accounts}
					postings={postings}
					templates={templates}
					initialTemplateId={selected.id}
					hidePicker
					fixedAmount={customAmount}
				/>
			)}
			<details>
				<summary>
					All recipes and values ({recipes.length + values.length})
				</summary>
				<h4>Recipes</h4>
				<CompactList items={recipes} />
				<h4>Named values</h4>
				<CompactList items={values} />
			</details>
		</section>
	);
}
