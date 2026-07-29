// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createTableColumn, DataTable } from "./data-table";

interface TestRow {
	id: string;
	label: string;
	count: number;
}

const testColumn = createTableColumn<TestRow>();
testColumn({
	key: "count",
	label: "Count",
	render: (value) => {
		const count: number = value;
		return count;
	},
});
// @ts-expect-error Invalid row keys must fail at compile time.
testColumn({ key: "missing", label: "Missing" });

afterEach(cleanup);

function StatefulValue({ value }: { value: string }) {
	const [initialValue] = useState(value);
	return `${value}:${initialValue}`;
}

describe("DataTable", () => {
	it("keeps cell state attached to stable row identity when rows reorder", () => {
		const columns = [
			testColumn({
				key: "label",
				label: "Label",
				render: (value) => <StatefulValue value={value} />,
			}),
		];
		const rows = [
			{ id: "a", label: "Alpha", count: 1 },
			{ id: "b", label: "Beta", count: 2 },
		];
		const table = (orderedRows: TestRow[]) => (
			<DataTable<TestRow>
				title="Rows"
				description="Stable rows"
				rows={orderedRows}
				columns={columns}
				rowKey={(row) => row.id}
			/>
		);
		const { rerender } = render(table(rows));

		rerender(table([...rows].reverse()));

		expect(screen.getByText("Beta:Beta")).not.toBeNull();
		expect(screen.getByText("Alpha:Alpha")).not.toBeNull();
	});
});
