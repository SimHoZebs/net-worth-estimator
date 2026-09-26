import { Check, HardDrive, LockKeyhole, ShieldCheck } from "lucide-react";
import type { FinancialModelDocument } from "../../api/index.ts";
import { DetailRow } from "../../components/DetailRow.tsx";
import { Badge } from "../../components/ui.tsx";
import { dateLabel } from "../../domain/format.ts";
import type { Plan } from "../../domain/model.ts";
import type { Workspace } from "../../state/storage.ts";

export function SourceBanner({
	plan,
	serverMode,
	sourceAccess,
}: {
	plan: Plan;
	serverMode: boolean;
	sourceAccess: string;
}) {
	return (
		<section className="source-banner">
			<span className="source-banner-icon">
				<HardDrive size={25} />
			</span>
			<div>
				<h2>
					{serverMode
						? "Your canonical server model lives on the server."
						: plan.origin === "example"
							? "An example plan. A real workspace."
							: "Your plan stays in your browser."}
				</h2>
				<p>
					{serverMode
						? "Export the authoritative server document below. Temporary edits and workspace backups stay in this browser for recovery."
						: plan.origin === "example"
							? "All figures are illustrative. Explore freely, or import your own plan."
							: "This workspace uses local data. There is no bank connection or server synchronization."}
				</p>
			</div>
			<Badge tone={serverMode ? "outline" : "green"}>
				<LockKeyhole size={12} />
				{serverMode ? sourceAccess : "Local only"}
			</Badge>
		</section>
	);
}

export function SourceHealth({
	plan,
	workspace,
	serverMode,
	serverDocument,
	sourceAccess,
}: {
	plan: Plan;
	workspace: Workspace;
	serverMode: boolean;
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
					{serverMode
						? serverDocument
							? serverDocument.sourcePath
							: "Canonical server model unavailable"
						: plan.origin === "example"
							? "Illustrative household"
							: "User-provided plan"}
				</DetailRow>
				<DetailRow label={serverMode ? "Display start" : "Starting position"}>
					{dateLabel(plan.startDate, true)}
					{age > 30 && <Badge tone="amber">{age} days old</Badge>}
				</DetailRow>
				<DetailRow
					label={
						serverMode ? "Display balance coverage" : "Balance-check coverage"
					}
				>
					{recorded.length} of {serverAccountCount} accounts
				</DetailRow>
				{serverMode && (
					<DetailRow label="Server postings">{serverPostingCount}</DetailRow>
				)}
				<DetailRow
					label={serverMode ? "Display validation" : "Validation"}
					className="inline-success"
				>
					<Check size={15} />
					All structural checks passed
				</DetailRow>
				<DetailRow
					label={serverMode ? "Display revision date" : "Last local save"}
				>
					{dateLabel(workspace.saved.updatedAt, true)}
				</DetailRow>
				<DetailRow label={serverMode ? "Display revision" : "Saved revision"}>
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
