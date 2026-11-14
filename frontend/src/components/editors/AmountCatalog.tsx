import { useId, useState, type FormEvent } from "react";
import type { TransactionAmountResolution } from "../../api/contracts.ts";
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
import { useUserReadOnly, useUserScope } from "../../state/useUserScope.ts";
import { useSavedAccounts } from "../../state/savedState.ts";
import {
	createPreset,
	updatePreset,
	deletePreset,
	movePreset,
} from "../../state/workspaceWrites.ts";
import { Button } from "@/components/ui/button.tsx";
import { Field } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { cn } from "@/lib/utils.ts";

const fieldLabelClassName = "text-sm leading-normal font-semibold text-muted";
const fieldInputClassName =
	"h-11 bg-input-bg px-3 text-base text-ink placeholder:text-subtle disabled:bg-transparent focus-visible:outline-solid focus-visible:ring-0";
const secondaryButtonClassName =
	"min-h-10 border-line-strong bg-surface px-4 py-2 text-sm leading-snug text-ink enabled:hover:bg-hover focus-visible:outline-solid focus-visible:ring-0";
const primaryButtonClassName =
	"min-h-10 border-primary bg-primary px-4 py-2 text-sm leading-snug text-on-primary enabled:hover:bg-primary-hover enabled:hover:shadow-sm focus-visible:outline-solid focus-visible:ring-0";
const textButtonClassName =
	"px-0 py-0.5 text-xs font-semibold text-success-text enabled:hover:text-ink";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
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

function CatalogField({
	id,
	label,
	name,
	wide,
	required,
	maxLength,
	placeholder,
	hint,
	hintId,
	defaultValue,
}: {
	id: string;
	label: string;
	name: string;
	wide?: boolean;
	required?: boolean;
	maxLength?: number;
	placeholder?: string;
	hint?: string;
	hintId?: string;
	defaultValue?: string;
}) {
	return (
		<Field
			className={cn("flex min-w-0 flex-col gap-2", wide && "col-span-full")}
		>
			<Label htmlFor={id} className={fieldLabelClassName}>
				{label}
			</Label>
			<Input
				id={id}
				name={name}
				required={required}
				maxLength={maxLength}
				placeholder={placeholder}
				defaultValue={defaultValue}
				aria-describedby={hint ? hintId : undefined}
				className={fieldInputClassName}
			/>
			{hint && (
				<p id={hintId} className="text-xs leading-relaxed text-muted">
					{hint}
				</p>
			)}
		</Field>
	);
}

