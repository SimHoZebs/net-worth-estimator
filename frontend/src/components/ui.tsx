import {
	AlertCircle,
	ArrowUpRight,
	Check,
	type LucideIcon,
	X,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cssVariables } from "./cssVariables.ts";
import { mergeStyles } from "./mergeStyles.ts";
import { Button, IconButton, TextButton } from "./Button.tsx";
import { useOpenModalRegistration } from "./modalStack.ts";
import { dialogBodyStyles, dialogHeaderStyles } from "./dialogStyles.ts";
import { Notice } from "./Notice.tsx";
import type { VariantProps } from "class-variance-authority";
import {
	badgeStyles,
	progressFillStyles,
	progressTrackStyles,
} from "./uiStyles.ts";

export { IconButton } from "./Button.tsx";

export function Badge({
	children,
	tone = "neutral",
	className,
}: {
	children: ReactNode;
	className?: string;
} & VariantProps<typeof badgeStyles>) {
	return (
		<span className={mergeStyles(badgeStyles({ tone }), className)}>
			{children}
		</span>
	);
}

export function Modal({
	title,
	eyebrow,
	children,
	onClose,
	onCloseRequest,
	wide = false,
	className = "",
	headerClassName,
	bodyClassName,
	titleSize = "display",
	actions,
	focusPanelOnOpen = false,
}: {
	title: ReactNode;
	eyebrow?: string;
	children: ReactNode;
	onClose: () => void;
	/** Return false to keep the dialog visible, such as for unsaved-form confirmation. */
	onCloseRequest?: () => boolean;
	wide?: boolean;
	className?: string;
	headerClassName?: string;
	bodyClassName?: string;
	/** Plain titles name the subject without competing with the content. */
	titleSize?: "display" | "plain";
	/** Extra icon buttons beside the corner close button. */
	actions?: ReactNode;
	/**
	 * Focus the panel itself on open instead of the browser default (first
	 * focusable control). For dialogs whose first control is a value that
	 * looks like text, an initial focus ring reads as a rendering bug.
	 */
	focusPanelOnOpen?: boolean;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	// Mounted means open for this component: showModal runs on mount.
	useOpenModalRegistration(true);
	const [closing, setClosing] = useState(false);
	const closeRequested = useRef(false);
	const reduceMotion = useReducedMotion();
	const id = useId();
	useEffect(() => {
		const dialog = ref.current;
		const previous = document.activeElement;
		dialog?.showModal();
		if (focusPanelOnOpen) panelRef.current?.focus();
		return () => {
			dialog?.close();
			if (previous instanceof HTMLElement && previous.isConnected)
				previous.focus();
		};
		// oxlint-disable-next-line react/exhaustive-deps
	}, []);
	const requestClose = () => {
		if (closeRequested.current) return;
		if (onCloseRequest?.() === false) return;
		closeRequested.current = true;
		setClosing(true);
	};
	// Centered dialogs scale/fade. Drawer sheets are the shared Drawer
	// component; the native <dialog> stays static so showModal top-layer,
	// focus, and backdrop behavior are unchanged — motion owns only the
	// inner panel.
	const enter = { opacity: 1, scale: 1, y: 0 };
	const initial = { opacity: 0, scale: 0.97, y: 8 };
	const exit = { opacity: 0, scale: 0.98, y: 8 };
	return (
		<dialog
			ref={ref}
			className={mergeStyles(
				"max-h-[90dvh] w-full max-w-[calc(100%_-_--spacing(6))] rounded-surface border border-solid border-line-strong bg-surface p-0 text-ink shadow-overlay backdrop:bg-backdrop-film backdrop:backdrop-blur-(--backdrop-blur)",
				wide ? "w-3xl" : "w-xl",
				className,
			)}
			aria-labelledby={id}
			onCancel={(event) => {
				event.preventDefault();
				requestClose();
			}}
			onClick={(event) => {
				if (event.target === event.currentTarget) requestClose();
			}}
		>
			<motion.div
				ref={panelRef}
				tabIndex={focusPanelOnOpen ? -1 : undefined}
				className="focus:outline-none"
				initial={initial}
				animate={closing ? exit : enter}
				transition={{
					duration: reduceMotion ? 0 : closing ? 0.12 : 0.15,
					ease: "easeOut",
				}}
				onAnimationComplete={() => {
					if (closing) onClose();
				}}
			>
				<div className={mergeStyles(dialogHeaderStyles, headerClassName)}>
					<div className="min-w-0 flex-1">
						{eyebrow && (
							<p className="mb-2 text-xs font-bold tracking-widest text-muted">
								{eyebrow}
							</p>
						)}
						<h2
							id={id}
							className={
								titleSize === "plain"
									? "text-sm leading-snug font-semibold tracking-normal"
									: "type-display text-3xl leading-tight font-normal tracking-tight"
							}
						>
							{title}
						</h2>
					</div>
					<div className="flex flex-none flex-wrap items-center justify-end gap-1">
						{actions}
						<IconButton icon={X} label="Close dialog" onClick={requestClose} />
					</div>
				</div>
				<div className={mergeStyles(dialogBodyStyles, bodyClassName)}>
					{children}
				</div>
			</motion.div>
		</dialog>
	);
}

export function ProjectionUpdating() {
	return (
		<div
			className="mb-4 flex items-center gap-3 text-sm text-muted"
			role="status"
		>
			<span
				className="size-3 animate-spin rounded-full border-2 border-solid border-line-strong border-t-primary"
				aria-hidden="true"
			/>
			Updating projection…
		</div>
	);
}

export function ErrorNotice({
	message,
	action,
	onAction,
}: {
	message: string;
	action?: string;
	onAction?: () => void;
}) {
	return (
		<Notice tone="danger" className="mb-5 p-5 text-sm" role="alert">
			<AlertCircle size={20} className="mt-0.5" aria-hidden="true" />
			<div>
				<p className="my-1 whitespace-pre-line text-danger-text">{message}</p>
				{action && (
					<TextButton tone="danger" className="mt-2" onClick={onAction}>
						{action} <ArrowUpRight size={15} />
					</TextButton>
				)}
			</div>
		</Notice>
	);
}

export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
	onAction,
}: {
	icon: LucideIcon;
	title: string;
	description?: string;
	action?: string;
	onAction?: () => void;
}) {
	return (
		<div className="flex flex-col items-center px-6 py-12 text-center">
			<span className="mb-5 grid size-16 place-items-center rounded-full bg-success-bg text-success-text">
				<Icon size={28} />
			</span>
			<h3 className="text-lg">{title}</h3>
			{description && (
				<p className="mt-2 mb-5 max-w-sm text-sm">{description}</p>
			)}
			{action && (
				<Button variant="primary" onClick={onAction}>
					{action}
				</Button>
			)}
		</div>
	);
}

