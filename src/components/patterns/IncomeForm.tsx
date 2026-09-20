import {
	Field,
	FieldSelect,
	LabeledField,
} from "@/components/fields/field-kit";
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
				<LabeledField
					label="Label"
					id="income-template-label"
					value={value.label}
					onChange={(label) => update({ label })}
					placeholder="e.g. Acme Salary"
				/>
				<LabeledField
					label="Start Date"
					id="income-template-start-date"
					value={value.startDate}
					onChange={(startDate) => update({ startDate })}
					placeholder="YYYY-MM-DD"
				/>

				<Field label="Income source" id="income-template-source">
					<FieldSelect
						id="income-template-source"
						aria-label="Income source"
						value={value.incomeSourceId}
						onChange={(e) => update({ incomeSourceId: e.target.value })}
					>
						<option value="">Select income source</option>
						{incomeSources.map((source) => (
							<option key={source.id} value={source.id}>
								{source.label}
							</option>
						))}
					</FieldSelect>
				</Field>
				<Field label="Tax profile" id="income-template-tax">
					<FieldSelect
						id="income-template-tax"
						aria-label="Tax profile"
						value={value.taxProfileId}
						onChange={(e) => update({ taxProfileId: e.target.value })}
					>
						<option value="">Select tax profile</option>
						{taxProfiles.map((profile) => (
							<option key={profile.id} value={profile.id}>
								{profile.label}
							</option>
						))}
					</FieldSelect>
				</Field>

				<LabeledField
					label="401(k) Contribution (%)"
					id="income-template-contribution"
					type="number"
					min={0}
					max={100}
					step={0.1}
					value={value.k401ContributionRate}
					onChange={(k401ContributionRate) => update({ k401ContributionRate })}
					placeholder="4"
				/>
				<LabeledField
					label="Employer Match (%)"
					id="income-template-match"
					type="number"
					min={0}
					max={100}
					step={0.1}
					value={value.k401EmployerMatchRate}
					onChange={(k401EmployerMatchRate) =>
						update({ k401EmployerMatchRate })
					}
					placeholder="50"
				/>

				<LabeledField
					label="401(k) Annual Cap ($)"
					id="income-template-cap"
					type="number"
					min={0}
					step={500}
					value={value.k401AnnualCap}
					onChange={(k401AnnualCap) => update({ k401AnnualCap })}
					placeholder="23000"
				/>
				<LabeledField
					label="Auto-invest After Tax (%)"
					id="income-template-auto-invest"
					type="number"
					min={0}
					max={100}
					step={0.1}
					value={value.autoInvestRate}
					onChange={(autoInvestRate) => update({ autoInvestRate })}
					placeholder="10"
				/>
			</div>
		</div>
	);
}
