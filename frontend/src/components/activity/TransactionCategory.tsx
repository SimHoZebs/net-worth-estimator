import {
	ArrowDownLeft,
	ArrowUpRight,
	BriefcaseBusiness,
	Car,
	Check,
	ChevronDown,
	Clapperboard,
	CreditCard,
	HeartPulse,
	House,
	Landmark,
	LoaderCircle,
	Plane,
	ReceiptText,
	RotateCcw,
	Settings,
	ShoppingBag,
	Sparkles,
	Tag,
	Utensils,
	Wrench,
	type LucideIcon,
} from "lucide-react";
import {
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type KeyboardEvent,
} from "react";
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
import { mergeStyles } from "../mergeStyles.ts";
import { controlStyles } from "../fieldStyles.ts";

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

const supportsPopover =
	typeof HTMLElement !== "undefined" &&
	typeof HTMLElement.prototype.showPopover === "function";

function CategoryOption({
	value,
	label,
	icon: Icon,
	selected,
	onSelect,
}: {
	value: string;
	label: string;
	icon: LucideIcon;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			role="option"
			aria-selected={selected}
			data-category-value={value}
			onClick={onSelect}
			className={mergeStyles(
				"flex w-full items-center gap-2 rounded-control border-0 bg-transparent px-2 py-2 text-left text-sm text-ink hover:bg-hover",
				selected ? "bg-surface-2" : undefined,
			)}
		>
			<Icon size={16} aria-hidden="true" className="flex-none text-muted" />
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{selected && <Check size={14} aria-hidden="true" className="flex-none" />}
		</button>
	);
}

/**
 * Category assignment is sidecar metadata, so it saves on its own instead of
 * riding the transaction form. It renders as one field row beside the other
 * transaction fields, with a picker that shows one icon per category. Pending
 * bank rows stay editable because the posting ID survives settlement.
 */
