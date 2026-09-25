import {
	AlertCircle,
	ArrowUpRight,
	Check,
	type LucideIcon,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

export function IconButton({
	icon: Icon,
	label,
	onClick,
	className = "",
	disabled = false,
}: {
	icon: LucideIcon;
	label: string;
	onClick: () => void;
	className?: string;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
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
}: {
	title: string;
	eyebrow?: string;
	children: ReactNode;
	onClose: () => void;
	wide?: boolean;
}) {
	const ref = useRef<HTMLDialogElement>(null);
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
	return (
		<dialog
			ref={ref}
			className={`modal ${wide ? "modal-wide" : ""}`}
			aria-labelledby={id}
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
		>
			<div className="modal-header">
				<div>
					{eyebrow && <p className="eyebrow">{eyebrow}</p>}
					<h2 id={id}>{title}</h2>
				</div>
				<IconButton icon={X} label="Close dialog" onClick={onClose} />
			</div>
			<div className="modal-body">{children}</div>
		</dialog>
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
				<strong>Something needs attention</strong>
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
	description: string;
	action?: string;
	onAction?: () => void;
}) {
	return (
		<div className="empty-state">
			<span className="empty-icon">
				<Icon size={28} />
			</span>
			<h3>{title}</h3>
			<p>{description}</p>
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
