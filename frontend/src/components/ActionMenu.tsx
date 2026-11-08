import { Ellipsis, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { IconButton } from "./Button.tsx";
import { mergeStyles } from "./mergeStyles.ts";
import { supportsPopover, useAnchoredPopover } from "./popoverAnchor.ts";

export interface ActionMenuItem {
	id: string;
	label: string;
	icon?: LucideIcon;
	onSelect: () => void;
	/** Renders a menuitemcheckbox with this checked state. */
	checked?: boolean;
	tone?: "default" | "danger";
	disabled?: boolean;
	/**
	 * Return focus to the trigger after selection. Defaults to true. Set false
	 * when the action opens a dialog or confirmation that takes focus itself.
	 */
	restoreFocus?: boolean;
}

/**
 * One compact actions menu for row-level and detail-level commands. The
 * trigger is a three-dot button; the menu closes on selection, outside click,
 * or Escape. Escape closes the menu first and leaves an enclosing Modal open;
 * the integration test covers the combined behavior.
 *
 * The menu paints in the top layer as an anchored popover, so an ancestor
 * transform, filter, or scroll container can never clip it. Browsers without
 * popover support keep the prior fixed-backdrop fallback.
 */
export function ActionMenu({
	items,
	label = "More options",
	menuLabel,
	align = "right",
}: {
	items: ActionMenuItem[];
	label?: string;
	menuLabel: string;
	align?: "left" | "right";
}) {
	const [open, setOpen] = useState(false);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const id = useId();

	useAnchoredPopover({
		open,
		triggerRef: buttonRef,
		popoverRef: menuRef,
		width: 240,
		align,
		onClose: () => setOpen(false),
		onOpenFocus: () => menuRef.current?.focus(),
	});

	useEffect(() => {
		if (open && !supportsPopover()) menuRef.current?.focus();
	}, [open]);

	useEffect(() => {
		if (!open || supportsPopover()) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			setOpen(false);
			buttonRef.current?.focus();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open]);

	if (items.length === 0) return null;

	const close = (restoreFocus: boolean) => {
		setOpen(false);
		if (restoreFocus) buttonRef.current?.focus();
	};

	const menuItems = items.map((item) => {
		const Icon = item.icon;
		return (
			<button
				key={item.id}
				type="button"
				role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
				aria-checked={item.checked}
				disabled={item.disabled}
				onClick={() => {
					close(item.restoreFocus ?? true);
					item.onSelect();
				}}
				className={mergeStyles(
					"flex w-full items-center gap-3 border-0 bg-transparent px-3 py-2 text-left text-sm hover:bg-hover pointer-coarse:min-h-12 disabled:opacity-60",
					item.tone === "danger" ? "text-danger-text" : undefined,
				)}
			>
				{Icon && <Icon size={14} aria-hidden="true" />}
				<span>{item.label}</span>
			</button>
		);
	});

	return (
		<span className="relative inline-flex">
			<IconButton
				ref={buttonRef}
				icon={Ellipsis}
				label={label}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? id : undefined}
				onClick={() => setOpen((value) => !value)}
			/>
			{open &&
				(supportsPopover() ? (
					<div
						id={id}
						ref={menuRef}
						tabIndex={-1}
						role="menu"
						aria-label={menuLabel}
						popover="auto"
						className="m-0 z-(--z-menu) w-60 rounded-surface border border-solid border-line bg-surface p-1 shadow-overlay focus:outline-none"
					>
						{menuItems}
					</div>
				) : (
					<>
						<button
							type="button"
							aria-label="Close menu"
							onClick={() => close(true)}
							className="fixed inset-0 z-(--z-sheet) cursor-default border-0 bg-transparent p-0"
						/>
						<div
							id={id}
							ref={menuRef}
							tabIndex={-1}
							role="menu"
							aria-label={menuLabel}
							className={mergeStyles(
								"absolute top-full z-(--z-menu) mt-1 w-60 rounded-surface border border-solid border-line bg-surface p-1 shadow-overlay focus:outline-none",
								align === "right" ? "right-0" : "left-0",
							)}
						>
							{menuItems}
						</div>
					</>
				))}
		</span>
	);
}