export function TransactionCategory({
	postingId,
	category,
	source,
	readOnly,
	labelClassName = "w-36 flex-none text-sm font-semibold text-muted",
}: {
	postingId: string;
	category: string | null | undefined;
	source: string | null | undefined;
	readOnly?: boolean;
	labelClassName?: string;
}) {
	const id = useId();
	const labelId = `${id}-label`;
	const triggerId = `${id}-trigger`;
	const valueId = `${id}-value`;
	const sourceId = `${id}-source`;
	const listboxId = `${id}-listbox`;
	const popoverId = `${id}-popover`;
	const triggerRef = useRef<HTMLButtonElement>(null);
	const listboxRef = useRef<HTMLDivElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Follow the saved rows after a save so the control reflects the server
	// result without copying props into state through an effect.
	const saved = useSavedTransactions()?.find((row) => row.id === postingId);
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

	useLayoutEffect(() => {
		const popover = popoverRef.current;
		const trigger = triggerRef.current;
		if (!popover || !trigger) return;
		if (!open) {
			if (
				typeof popover.hidePopover === "function" &&
				popover.matches(":popover-open")
			)
				popover.hidePopover();
			return;
		}
		const position = () => {
			const rect = trigger.getBoundingClientRect();
			const gap = 4;
			const edge = 8;
			const below = window.innerHeight - rect.bottom - edge - gap;
			const above = rect.top - edge - gap;
			const openAbove = below < 220 && above > below;
			const maxHeight = Math.max(120, Math.min(320, openAbove ? above : below));
			Object.assign(popover.style, {
				position: "fixed",
				inset: "auto",
				margin: "0",
				left: `${rect.left}px`,
				width: `${rect.width}px`,
				top: openAbove ? "auto" : `${rect.bottom + gap}px`,
				bottom: openAbove ? `${window.innerHeight - rect.top + gap}px` : "auto",
				maxHeight: `${maxHeight}px`,
				overflowY: "auto",
			});
		};
		position();
		if (
			typeof popover.showPopover === "function" &&
			!popover.matches(":popover-open")
		)
			popover.showPopover();
		const list = listboxRef.current;
		const selectedOption = list?.querySelector<HTMLElement>(
			'[role="option"][aria-selected="true"]',
		);
		(selectedOption ?? list)?.focus({ preventScroll: true });
		window.addEventListener("resize", position);
		window.addEventListener("scroll", position, true);
		return () => {
			window.removeEventListener("resize", position);
			window.removeEventListener("scroll", position, true);
		};
	}, [open]);

	useEffect(() => {
		const popover = popoverRef.current;
		if (!popover) return;
		const onToggle = (event: Event) => {
			const next = (event as Event & { newState?: string }).newState;
			if (next === "closed") setOpen(false);
		};
		popover.addEventListener("toggle", onToggle);
		return () => popover.removeEventListener("toggle", onToggle);
	}, [open]);

	const save = async (next: string | null) => {
		if (saving) return;
		setSaving(true);
		setError(null);
		const ok = await performSave({
			call: () => categorizeTransaction(postingId, { category: next }),
			refresh: refreshTransactions,
			failureMessage: "The category could not be saved.",
		});
		setSaving(false);
		setDraft(null);
		if (!ok) {
			setError(
				"The category could not be saved. Review the workspace notice and try again.",
			);
		}
	};

	const choose = (next: string | null) => {
		if (readOnly || saving) return;
		setOpen(false);
		triggerRef.current?.focus();
		if (next) setDraft(next);
		void save(next);
	};

	const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (
			event.key !== "ArrowDown" &&
			event.key !== "ArrowUp" &&
			event.key !== "Home" &&
			event.key !== "End"
		)
			return;
		const options = Array.from(
			listboxRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ??
				[],
		);
		if (options.length === 0) return;
		event.preventDefault();
		const active = options.indexOf(document.activeElement as HTMLElement);
		let next = 0;
		if (event.key === "End") next = options.length - 1;
		else if (event.key === "ArrowDown")
			next = active < 0 ? 0 : (active + 1) % options.length;
		else if (event.key === "ArrowUp")
			next =
				active < 0
					? options.length - 1
					: (active - 1 + options.length) % options.length;
		options[next]?.focus();
	};

	return (
		<>
			<div className="flex items-center gap-4 border-t border-line py-2 first:border-t-0 first:pt-0 last:pb-0">
				<label id={labelId} htmlFor={triggerId} className={labelClassName}>
					Category
				</label>
				<div className="relative min-w-0 flex-1">
					<button
						ref={triggerRef}
						id={triggerId}
						type="button"
						aria-haspopup="listbox"
						aria-expanded={open}
						aria-controls={popoverId}
						aria-labelledby={[labelId, valueId, sourceLabel ? sourceId : ""]
							.filter(Boolean)
							.join(" ")}
						aria-busy={saving}
						disabled={readOnly || saving}
						onClick={() => setOpen((value) => !value)}
						onKeyDown={(event) => {
							if (event.key === "ArrowDown" || event.key === "ArrowUp") {
								event.preventDefault();
								setOpen(true);
							}
						}}
						className={mergeStyles(
							controlStyles({ kind: "select" }),
							"flex items-center gap-2 text-left disabled:cursor-not-allowed",
						)}
					>
						<SelectedIcon
							size={16}
							aria-hidden="true"
							className="flex-none text-muted"
						/>
						<span id={valueId} className="min-w-0 flex-1 truncate">
							{selectedLabel}
						</span>
						{sourceLabel && (
							<span id={sourceId} className="sr-only">
								{sourceLabel}
							</span>
						)}
						{saving ? (
							<LoaderCircle
								size={16}
								aria-hidden="true"
								className="flex-none animate-spin text-muted"
							/>
						) : (
							<ChevronDown
								size={16}
								aria-hidden="true"
								className="flex-none text-muted"
							/>
						)}
					</button>
					{open && (
						<div
							ref={popoverRef}
							id={popoverId}
							popover={supportsPopover ? "auto" : undefined}
							onKeyDown={(event) => {
								if (event.key !== "Escape") return;
								event.preventDefault();
								event.stopPropagation();
								setOpen(false);
								triggerRef.current?.focus();
							}}
							className="m-0 rounded-surface border border-solid border-line bg-surface p-1 shadow-overlay"
						>
							{canReset && (
								<button
									type="button"
									onClick={() => choose(null)}
									className="mb-1 flex w-full items-center gap-2 border-b border-line px-2 py-2 text-left text-sm text-ink hover:bg-hover"
								>
									<RotateCcw
										size={16}
										aria-hidden="true"
										className="flex-none text-muted"
									/>
									<span>Use automatic</span>
								</button>
							)}
							<div
								ref={listboxRef}
								id={listboxId}
								role="listbox"
								aria-labelledby={labelId}
								tabIndex={-1}
								onKeyDown={onListKeyDown}
								className="focus:outline-none"
							>
								{transactionCategoryOptions.map((option) => (
									<CategoryOption
										key={option.value}
										value={option.value}
										label={option.label}
										icon={categoryIcons[option.value]}
										selected={selected === option.value}
										onSelect={() => choose(option.value)}
									/>
								))}
							</div>
						</div>
					)}
				</div>
			</div>
			{error && (
				<p className="mt-1 text-xs text-danger-text" role="alert">
					{error}
				</p>
			)}
		</>
	);
}
