import type { Key, ReactNode } from "react";
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

interface TableColumnDefinition<TRow, TKey extends keyof TRow> {
	key: TKey;
	label: string;
	format?: (value: TRow[TKey], row: TRow) => string;
	render?: (value: TRow[TKey], row: TRow, rowIndex: number) => ReactNode;
}

export interface TableColumn<TRow> {
	key: keyof TRow;
	label: string;
	render: (row: TRow, rowIndex: number) => ReactNode;
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

export function createTableColumn<TRow extends object>() {
	return <TKey extends keyof TRow>({
		key,
		label,
		format,
		render,
	}: TableColumnDefinition<TRow, TKey>): TableColumn<TRow> => ({
		key,
		label,
		render: (row, rowIndex) => {
			const value = row[key];
			if (render) return render(value, row, rowIndex);
			if (format) return format(value, row);
			return formatValue(value);
		},
	});
}

export function DataTable<TRow extends object>({
	title,
	description,
	rows,
	columns,
	rowKey,
	emptyText = "No rows.",
	variant = "card",
}: {
	title: string;
	description: string;
	rows: TRow[];
	columns: TableColumn<TRow>[];
	rowKey: (row: TRow) => Key;
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
						<TableRow key={rowKey(row)}>
							{columns.map((column) => (
								<TableCell key={String(column.key)}>
									{column.render(row, ri)}
								</TableCell>
							))}
						</TableRow>
					))
				) : (
					<TableRow>
						<TableCell
							colSpan={columns.length}
							className="py-6 text-center text-muted-foreground"
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
					<div className="type-title">{title}</div>
					<div className="type-caption">{description}</div>
				</div>
				{table}
			</div>
		);
	}

	return (
		<Card className="rounded-[1.8rem] border-border shadow-sm ">
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>{table}</CardContent>
		</Card>
	);
}
