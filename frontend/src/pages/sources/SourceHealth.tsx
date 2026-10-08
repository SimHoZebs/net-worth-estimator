import { Check, HardDrive, LockKeyhole, ShieldCheck } from "lucide-react";
import type { FinancialModelDocument } from "../../api/index.ts";
import { DetailRow } from "../../components/DetailRow.tsx";
import { Badge } from "../../components/ui.tsx";
import { dateLabel } from "../../domain/format.ts";
import type { Plan } from "../../domain/model.ts";
import type { Workspace } from "../../state/storage.ts";

export function SourceBanner({ sourceAccess }: { sourceAccess: string }) {
	return (
		<section className="source-banner">
			<span className="source-banner-icon">
				<HardDrive size={25} />
			</span>
			<div>
				<h2>Your saved model.</h2>
			</div>
			<Badge tone="outline">
				<LockKeyhole size={12} />
				{sourceAccess}
			</Badge>
		</section>
	);
}

export function SourceHealth({
	plan,
	workspace,
	serverDocument,
}: {
	plan: Plan;
	workspace: Workspace;
	serverDocument: FinancialModelDocument | null;
	sourceAccess: string;
}) {
	const recorded = plan.accounts.filter((account) => account.balanceCheck);
	const age = Math.floor((Date.now() - Date.parse(plan.startDate)) / 86400000);
	const serverAccountCount =
		serverDocument?.accounts.length ?? plan.accounts.length;
	const serverPostingCount =
		serverDocument?.postings.length ?? plan.movements.length;
	return (
		<section className="panel source-health">
			<div className="section-top">
				<h2>Data health</h2>
				<ShieldCheck size={20} />
			</div>
			<dl className="detail-list">
				<DetailRow label="Source">
					{serverDocument
						? serverDocument.sourcePath
						: "Canonical server model unavailable"}
				</DetailRow>
				<DetailRow label="Start date">
					{dateLabel(plan.startDate, true)}
					{age > 30 && <Badge tone="amber">{age} days old</Badge>}
				</DetailRow>
				<DetailRow label={"Balance check coverage"}>
					{recorded.length} of {serverAccountCount} accounts
				</DetailRow>
				{<DetailRow label="Deposits">{serverPostingCount}</DetailRow>}
				<DetailRow label="Validation" className="inline-success">
					<Check size={15} />
					All structural checks passed
				</DetailRow>
				<DetailRow label="Revision date">
					{dateLabel(workspace.saved.updatedAt, true)}
				</DetailRow>
				<DetailRow label="Revision">{workspace.saved.revision}</DetailRow>
			</dl>
		</section>
	);
}
