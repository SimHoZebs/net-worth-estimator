import {
	AlertCircle,
	ArrowUpRight,
	Check,
	type LucideIcon,
	X,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import {
	type ComponentProps,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import "./ui.css";

export function IconButton({
	icon: Icon,
	label,
	onClick,
	className = "",
	disabled = false,
	...buttonProps
}: {
	icon: LucideIcon;
	label: string;
} & Omit<ComponentProps<"button">, "children">) {
	return (
		<button
			type="button"
			{...buttonProps}
			className={`icon-button ${className}`}
			aria-label={label}
			title={label}
			onClick={onClick}
			disabled={disabled}
		>
			<Icon size={18} aria-hidden="true" />
		</button>
	);
}

export function Badge({
	children,
	tone = "neutral",
}: {
	children: ReactNode;
	tone?: "neutral" | "green" | "amber" | "outline";
}) {
	return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Modal({
	title,
	eyebrow,
	children,
	onClose,
	wide = false,
	className = "",
	titleSize = "display",
	actions,
}: {
	title: ReactNode;
	eyebrow?: string;
	children: ReactNode;
	onClose: () => void;
	wide?: boolean;
	className?: string;
	/** Plain titles name the subject without competing with the content. */
	titleSize?: "display" | "plain";
	/** Extra icon buttons beside the corner close button. */
	actions?: ReactNode;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	const [closing, setClosing] = useState(false);
	const closeRequested = useRef(false);
	const reduceMotion = useReducedMotion();
	const id = useId();
	useEffect(() => {
		const dialog = ref.current;
		const previous = document.activeElement;
		dialog?.showModal();
		return () => {
			dialog?.close();
			if (previous instanceof HTMLElement && previous.isConnected)
				previous.focus();
		};
	}, []);
	const requestClose = () => {
		if (closeRequested.current) return;
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
			className={`modal ${wide ? "modal-wide" : ""} ${className}`}
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
				<div className="modal-header">
					<div>
						{eyebrow && <p className="eyebrow">{eyebrow}</p>}
						<h2
							id={id}
							className={
								titleSize === "plain" ? "modal-title-plain" : undefined
							}
						>
							{title}
						</h2>
					</div>
					<div className="modal-header-actions">
						{actions}
						<IconButton icon={X} label="Close dialog" onClick={requestClose} />
					</div>
				</div>
				<div className="modal-body">{children}</div>
			</motion.div>
		</dialog>
	);
}

export function ProjectionUpdating() {
	return (
		<div className="projection-updating" role="status">
			<span className="spinner" aria-hidden="true" />
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
		<div className="error-notice" role="alert">
			<AlertCircle size={20} aria-hidden="true" />
			<div>
				<p>{message}</p>
				{action && (
					<button type="button" className="text-button" onClick={onAction}>
						{action} <ArrowUpRight size={15} />
					</button>
				)}
			</div>
		</div>
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
		<div className="empty-state">
			<span className="empty-icon">
				<Icon size={28} />
			</span>
			<h3>{title}</h3>
			{description && <p>{description}</p>}
			{action && (
				<button type="button" className="button primary" onClick={onAction}>
					{action}
				</button>
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
		<label className="toggle-label">
			<input
				type="checkbox"
				role="switch"
				aria-checked={checked}
				checked={checked}
				onChange={(event) => onChange(event.target.checked)}
			/>
			<span className="toggle-track">
				<span>{checked && <Check size={10} />}</span>
			</span>
			<span>{label}</span>
		</label>
	);
}

export function Progress({
	value,
	label,
	tone = "green",
}: {
	value: number;
	label: string;
	tone?: "green" | "amber";
}) {
	return (
		<div
			className={`progress-track progress-${tone}`}
			role="progressbar"
			aria-label={label}
			aria-valuenow={Math.round(Math.min(100, Math.max(0, value)))}
			aria-valuemin={0}
			aria-valuemax={100}
		>
			<span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
		</div>
	);
}

export function Skeleton({
	width,
	height,
	label = "Loading",
}: {
	width?: number | string;
	height?: number | string;
	label?: string;
}) {
	return (
		<span
			className="skeleton"
			role="status"
			aria-label={label}
			aria-busy="true"
			style={{
				...(width !== undefined
					? { width: typeof width === "number" ? `${width}px` : width }
					: {}),
				...(height !== undefined
					? {
							height: typeof height === "number" ? `${height}px` : height,
						}
					: {}),
			}}
		/>
	);
}
