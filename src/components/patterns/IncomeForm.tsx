import { Input } from "@/components/ui/input";
import type {
	IncomeSourceDefinition,
	IncomeTaxProfile,
} from "@/lib/projection";

export interface IncomeFormValue {
	label: string;
	incomeSourceId: string;
	taxProfileId: string;
	k401ContributionRate: string;
	k401EmployerMatchRate: string;
	k401AnnualCap: string;
	autoInvestRate: string;
	startDate: string;
}

interface IncomeFormProps {
	value: IncomeFormValue;
	onChange: (value: IncomeFormValue) => void;
	incomeSources: IncomeSourceDefinition[];
	taxProfiles: IncomeTaxProfile[];
}

const LABEL_CLASS = "block type-label mb-1";

const presets = [
	{
		label: "Balanced savings",
		k401: 4,
		match: 50,
		cap: 23000,
		auto: 10,
	},
	{
		label: "Higher 401(k)",
		k401: 6,
		match: 50,
		cap: 23000,
		auto: 15,
	},
	{
		label: "Aggressive investing",
		k401: 8,
		match: 3,
		cap: 22500,
		auto: 20,
	},
	{
		label: "No 401(k)",
		k401: 0,
		match: 0,
		cap: 0,
		auto: 25,
	},
];

export function IncomeForm({
	value,
	onChange,
	incomeSources,
	taxProfiles,
}: IncomeFormProps) {
	const update = (patch: Partial<IncomeFormValue>) =>
		onChange({ ...value, ...patch });

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2 mb-2">
				<span className="type-eyebrow">Quick presets</span>
				<div className="flex gap-1.5 flex-wrap">
					{presets.map((p) => (
						<button
							type="button"
							key={p.label}
							onClick={() =>
								onChange({
									...value,
									k401ContributionRate: String(p.k401),
									k401EmployerMatchRate: String(p.match),
									k401AnnualCap: String(p.cap),
									autoInvestRate: String(p.auto),
								})
							}
							className="rounded-full border border-border px-2.5 py-0.5 type-caption hover:bg-muted  transition-colors"
						>
							{p.label}
						</button>
					))}
				</div>
			</div>

			<div className="grid grid-cols-2 gap-3">
				<div>
					<label className={LABEL_CLASS}>Label</label>
					<Input
						value={value.label}
						onChange={(e) => update({ label: e.target.value })}
						placeholder="e.g. Acme Salary"
					/>
				</div>
				<div>
					<label className={LABEL_CLASS}>Start Date</label>
					<Input
						value={value.startDate}
						onChange={(e) => update({ startDate: e.target.value })}
						placeholder="YYYY-MM-DD"
					/>
				</div>

				<div>
					<label className={LABEL_CLASS}>Income source</label>
					<select
						className="h-9 w-full rounded-md border border-input bg-background px-3 type-body"
						value={value.incomeSourceId}
						onChange={(e) => update({ incomeSourceId: e.target.value })}
					>
						<option value="">Select income source</option>
						{incomeSources.map((source) => (
							<option key={source.id} value={source.id}>
								{source.label}
							</option>
						))}
					</select>
				</div>
				<div>
					<label className={LABEL_CLASS}>Tax profile</label>
					<select
						className="h-9 w-full rounded-md border border-input bg-background px-3 type-body"
						value={value.taxProfileId}
						onChange={(e) => update({ taxProfileId: e.target.value })}
					>
						<option value="">Select tax profile</option>
						{taxProfiles.map((profile) => (
							<option key={profile.id} value={profile.id}>
								{profile.label}
							</option>
						))}
					</select>
				</div>

				<div>
					<label className={LABEL_CLASS}>401(k) Contribution (%)</label>
					<Input
						type="number"
						min={0}
						max={100}
						step={0.1}
						value={value.k401ContributionRate}
						onChange={(e) => update({ k401ContributionRate: e.target.value })}
						placeholder="4"
					/>
				</div>
				<div>
					<label className={LABEL_CLASS}>Employer Match (%)</label>
					<Input
						type="number"
						min={0}
						max={100}
						step={0.1}
						value={value.k401EmployerMatchRate}
						onChange={(e) => update({ k401EmployerMatchRate: e.target.value })}
						placeholder="50"
					/>
				</div>

				<div>
					<label className={LABEL_CLASS}>401(k) Annual Cap ($)</label>
					<Input
						type="number"
						min={0}
						step={500}
						value={value.k401AnnualCap}
						onChange={(e) => update({ k401AnnualCap: e.target.value })}
						placeholder="23000"
					/>
				</div>
				<div>
					<label className={LABEL_CLASS}>Auto-invest After Tax (%)</label>
					<Input
						type="number"
						min={0}
						max={100}
						step={0.1}
						value={value.autoInvestRate}
						onChange={(e) => update({ autoInvestRate: e.target.value })}
						placeholder="10"
					/>
				</div>
			</div>
		</div>
	);
}
