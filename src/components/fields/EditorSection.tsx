import { type ReactNode, useId } from "react";
import { Pill } from "@/components/present/Present";

// Editor-specific layout for the financial independence plan editor. Kept
// separate from the generic kit in field-kit.tsx so each file stays focused.

export function FinancialIndependenceEditorSection({
	number,
	title,
	description,
	children,
}: {
	number: string;
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<section className="overflow-hidden rounded-[1.35rem] border border-border/80 bg-surface/60 dark:border-white/10 dark:bg-surface/45">
			<header className="flex gap-3 border-b border-border/70 px-4 py-4 dark:border-white/10">
				<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary-border bg-primary-subtle type-label text-primary">
					{number}
				</span>
				<div>
					<h3 className="type-title text-base">{title}</h3>
					<p className="mt-0.5 max-w-3xl type-caption text-muted-foreground">
						{description}
					</p>
				</div>
			</header>
			<div className="space-y-4 p-4">{children}</div>
		</section>
	);
}

export interface ChoiceCardOption<TValue extends string> {
	value: TValue;
	label: string;
	badge?: string;
	description: ReactNode;
}

export function ChoiceCards<TValue extends string>({
	legend,
	description,
	value,
	options,
	onChange,
	columns,
}: {
	legend: string;
	description: string;
	value: TValue;
	options: Array<ChoiceCardOption<TValue>>;
	onChange: (value: TValue) => void;
	columns: string;
}) {
	const groupName = useId();
	return (
		<fieldset>
			<legend className="type-label text-foreground">{legend}</legend>
			<p className="mt-0.5 type-caption text-muted-foreground">{description}</p>
			<div className={`mt-3 grid gap-2 ${columns}`}>
				{options.map((option) => {
					const selected = value === option.value;
					return (
						<label
							key={option.value}
							className={`cursor-pointer rounded-2xl border p-4 transition ${
								selected
									? "border-primary-border bg-primary-subtle/55 shadow-sm"
									: "border-border/70 bg-card/55 hover:border-ring/60"
							}`}
						>
							<span className="flex items-start gap-2">
								<input
									type="radio"
									aria-label={option.label}
									name={groupName}
									value={option.value}
									checked={selected}
									onChange={() => onChange(option.value)}
									className="mt-1 accent-primary"
								/>
								<span>
									<span className="block type-label text-foreground">
										{option.label}
									</span>
									{option.badge ? (
										<Pill
											size="xs"
											textClassName="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
											className="mt-1 inline-block"
										>
											{option.badge}
										</Pill>
									) : null}
								</span>
							</span>
							<span className="mt-3 block type-caption leading-relaxed text-muted-foreground">
								{option.description}
							</span>
						</label>
					);
				})}
			</div>
		</fieldset>
	);
}
