import { useId, useRef, useState, type KeyboardEvent } from "react";
import {
	Check,
	ChevronDown,
	LoaderCircle,
	RotateCcw,
	type LucideIcon,
} from "lucide-react";
import { mergeStyles } from "./mergeStyles.ts";
import { controlStyles } from "./fieldStyles.ts";
import { supportsPopover, useAnchoredPopover } from "./popoverAnchor.ts";

export interface OptionPickerOption {
	value: string;
	label: string;
	icon: LucideIcon;
}

function PickerOption({
	label,
	icon: Icon,
	selected,
	onSelect,
}: {
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
 * Shared icon-picker select: a button trigger opening an anchored
 * top-layer listbox with one icon per option. Used for transaction
 * categories and account types so both pickers share one interaction,
 * keyboard, and focus contract. Selection reports through onSelect;
 * saving, drafts, and reset rows stay with the caller.
 */
export function OptionPicker({
	label,
	labelClassName = "w-36 flex-none text-sm font-semibold text-muted",
	triggerId: triggerIdProp,
	value,
	valueLabel,
	ValueIcon,
	options,
	onSelect,
	disabled,
	saving,
	resetLabel,
	onReset,
	sourceLabel,
}: {
	label: string;
	labelClassName?: string;
	/** Stable id for the trigger button; defaults to an internal id. Lets
	 * owners return focus to the trigger, e.g. after discarding a draft. */
	triggerId?: string;
	value: string;
	valueLabel: string;
	ValueIcon: LucideIcon;
	options: OptionPickerOption[];
	onSelect: (value: string) => void;
	disabled?: boolean;
	saving?: boolean;
	resetLabel?: string;
	onReset?: () => void;
	sourceLabel?: string | null;
}) {
	const id = useId();
	const labelId = `${id}-label`;
	const triggerId = triggerIdProp ?? `${id}-trigger`;
	const valueId = `${id}-value`;
	const sourceId = `${id}-source`;
	const listboxId = `${id}-listbox`;
	const popoverId = `${id}-popover`;
	const triggerRef = useRef<HTMLButtonElement>(null);
	const listboxRef = useRef<HTMLDivElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);

	useAnchoredPopover({
		open,
		triggerRef,
		popoverRef,
		onClose: () => setOpen(false),
		onOpenFocus: () => {
			const list = listboxRef.current;
			const selectedOption = list?.querySelector<HTMLElement>(
				'[role="option"][aria-selected="true"]',
			);
			(selectedOption ?? list)?.focus({ preventScroll: true });
		},
	});

	const choose = (next: string | null) => {
		if (disabled || saving) return;
		setOpen(false);
		triggerRef.current?.focus();
		if (next !== null) onSelect(next);
		else onReset?.();
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
		<div className="flex items-center gap-4 border-t border-line py-2 first:border-t-0 first:pt-0 last:pb-0">
			<label id={labelId} htmlFor={triggerId} className={labelClassName}>
				{label}
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
					disabled={disabled || saving}
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
					<ValueIcon
						size={16}
						aria-hidden="true"
						className="flex-none text-muted"
					/>
					<span id={valueId} className="min-w-0 flex-1 truncate">
						{valueLabel}
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
						popover={supportsPopover() ? "auto" : undefined}
						onKeyDown={(event) => {
							if (event.key !== "Escape") return;
							event.preventDefault();
							event.stopPropagation();
							setOpen(false);
							triggerRef.current?.focus();
						}}
						className="m-0 z-(--z-menu) rounded-surface border border-solid border-line bg-surface p-1 shadow-overlay"
					>
						{resetLabel && onReset && (
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
								<span>{resetLabel}</span>
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
							{options.map((option) => (
								<PickerOption
									key={option.value}
									label={option.label}
									icon={option.icon}
									selected={value === option.value}
									onSelect={() => choose(option.value)}
								/>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