export function AmountCatalog() {
	const id = useId();
	const enabled = useUserScope().status === "ready";
	const remote = useAmountResolvers().data;
	const serverPresets = useAmountPresets({ enabled }).data ?? null;
	const savedAccounts = useSavedAccounts();
	const catalog = useTransactionCatalog().data;
	const accounts = (savedAccounts ?? []).map((account) => ({
		id: account.id,
		name: account.name,
	}));
	const transactions = (catalog?.items ?? []).map((item) => ({
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
		useState<TransactionAmountResolution | null>(null);

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
						className={secondaryButtonClassName}
						onClick={() => {
							closeForms();
							setCreating(true);
						}}
					>
						New recipe
					</Button>
					{selectedPreset && (
						<>
							<Button
								type="button"
								variant="link"
								className={textButtonClassName}
								onClick={() => {
									closeForms();
									setEditing(true);
								}}
							>
								Rename
							</Button>
							<Button
								type="button"
								variant="link"
								className={textButtonClassName}
								disabled={!canMoveUp}
								onClick={() => {
									const previous = serverPresets[index - 1];
									if (previous) void movePreset(selectedPreset.id, previous.id);
								}}
							>
								Move up
							</Button>
							<Button
								type="button"
								variant="link"
								className={textButtonClassName}
								disabled={!canMoveDown}
								onClick={() => {
									const after = serverPresets[index + 2];
									void movePreset(selectedPreset.id, after ? after.id : null);
								}}
							>
								Move down
							</Button>
							<Button
								type="button"
								variant="link"
								className={textButtonClassName}
								onClick={() => setDeleting(true)}
							>
								Delete
							</Button>
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
						<CatalogField
							id={`${id}-create-name`}
							label="Name"
							name="name"
							required
							maxLength={100}
							placeholder="e.g. yearly-bonus"
							hint="Lowercase letters, numbers, and dashes."
							hintId={`${id}-create-name-hint`}
						/>
						<CatalogField
							id={`${id}-create-label`}
							label="Label"
							name="label"
							required
							maxLength={100}
							placeholder="e.g. Yearly bonus"
						/>
						<CatalogField
							id={`${id}-create-summary`}
							label="Summary"
							name="summary"
							wide
							maxLength={280}
							placeholder="e.g. Same bonus every December."
						/>
						<CatalogField
							id={`${id}-create-when-use`}
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
						<input
							id={`${id}-create-enabled`}
							name="enabled"
							type="checkbox"
							defaultChecked
							className="m-0 size-5 flex-none cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-60"
						/>
						Enabled
					</label>
					<AmountBuilder
						accounts={accounts}
						transactions={transactions}
						templates={templates}
						initialTemplateId="fixed"
						onChange={setStagedAmount}
					/>
					{stagedAmount && <p className="text-muted">Amount ready to save.</p>}
					<div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-0 border-t border-solid border-line pt-5">
						<Button
							type="button"
							variant="secondary"
							className={secondaryButtonClassName}
							onClick={closeForms}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="default"
							className={primaryButtonClassName}
							disabled={!stagedAmount}
						>
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
						<CatalogField
							id={`${id}-edit-label`}
							label="Label"
							name="label"
							required
							maxLength={100}
							defaultValue={selectedPreset.label}
						/>
						<CatalogField
							id={`${id}-edit-summary`}
							label="Summary"
							name="summary"
							wide
							maxLength={280}
							defaultValue={selectedPreset.summary ?? ""}
						/>
						<CatalogField
							id={`${id}-edit-when-use`}
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
						<input
							id={`${id}-edit-enabled`}
							name="enabled"
							type="checkbox"
							defaultChecked={selectedPreset.enabled}
							className="m-0 size-5 flex-none cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-60"
						/>
						Enabled
					</label>
					<details>
						<summary>Replace amount</summary>
						<AmountBuilder
							accounts={accounts}
							transactions={transactions}
							templates={templates}
							initialTemplateId={
								BUILT_IN_TEMPLATE_IDS.has(selectedPreset.name)
									? selectedPreset.name
									: "fixed"
							}
							onChange={setStagedAmount}
						/>
					</details>
					<div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-0 border-t border-solid border-line pt-5">
						<Button
							type="button"
							variant="secondary"
							className={secondaryButtonClassName}
							onClick={closeForms}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="default"
							className={primaryButtonClassName}
						>
							Save changes
						</Button>
					</div>
				</form>
			)}
			{deleting && selectedPreset && (
				<AlertDialog
					open
					onOpenChange={(open) => {
						if (!open) setDeleting(false);
					}}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>
								{`Delete ${selectedPreset.label}?`}
							</AlertDialogTitle>
						</AlertDialogHeader>
						<AlertDialogDescription>
							The recipe stops appearing as a starting point. Transactions
							already using its amounts are unaffected.
						</AlertDialogDescription>
						<AlertDialogFooter>
							<AlertDialogCancel>Keep recipe</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								onClick={() => {
									void deletePreset(selectedPreset.id).then((ok) => {
										if (ok) {
											setDeleting(false);
											setSelectedId(templates[0]?.id ?? "fixed");
										}
									});
								}}
							>
								Delete recipe
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			)}
			{selected && !creating && !editing && (
				<AmountBuilder
					key={selected.id}
					accounts={accounts}
					transactions={transactions}
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
