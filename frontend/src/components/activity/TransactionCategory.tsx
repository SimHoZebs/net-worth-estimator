import { useId, useState } from "react";
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
	LoaderCircle,
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
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select.tsx";
import { cn } from "@/lib/utils.ts";

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
	const id = useId();
	const labelId = `${id}-label`;
	const triggerId = `${id}-trigger`;
	const valueId = `${id}-value`;
	const sourceId = `${id}-source`;

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
		<div className="flex items-center gap-4 border-t border-line py-2 first:border-t-0 first:pt-0 last:pb-0">
			<Label
				id={labelId}
				htmlFor={triggerId}
				className={cn(
					"w-36 flex-none text-sm font-semibold text-muted",
					labelClassName,
				)}
			>
				Category
			</Label>
			<div className="min-w-0 flex-1">
				<Select
					value={selected}
					disabled={readOnly || saving}
					onValueChange={(next) => {
						setDraft(next);
						void save(next);
					}}
				>
					<SelectTrigger
						id={triggerId}
						aria-labelledby={[labelId, valueId, sourceLabel ? sourceId : ""]
							.filter(Boolean)
							.join(" ")}
						aria-busy={saving}
					>
						<SelectedIcon
							size={16}
							aria-hidden="true"
							className="flex-none text-muted"
						/>
						<span id={valueId} className="min-w-0 flex-1 truncate">
							<SelectValue>{selectedLabel}</SelectValue>
						</span>
						{sourceLabel && (
							<span id={sourceId} className="sr-only">
								{sourceLabel}
							</span>
						)}
						{saving && (
							<LoaderCircle
								size={16}
								aria-hidden="true"
								className="flex-none animate-spin text-muted"
							/>
						)}
					</SelectTrigger>
					<SelectContent>
						{transactionCategoryOptions.map((option) => {
							const Icon =
								categoryIcons[option.value as TransactionCategoryKey] ?? Tag;
							return (
								<SelectItem key={option.value} value={option.value}>
									<Icon
										size={16}
										aria-hidden="true"
										className="flex-none text-muted"
									/>
									<span className="min-w-0 flex-1 truncate">
										{option.label}
									</span>
								</SelectItem>
							);
						})}
					</SelectContent>
				</Select>
				{canReset && (
					<Button
						type="button"
						variant="link"
						size="sm"
						disabled={readOnly || saving}
						onClick={() => void save(null)}
					>
						Use automatic
					</Button>
				)}
			</div>
		</div>
	);
}
