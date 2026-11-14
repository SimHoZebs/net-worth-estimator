import { Link } from "@tanstack/react-router";

const brandLink = "flex items-center gap-2 text-2xl font-bold tracking-tight";
const brandMark = "grid size-8 place-items-center rounded-xl bg-primary";
const brandIcon =
	"w-7 fill-none stroke-primary-foreground [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2]";
const brandPath = "m5 23 6-15 6 12 5-9 5 12";

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
			<span>
				waypoint<span className="text-primary">.</span>
			</span>
		</Link>
	);
}
