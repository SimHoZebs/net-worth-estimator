import { Link } from "@tanstack/react-router";
import {
	brandIcon,
	brandLink,
	brandMark,
	brandPath,
} from "@/components/ui/brand.ts";

export function Brand() {
	return (
		<Link
			to="/outlook"
			preload="intent"
			className={brandLink}
			aria-label="Waypoint home"
		>
			<span className={brandMark}>
				<svg className={brandIcon} viewBox="0 0 32 32" aria-hidden="true">
					<path d={brandPath} />
				</svg>
			</span>
			<span className="group-data-[collapsible=icon]:hidden">
				waypoint<span className="text-primary">.</span>
			</span>
		</Link>
	);
}
