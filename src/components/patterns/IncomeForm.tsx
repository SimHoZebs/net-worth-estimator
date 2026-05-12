import type { IncomeTemplateInput } from "@/lib/patterns";

interface IncomeFormProps {
	value: IncomeTemplateInput;
	onChange: (value: IncomeTemplateInput) => void;
}

const FIELD_CLASS =
	"w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm outline-none focus:border-slate-400 dark:focus:border-slate-500 focus:ring-1 focus:ring-slate-300 dark:focus:ring-slate-600";
const LABEL_CLASS =
	"block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1";

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
				<span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
					Quick presets
				</span>
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
							className="rounded-full border border-slate-200 dark:border-slate-700 px-2.5 py-0.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/80 transition-colors"
						>
							{p.label}
						</button>
					))}
				</div>
			</div>

			<div className="grid grid-cols-2 gap-3">
				<div>
					<label className={LABEL_CLASS}>Label</label>
					<input
						className={FIELD_CLASS}
						value={value.label}
						onChange={(e) => update({ label: e.target.value })}
						placeholder="e.g. Acme Salary"
					/>
				</div>
				<div>
					<label className={LABEL_CLASS}>Start Date</label>
					<input
						className={FIELD_CLASS}
						value={value.startDate}
						onChange={(e) => update({ startDate: e.target.value })}
						placeholder="YYYY-MM-DD"
					/>
				</div>

				<div>
					<label className={LABEL_CLASS}>Gross Monthly Income</label>
					<input
						type="number"
						min={0}
						className={FIELD_CLASS}
						value={value.grossMonthlyIncome || ""}
						onChange={(e) =>
							update({ grossMonthlyIncome: Number(e.target.value) })
						}
						placeholder="10000"
					/>
				</div>
				<div>
					<label className={LABEL_CLASS}>Tax Rate (%)</label>
					<input
						type="number"
						min={0}
						max={100}
						step={0.1}
						className={FIELD_CLASS}
						value={Math.round(value.taxRate * 1000) / 10 || ""}
						onChange={(e) => update({ taxRate: Number(e.target.value) / 100 })}
						placeholder="22"
					/>
				</div>

				<div>
					<label className={LABEL_CLASS}>401(k) Contribution (%)</label>
					<input
						type="number"
						min={0}
						max={100}
						step={0.1}
						className={FIELD_CLASS}
						value={Math.round(value.k401ContributionRate * 1000) / 10 || ""}
						onChange={(e) =>
							update({ k401ContributionRate: Number(e.target.value) / 100 })
						}
						placeholder="4"
					/>
				</div>
				<div>
					<label className={LABEL_CLASS}>Employer Match (%)</label>
					<input
						type="number"
						min={0}
						max={100}
						step={0.1}
						className={FIELD_CLASS}
						value={Math.round(value.k401EmployerMatchRate * 1000) / 10 || ""}
						onChange={(e) =>
							update({ k401EmployerMatchRate: Number(e.target.value) / 100 })
						}
						placeholder="50"
					/>
				</div>

				<div>
					<label className={LABEL_CLASS}>401(k) Annual Cap ($)</label>
					<input
						type="number"
						min={0}
						step={500}
						className={FIELD_CLASS}
						value={value.k401AnnualCap || ""}
						onChange={(e) => update({ k401AnnualCap: Number(e.target.value) })}
						placeholder="23000"
					/>
				</div>
				<div>
					<label className={LABEL_CLASS}>Auto-invest After Tax (%)</label>
					<input
						type="number"
						min={0}
						max={100}
						step={0.1}
						className={FIELD_CLASS}
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
