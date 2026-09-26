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
				<h2>Your canonical server model lives on the server.</h2>
				<p>
					Export the authoritative server document below. Temporary edits and
					workspace backups stay in this browser for recovery.
				</p>
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
	sourceAccess,
}: {
	plan: Plan;
	workspace: Workspace;
	serverDocument: FinancialModelDocument | null;
	sourceAccess: string;
}) {
	const recorded = plan.accounts.filter(
		(account) => account.provenance === "recorded",
	);
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
				<DetailRow label="Display start">
					{dateLabel(plan.startDate, true)}
					{age > 30 && <Badge tone="amber">{age} days old</Badge>}
				</DetailRow>
				<DetailRow label={"Display balance coverage"}>
					{recorded.length} of {serverAccountCount} accounts
				</DetailRow>
				{<DetailRow label="Server postings">{serverPostingCount}</DetailRow>}
				<DetailRow label="Display validation" className="inline-success">
					<Check size={15} />
					All structural checks passed
				</DetailRow>
				<DetailRow label="Display revision date">
					{dateLabel(workspace.saved.updatedAt, true)}
				</DetailRow>
				<DetailRow label="Display revision">
					{workspace.saved.revision}
				</DetailRow>
				<DetailRow label="Source access">{sourceAccess}</DetailRow>
			</dl>
			<p className="section-note">
				Validation checks structure and references. It does not independently
				verify balances, bank provenance, or financial assumptions.
			</p>
		</section>
	);
}
