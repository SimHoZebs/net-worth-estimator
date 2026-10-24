import { HardDrive, LockKeyhole } from "lucide-react";
import { Badge } from "../../components/ui.tsx";

export function SourceBanner({ sourceAccess }: { sourceAccess: string }) {
	return (
		<section className="mb-6 flex items-center gap-4 rounded-surface border border-success-border bg-success-bg p-6 max-sm:flex-wrap max-sm:gap-3 max-sm:p-5">
			<span className="text-success-text">
				<HardDrive size={25} />
			</span>
			<div className="flex-1 max-sm:flex-none">
				<h2 className="text-base max-sm:text-sm">Your saved model.</h2>
			</div>
			<Badge tone="outline">
				<LockKeyhole size={12} />
				{sourceAccess}
			</Badge>
		</section>
	);
}
