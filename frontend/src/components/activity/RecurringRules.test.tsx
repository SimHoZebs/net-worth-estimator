import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import { acceptTestResource } from "../../mocks/resource.ts";
import { stubTestServer } from "../../mocks/waypointServer.ts";
import { resetServerQueryCache } from "../../state/serverQuery.ts";
import { RecurringRules } from "./RecurringRules.tsx";

vi.mock("./TransactionDetail.tsx", () => ({
	TransactionDetail: ({ transaction }: { transaction: { name: string } }) => (
		<p data-testid="selected-rule">{transaction.name}</p>
	),
}));

const motion = vi.hoisted(() => ({ reorder: (_ids: string[]) => {} }));
vi.mock("motion/react", async (importOriginal) => ({
	...(await importOriginal<typeof import("motion/react")>()),
	useDragControls: () => ({ start: vi.fn() }),
	Reorder: {
		Group: ({
			children,
			onReorder,
		}: {
			children: ReactNode;
			onReorder: (ids: string[]) => void;
		}) => {
			motion.reorder = onReorder;
			return <ul>{children}</ul>;
		},
		Item: ({
			children,
			value,
			onDragStart,
			onDragEnd,
		}: {
			children: ReactNode;
			value: string;
			onDragStart: () => void;
			onDragEnd: () => void;
		}) => (
			<li
				data-testid="drag-row"
				data-id={value}
				onPointerDown={onDragStart}
				onPointerUp={onDragEnd}
			>
				{children}
			</li>
		),
	},
}));

afterEach(() => {
	cleanup();
	resetServerQueryCache();
	vi.unstubAllGlobals();
});

function rulesProps(transactions: typeof financialModelFixture.transactions) {
	const account = financialModelFixture.accounts[0]!;
	return {
		account,
		accounts: financialModelFixture.accounts,
		transactions,
		startDate: financialModelFixture.startDate,
		readOnly: false as const,
		onEdit: () => {},
	};
}

it("keeps an existing selected rule current across row updates and closes it on removal", () => {
	acceptTestResource();
	resetServerQueryCache();
	const account = financialModelFixture.accounts[0]!;
	const transaction = {
		...financialModelFixture.transactions[0]!,
		id: "selected",
		name: "Original rule",
		frequency: "monthly" as const,
		fromId: account.id,
		toId: null,
	};
	const view = render(<RecurringRules {...rulesProps([transaction])} />);
	fireEvent.click(screen.getByRole("button", { name: /^View Original rule/ }));
	view.rerender(
		<RecurringRules
			{...rulesProps([{ ...transaction, name: "Current rule" }])}
		/>,
	);
	expect(screen.getByTestId("selected-rule").textContent).toBe("Current rule");
	view.rerender(<RecurringRules {...rulesProps([])} />);
	expect(screen.queryByTestId("selected-rule")).toBeNull();
});

it("returns a rejected drag preview to the server order", async () => {
	acceptTestResource();
	resetServerQueryCache();
	const server = stubTestServer();
	const account = financialModelFixture.accounts[0]!;
	const transactions = ["first", "second"].map((id) => ({
		...financialModelFixture.transactions[0]!,
		id,
		name: id,
		frequency: "monthly" as const,
		fromId: account.id,
		toId: null,
	}));
	render(<RecurringRules {...rulesProps(transactions)} />);
	fireEvent.click(
		screen.getByRole("button", { name: "Reorder recurring transactions" }),
	);
	const ids = () =>
		screen.getAllByTestId("drag-row").map((row) => row.dataset.id);
	server.writeOnce(
		(method, path) =>
			method === "POST" && path === "/v1/recurrence-rules/reorder",
		new Error("The order could not be saved."),
	);
	fireEvent.pointerDown(screen.getAllByTestId("drag-row")[0]!);
	act(() => motion.reorder(["second", "first"]));
	expect(ids()).toEqual(["second", "first"]);
	fireEvent.pointerUp(screen.getAllByTestId("drag-row")[0]!);
	await waitFor(() => expect(ids()).toEqual(["first", "second"]));
	expect(
		server.calls.some(
			(call) =>
				call.method === "POST" && call.url === "/v1/recurrence-rules/reorder",
		),
	).toBe(true);
});
