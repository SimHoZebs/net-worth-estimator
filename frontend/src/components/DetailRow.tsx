import type { ReactNode } from "react";

export function DetailRow({
	label,
	children,
	className,
}: {
	label: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div>
			<dt>{label}</dt>
			<dd className={className}>{children}</dd>
		</div>
	);
}
