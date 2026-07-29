import { Input } from "@/components/ui/input";

export interface IncomeFormValue {
	label: string;
	grossMonthlyIncome: string;
	taxRate: string;
	k401ContributionRate: string;
	k401EmployerMatchRate: string;
	k401AnnualCap: string;
	autoInvestRate: string;
	startDate: string;
}

interface IncomeFormProps {
	value: IncomeFormValue;
	onChange: (value: IncomeFormValue) => void;
}

const LABEL_CLASS = "block type-label mb-1";

const presets = [
	{
		label: "22% bracket",
		taxRate: 22,
		k401: 4,
		match: 50,
		cap: 23000,
		auto: 10,
	},
	{
		label: "24% bracket",
		taxRate: 24,
		k401: 6,
		match: 50,
		cap: 23000,
		auto: 15,
	},
	{
		label: "32% bracket",
		taxRate: 32,
		k401: 8,
		match: 3,
		cap: 22500,
		auto: 20,
	},
	{
		label: "No 401k / low tax",
		taxRate: 12,
		k401: 0,
		match: 0,
		cap: 0,
		auto: 25,
	},
];

export function IncomeForm({ value, onChange }: IncomeFormProps) {
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
									taxRate: String(p.taxRate),
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
					<label className={LABEL_CLASS}>Gross Monthly Income</label>
					<Input
						type="number"
						min={0}
						value={value.grossMonthlyIncome}
						onChange={(e) => update({ grossMonthlyIncome: e.target.value })}
						placeholder="10000"
					/>
				</div>
				<div>
					<label className={LABEL_CLASS}>Tax Rate (%)</label>
					<Input
						type="number"
						min={0}
						max={100}
						step={0.1}
						value={value.taxRate}
						onChange={(e) => update({ taxRate: e.target.value })}
						placeholder="22"
					/>
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