export function Toggle({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<label className="relative inline-flex cursor-pointer items-center gap-2 text-xs text-muted max-sm:min-h-7 max-sm:gap-1">
			<input
				type="checkbox"
				role="switch"
				aria-checked={checked}
				checked={checked}
				className="peer absolute w-px opacity-0"
				onChange={(event) => onChange(event.target.checked)}
			/>
			<span className="flex h-4 w-7 items-center rounded-full bg-line-strong p-0.5 transition-colors duration-150 peer-checked:bg-primary peer-focus-visible:outline-3 peer-focus-visible:outline-solid peer-focus-visible:outline-primary peer-focus-visible:outline-offset-1">
				<span
					className={`grid size-3 place-items-center rounded-full bg-surface text-primary transition-transform duration-150 ${checked ? "translate-x-3" : ""}`}
				>
					{checked && <Check size={10} />}
				</span>
			</span>
			<span>{label}</span>
		</label>
	);
}

export function Progress({
	value,
	label,
	tone = "success",
}: {
	value: number;
	label: string;
} & VariantProps<typeof progressTrackStyles>) {
	return (
		<div
			className={progressTrackStyles({ tone })}
			role="progressbar"
			aria-label={label}
			aria-valuenow={Math.round(Math.min(100, Math.max(0, value)))}
			aria-valuemin={0}
			aria-valuemax={100}
		>
			<span
				className={progressFillStyles({ tone })}
				style={cssVariables({
					"--progress-width": `${Math.min(100, Math.max(0, value))}%`,
				})}
			/>
		</div>
	);
}

export function Skeleton({
	className,
	label = "Loading",
}: {
	className?: string;
	label?: string;
}) {
	return (
		<span
			className={mergeStyles(
				"block h-4 w-full max-w-full animate-[skeleton-pulse_1.2s_ease-in-out_infinite] rounded-control bg-line-strong opacity-55",
				className,
			)}
			role="status"
			aria-label={label}
			aria-busy="true"
		/>
	);
}
