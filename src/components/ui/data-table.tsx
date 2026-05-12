import type { ReactNode } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { currency, decimal, integer } from "@/lib/format";

export interface TableColumn<TRow> {
	key: keyof TRow;
	label: string;
	format?: (value: TRow[keyof TRow], row: TRow) => string;
	render?: (value: TRow[keyof TRow], row: TRow, rowIndex: number) => ReactNode;
}

function formatValue(value: unknown) {
	if (value === null || value === undefined || value === "") return "-";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number")
		return Number.isInteger(value)
			? integer.format(value)
			: decimal.format(value);
	if (Array.isArray(value)) return value.join(" ; ");
	return String(value);
}

export function formatCurrency(v: unknown) {
	return typeof v === "number" ? currency.format(v) : formatValue(v);
}

export function DataTable<TRow extends object>({
	title,
	description,
	rows,
	columns,
	emptyText = "No rows.",
	variant = "card",
}: {
	title: string;
	description: string;
	rows: TRow[];
	columns: TableColumn<TRow>[];
	emptyText?: string;
	variant?: "card" | "flat";
}) {
	const table = (
		<Table>
			<TableHeader>
				<TableRow>
					{columns.map((c) => (
						<TableHead key={String(c.key)}>{c.label}</TableHead>
					))}
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.length > 0 ? (
					rows.map((row, ri) => (
						<TableRow key={`${title}-${ri}`}>
							{columns.map((c) => {
								const v = row[c.key as keyof TRow];
								return (
									<TableCell key={String(c.key)}>
										{c.render
											? c.render(v, row, ri)
											: c.format
												? c.format(v, row)
												: formatValue(v)}
									</TableCell>
								);
							})}
						</TableRow>
					))
				) : (
					<TableRow>
						<TableCell
							colSpan={columns.length}
							className="py-6 text-center text-slate-500 dark:text-slate-400"
						>
							{emptyText}
						</TableCell>
					</TableRow>
				)}
			</TableBody>
		</Table>
	);

	if (variant === "flat") {
		return (
			<div className="space-y-2">
				<div>
					<div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
						{title}
					</div>
					<div className="text-xs text-slate-500 dark:text-slate-400">
						{description}
					</div>
				</div>
				{table}
			</div>
		);
	}

	return (
		<Card className="rounded-[1.8rem] border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-slate-900/30">
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>{table}</CardContent>
		</Card>
	);
}
