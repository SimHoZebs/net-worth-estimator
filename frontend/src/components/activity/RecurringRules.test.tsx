import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { testPlan } from "../../test/plan.ts";
import { acceptTestResource } from "../../test/resource.ts";
import {
	resetWorkspaceStore,
	useWorkspaceStore,
} from "../../state/workspaceStore.ts";
import { RecurringRules } from "./RecurringRules.tsx";

vi.mock("./TransactionDetail.tsx", () => ({
	MovementDetail: ({ movement }: { movement: { name: string } }) => (
		<p data-testid="selected-rule">{movement.name}</p>
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
	resetWorkspaceStore();
});

it("keeps an existing selected rule current across plan updates and closes it on removal", () => {
	acceptTestResource();
	resetWorkspaceStore();
	const account = testPlan.accounts[0]!;
	const movement = {
		...testPlan.movements[0]!,
		id: "selected",
		name: "Original rule",
		frequency: "monthly" as const,
		fromId: account.id,
		toId: null,
	};
	const plan = { ...testPlan, movements: [movement] };
	const view = render(
		<RecurringRules account={account} plan={plan} onEdit={() => {}} />,
	);
	fireEvent.click(screen.getByRole("button", { name: /^View Original rule/ }));
	view.rerender(
		<RecurringRules
			account={account}
			plan={{ ...plan, name: "Unrelated rename" }}
			onEdit={() => {}}
		/>,
	);
	expect(screen.getByTestId("selected-rule").textContent).toBe("Original rule");
	view.rerender(
		<RecurringRules
			account={account}
			plan={{ ...plan, movements: [{ ...movement, name: "Current rule" }] }}
			onEdit={() => {}}
		/>,
	);
	expect(screen.getByTestId("selected-rule").textContent).toBe("Current rule");
	view.rerender(
		<RecurringRules
			account={account}
			plan={{ ...plan, movements: [] }}
			onEdit={() => {}}
		/>,
	);
	expect(screen.queryByTestId("selected-rule")).toBeNull();
});

it("returns a rejected drag preview to the workspace order", () => {
	acceptTestResource();
	resetWorkspaceStore();
	const account = testPlan.accounts[0]!;
	const movements = ["first", "second"].map((id) => ({
		...testPlan.movements[0]!,
		id,
		name: id,
		frequency: "monthly" as const,
		fromId: account.id,
		toId: null,
	}));
	const update = vi.fn(() => false);
	useWorkspaceStore.setState({ updatePlan: update });
	render(
		<RecurringRules
			account={account}
			plan={{ ...testPlan, movements }}
			onEdit={() => {}}
		/>,
	);
	fireEvent.click(
		screen.getByRole("button", { name: "Reorder recurring transactions" }),
	);
	const ids = () =>
		screen.getAllByTestId("drag-row").map((row) => row.dataset.id);
	fireEvent.pointerDown(screen.getAllByTestId("drag-row")[0]!);
	act(() => motion.reorder(["second", "first"]));
	expect(ids()).toEqual(["second", "first"]);
	fireEvent.pointerUp(screen.getAllByTestId("drag-row")[0]!);
	expect(update).toHaveBeenCalledOnce();
	expect(ids()).toEqual(["first", "second"]);
});
