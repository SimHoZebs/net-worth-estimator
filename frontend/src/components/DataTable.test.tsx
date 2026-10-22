import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountIcon, AccountLabel } from "./AccountIcon.tsx";
import { DetailList, DetailRow } from "./DetailRow.tsx";
import {
	DataTable,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TablePagination,
	TableRow,
	TableScroll,
} from "./DataTable.tsx";

afterEach(cleanup);

describe("native table ownership", () => {
	it("preserves native props and refs while merging external overrides", () => {
		const table = createRef<HTMLTableElement>();
		const head = createRef<HTMLTableSectionElement>();
		const body = createRef<HTMLTableSectionElement>();
		const row = createRef<HTMLTableRowElement>();
		const header = createRef<HTMLTableCellElement>();
		const cell = createRef<HTMLTableCellElement>();
		const scroll = createRef<HTMLDivElement>();
		const onClick = vi.fn();
		render(
			<TableScroll
				ref={scroll}
				id="balances"
				className="overflow-x-visible"
				tabIndex={0}
			>
				<Table ref={table} aria-label="Balances" className="text-xs">
					<TableHead ref={head}>
						<TableRow>
							<TableHeader ref={header} abbr="Acct">
								Account
							</TableHeader>
						</TableRow>
					</TableHead>
					<TableBody ref={body}>
						<TableRow ref={row} onClick={onClick} data-record="cash">
							<TableHeader scope="row">Cash</TableHeader>
							<TableCell
								ref={cell}
								colSpan={2}
								className="px-2 py-1 whitespace-normal"
							>
								$100
							</TableCell>
						</TableRow>
					</TableBody>
				</Table>
			</TableScroll>,
		);
		expect(table.current).toBe(screen.getByRole("table"));
		expect(head.current?.tagName).toBe("THEAD");
		expect(body.current?.tagName).toBe("TBODY");
		expect(header.current?.getAttribute("scope")).toBe("col");
		expect(header.current?.getAttribute("abbr")).toBe("Acct");
		expect(screen.getByRole("rowheader").getAttribute("scope")).toBe("row");
		expect(row.current?.getAttribute("data-record")).toBe("cash");
		expect(row.current?.classList.contains("last:border-b-0")).toBe(true);
		expect(cell.current?.colSpan).toBe(2);
		expect(cell.current?.classList.contains("px-5")).toBe(false);
		expect(cell.current?.classList.contains("py-4")).toBe(false);
		expect(cell.current?.classList.contains("px-2")).toBe(true);
		expect(table.current?.classList.contains("text-sm")).toBe(false);
		expect(scroll.current?.id).toBe("balances");
		expect(scroll.current?.classList.contains("overflow-x-auto")).toBe(false);
		fireEvent.click(row.current!);
		expect(onClick).toHaveBeenCalledOnce();
	});

	it("keeps caller rows, captions, and opt-in column headers", () => {
		const ref = createRef<HTMLTableElement>();
		const { rerender } = render(
			<DataTable
				ref={ref}
				caption="Account balances"
				columns={[{ label: "Account" }]}
				scrollId="account-table"
			>
				<TableRow>
					<TableHeader scope="row">Checking</TableHeader>
				</TableRow>
			</DataTable>,
		);
		expect(screen.queryByRole("columnheader")).toBeNull();
		expect(screen.getByRole("table", { name: "Account balances" })).toBe(
			ref.current,
		);
		expect(
			screen.getByRole("region", { name: "Account balances" }).tabIndex,
		).toBe(0);
		expect(screen.getByRole("region").id).toBe("account-table");
		rerender(
			<DataTable
				caption="Account balances"
				columns={[{ label: "Account" }, { label: "Actions", srOnly: true }]}
				showHeaders
			>
				<TableRow>
					<TableCell colSpan={2}>Caller-owned contents</TableCell>
				</TableRow>
			</DataTable>,
		);
		expect(screen.getAllByRole("columnheader")).toHaveLength(2);
		expect(
			screen.getByRole("columnheader", { name: "Actions" }).firstElementChild
				?.className,
		).toBe("sr-only");
		expect(screen.getByRole("cell").getAttribute("colspan")).toBe("2");
	});

	it("frames pagination explicitly, independent of ancestor classes", () => {
		const onPage = vi.fn();
		const { rerender } = render(
			<section>
				<TablePagination
					page={0}
					pageCount={3}
					total={25}
					pageSize={10}
					onPage={onPage}
				/>
			</section>,
		);
		const pager = screen.getByRole("status").parentElement!;
		expect(pager.classList.contains("border-t")).toBe(false);
		expect(
			(
				screen.getByRole("button", {
					name: "Previous transaction page",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		fireEvent.click(
			screen.getByRole("button", { name: "Next transaction page" }),
		);
		expect(onPage).toHaveBeenCalledWith(1);
		rerender(
			<TablePagination
				page={2}
				pageCount={3}
				total={25}
				pageSize={10}
				onPage={onPage}
				topBorder
				className="px-0.5 py-2"
			/>,
		);
		const framed = screen.getByRole("status").parentElement!;
		expect(framed.classList.contains("border-t")).toBe(true);
		expect(framed.classList.contains("px-0.5")).toBe(true);
		expect(framed.classList.contains("py-4")).toBe(false);
		expect(screen.getByRole("status").textContent).toBe(
			"Showing 21–25 of 25 transactions",
		);
	});
});

describe("identity and detail ownership", () => {
	const account = {
		id: "cash",
		kind: "cash",
		color: null,
		name: "Checking",
	} as const;

	it("owns account identity layout inside either navigation or toggle buttons", () => {
		const ref = createRef<HTMLSpanElement>();
		const onClick = vi.fn();
		render(
			<button type="button" aria-pressed="true" onClick={onClick}>
				<AccountLabel
					ref={ref}
					account={account}
					suffix=" · excluded"
					className="gap-2"
				/>
				<span>Separate state</span>
			</button>,
		);
		expect(screen.getAllByRole("button")).toHaveLength(1);
		expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe(
			"true",
		);
		expect(ref.current?.classList.contains("flex")).toBe(true);
		expect(ref.current?.classList.contains("gap-3")).toBe(false);
		expect(ref.current?.classList.contains("gap-2")).toBe(true);
		const name = within(ref.current!).getByText("Checking");
		expect(name.parentElement?.classList.contains("flex-col")).toBe(true);
		expect(
			within(ref.current!)
				.getByText("cash · excluded")
				.classList.contains("text-xs"),
		).toBe(true);
		expect(within(ref.current!).queryByText("Separate state")).toBeNull();
		fireEvent.click(screen.getByRole("button"));
		expect(onClick).toHaveBeenCalledOnce();
	});

	it("gives account icons explicit size and native overrides", () => {
		const ref = createRef<HTMLSpanElement>();
		render(
			<AccountIcon
				ref={ref}
				account={{ ...account, color: "#123456" }}
				size="sm"
				className="size-10 rounded-full"
				style={{ opacity: 0.5 }}
			/>,
		);
		expect(ref.current?.classList.contains("size-8")).toBe(false);
		expect(ref.current?.classList.contains("rounded-control")).toBe(false);
		expect(ref.current?.style.getPropertyValue("--account-color")).toBe(
			"#123456",
		);
		expect(ref.current?.style.opacity).toBe("0.5");
	});

	it("styles description terms and values without a detail-list ancestor", () => {
		const ref = createRef<HTMLDListElement>();
		const { container } = render(
			<DetailList ref={ref} id="summary" className="my-0">
				<DetailRow label="Balance" className="text-left">
					$100
				</DetailRow>
			</DetailList>,
		);
		expect(ref.current?.id).toBe("summary");
		expect(ref.current?.classList.contains("my-5")).toBe(false);
		expect(
			container.querySelector("dt")?.classList.contains("text-muted"),
		).toBe(true);
		expect(container.querySelector("dd")?.classList.contains("flex")).toBe(
			true,
		);
		expect(
			container.querySelector("dd")?.classList.contains("text-right"),
		).toBe(false);
		expect(container.querySelector("dd")?.classList.contains("text-left")).toBe(
			true,
		);
		expect(
			container
				.querySelector("dt")
				?.parentElement?.classList.contains("border-b"),
		).toBe(true);
	});
});
