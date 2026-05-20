import { Input } from "@/components/ui/input";
import type { IncomeTemplateInput } from "@/lib/patterns";

interface IncomeFormProps {
	value: IncomeTemplateInput;
	onChange: (value: IncomeTemplateInput) => void;
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
	const update = (patch: Partial<IncomeTemplateInput>) =>
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
									taxRate: p.taxRate / 100,
									k401ContributionRate: p.k401 / 100,
									k401EmployerMatchRate: p.match / 100,
									k401AnnualCap: p.cap,
									autoInvestRate: p.auto / 100,
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
						value={value.grossMonthlyIncome || ""}
						onChange={(e) =>
							update({ grossMonthlyIncome: Number(e.target.value) })
						}
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
						value={Math.round(value.taxRate * 1000) / 10 || ""}
						onChange={(e) => update({ taxRate: Number(e.target.value) / 100 })}
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
						value={Math.round(value.k401ContributionRate * 1000) / 10 || ""}
						onChange={(e) =>
							update({ k401ContributionRate: Number(e.target.value) / 100 })
						}
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
						value={Math.round(value.k401EmployerMatchRate * 1000) / 10 || ""}
						onChange={(e) =>
							update({ k401EmployerMatchRate: Number(e.target.value) / 100 })
						}
						placeholder="50"
					/>
				</div>

				<div>
					<label className={LABEL_CLASS}>401(k) Annual Cap ($)</label>
					<Input
						type="number"
						min={0}
						step={500}
						value={value.k401AnnualCap || ""}
						onChange={(e) => update({ k401AnnualCap: Number(e.target.value) })}
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
						value={Math.round(value.autoInvestRate * 1000) / 10 || ""}
						onChange={(e) =>
							update({ autoInvestRate: Number(e.target.value) / 100 })
						}
						placeholder="10"
					/>
				</div>
			</div>
		</div>
	);
}
