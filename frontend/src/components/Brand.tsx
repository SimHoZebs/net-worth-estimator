import { Link } from "@tanstack/react-router";
import { brand } from "./brandStyles.ts";

export function Brand() {
	return (
		<Link
			to="/outlook"
			preload="intent"
			className={brand.link}
			aria-label="Waypoint home"
		>
			<span className={brand.mark}>
				<svg className={brand.icon} viewBox="0 0 32 32" aria-hidden="true">
					<path d={brand.path} />
				</svg>
			</span>
			<span>
				waypoint<span className="text-primary">.</span>
			</span>
		</Link>
	);
}
