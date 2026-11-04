import { useState } from "react";
import { setPostingCategory } from "@/api/generated/endpoints.ts";
import {
	transactionCategoryLabel,
	transactionCategoryOptions,
	transactionCategorySourceLabel,
	transactionCategorySourceOf,
	type TransactionCategorySource,
} from "../../domain/categories.ts";
import { refreshTransactions } from "../../state/workspaceResources.ts";
import { useSavedTransactions } from "../../state/savedRows.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { SelectField } from "../Field.tsx";
import { TextButton } from "../Button.tsx";

function categoryHint(
	category: string | null | undefined,
	source: TransactionCategorySource | null,
): string {
	if (!category) {
		return "No category yet. A supported bank value is kept; otherwise a suggestion fills in.";
	}
	const sourceLabel = transactionCategorySourceLabel(source);
	switch (source) {
		case "user":
			return `${sourceLabel}. Your choice overrides bank values and suggestions.`;
		case "bank":
			return `${sourceLabel}. Supported values are kept as-is.`;
		case "inferred":
			return `${sourceLabel}. Your choice overrides this suggestion.`;
		default:
			return "No source recorded.";
	}
}

/**
 * Category assignment is sidecar metadata, so it saves on its own instead of
 * riding the transaction form. Pending rows stay editable: the posting ID
 * survives settlement, and the assignment follows it.
 */
export function TransactionCategory({
	postingId,
	category,
	source,
	readOnly,
}: {
	postingId: string;
	category: string | null | undefined;
	source: string | null | undefined;
	readOnly?: boolean;
}) {
	// Follow the saved rows after a save so the control reflects the server
	// result without copying props into state through an effect.
	const saved = useSavedTransactions()?.find((row) => row.id === postingId);
	const currentCategory = saved ? saved.category : category;
	const currentSource = saved ? saved.categorySource : source;
	const normalizedCurrentSource = transactionCategorySourceOf(currentSource);
	const [draft, setDraft] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const selected = draft ?? currentCategory ?? "";
	const canReset = normalizedCurrentSource === "user";
	const knownCategory = currentCategory
		? transactionCategoryOptions.some(
				(option) => option.value === currentCategory,
			)
		: true;
	const save = async (next: string | null) => {
		if (saving) return;
		setSaving(true);
		setError(null);
		const ok = await performSave({
			call: () => setPostingCategory(postingId, { category: next }),
			refresh: refreshTransactions,
			failureMessage: "The category could not be saved.",
		});
		setSaving(false);
		setDraft(null);
		if (ok) return;
		setError(
			"The category could not be saved. Review the workspace notice and try again.",
		);
	};
	return (
		<div className="mt-5 scroll-mt-4">
			<SelectField
				label="Category"
				name="category"
				value={selected}
				disabled={readOnly || saving}
				hint={categoryHint(currentCategory, normalizedCurrentSource)}
				onChange={(event) => {
					const next = event.target.value;
					if (!next) {
						setDraft("");
						void save(null);
						return;
					}
					setDraft(next);
					void save(next);
				}}
			>
				{(!currentCategory || canReset) && (
					<option value="">{canReset ? "Automatic" : "Not categorized"}</option>
				)}
				{currentCategory && !knownCategory && (
					<option value={currentCategory}>
						{transactionCategoryLabel(currentCategory)}
					</option>
				)}
				{transactionCategoryOptions.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</SelectField>
			{canReset && (
				<TextButton
					type="button"
					className="mt-2"
					disabled={saving}
					onClick={() => void save(null)}
				>
					Use automatic category
				</TextButton>
			)}
			{saving && (
				<p className="mt-2 text-xs text-muted" role="status">
					Saving category…
				</p>
			)}
			{error && <ErrorNotice message={error} />}
		</div>
	);
}
