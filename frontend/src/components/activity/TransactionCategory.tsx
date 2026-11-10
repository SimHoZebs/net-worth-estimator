import { useState } from "react";
import {
	ArrowDownLeft,
	ArrowUpRight,
	BriefcaseBusiness,
	Car,
	Clapperboard,
	CreditCard,
	HeartPulse,
	House,
	Landmark,
	Plane,
	ReceiptText,
	Settings,
	ShoppingBag,
	Sparkles,
	Tag,
	Utensils,
	Wrench,
	type LucideIcon,
} from "lucide-react";
import { categorizeTransaction } from "@/api/generated/endpoints.ts";
import {
	transactionCategoryLabel,
	transactionCategoryOptions,
	transactionCategorySourceLabel,
	transactionCategorySourceOf,
	type TransactionCategory as TransactionCategoryKey,
} from "../../domain/categories.ts";
import { refreshTransactions } from "../../state/workspaceResources.ts";
import { useSavedTransactions } from "../../state/savedState.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import { OptionPicker } from "../OptionPicker.tsx";

const categoryIcons: Record<TransactionCategoryKey, LucideIcon> = {
	INCOME: BriefcaseBusiness,
	TRANSFER_IN: ArrowDownLeft,
	TRANSFER_OUT: ArrowUpRight,
	LOAN_PAYMENTS: CreditCard,
	BANK_FEES: ReceiptText,
	ENTERTAINMENT: Clapperboard,
	FOOD_AND_DRINK: Utensils,
	GENERAL_MERCHANDISE: ShoppingBag,
	HOME_IMPROVEMENT: Wrench,
	MEDICAL: HeartPulse,
	PERSONAL_CARE: Sparkles,
	GENERAL_SERVICES: Settings,
	GOVERNMENT_AND_NON_PROFIT: Landmark,
	TRANSPORTATION: Car,
	TRAVEL: Plane,
	RENT_AND_UTILITIES: House,
};

/**
 * Category assignment is sidecar metadata, so it saves on its own instead of
 * riding the transaction form. It renders as one field row beside the other
 * transaction fields, with a picker that shows one icon per category. Pending
 * bank rows stay editable because the transaction ID survives settlement.
 */
export function TransactionCategory({
	transactionId,
	category,
	source,
	readOnly,
	labelClassName,
}: {
	transactionId: string;
	category: string | null | undefined;
	source: string | null | undefined;
	readOnly?: boolean;
	labelClassName?: string;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	// Follow the saved rows after a save so the control reflects the server
	// result without copying props into state through an effect.
	const saved = useSavedTransactions()?.find((row) => row.id === transactionId);
	const currentCategory = saved ? saved.category : category;
	const currentSource = saved ? saved.categorySource : source;
	const normalizedSource = transactionCategorySourceOf(currentSource);
	const selected = draft ?? currentCategory ?? "";
	const selectedLabel = transactionCategoryLabel(selected) ?? "Not categorized";
	const SelectedIcon = categoryIcons[selected as TransactionCategoryKey] ?? Tag;
	const sourceLabel = normalizedSource
		? transactionCategorySourceLabel(normalizedSource)
		: null;
	const canReset = normalizedSource === "user";

	const save = async (next: string | null) => {
		if (saving) return;
		setSaving(true);
		await performSave({
			call: () => categorizeTransaction(transactionId, { category: next }),
			refresh: refreshTransactions,
			failureMessage: "The category could not be saved.",
		});
		setSaving(false);
		setDraft(null);
	};

	return (
		<OptionPicker
			label="Category"
			labelClassName={labelClassName}
			value={selected}
			valueLabel={selectedLabel}
			ValueIcon={SelectedIcon}
			options={transactionCategoryOptions.map((option) => ({
				value: option.value,
				label: option.label,
				icon: categoryIcons[option.value as TransactionCategoryKey] ?? Tag,
			}))}
			onSelect={(next) => {
				setDraft(next);
				void save(next);
			}}
			disabled={readOnly}
			saving={saving}
			resetLabel={canReset ? "Use automatic" : undefined}
			onReset={canReset ? () => void save(null) : undefined}
			sourceLabel={sourceLabel}
		/>
	);
}
