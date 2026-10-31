// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	moveSavedPurchase,
	removeSavedPurchase,
	saveNewPurchase,
} from "../../state/purchaseWrites.ts";
import { PlannedPurchasePanel } from "./PlannedPurchasePanel.tsx";

vi.mock("../../components/Modal.tsx", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../components/Modal.tsx")>()),
	Modal: ({ children }: { children: ReactNode }) => (
		<section>{children}</section>
	),
}));

vi.mock("../../state/purchaseWrites.ts", () => ({
	moveSavedPurchase: vi.fn(),
	removeSavedPurchase: vi.fn(),
	saveNewPurchase: vi.fn(),
	savePurchaseEdit: vi.fn(),
}));

vi.mock("../../state/useUserScope.ts", () => ({
	useUserReadOnly: () => false,
}));

const { mockAccounts, mockPurchases } = vi.hoisted(() => {
	const mockAccounts = [
		{
			id: "checking",
			name: "Everyday checking",
			kind: "cash" as const,
			enabled: true,
			archived: false,
			balance: 18250,
			minBalance: 2500,
			maxBalance: null,
			color: null,
			observedOn: "2026-09-24",
			balanceCheck: true,
			source: "Manual entry",
			readOnly: false,
		},
	];
	const mockPurchases = [
		{
			id: "laptop",
			name: "laptop",
			amount: 500,
			fromId: "checking",
			startDate: "2026-09-24",
			enabled: true,
			readOnly: false,
		},
		{
			id: "chair",
			name: "chair",
			amount: 500,
			fromId: "checking",
			startDate: "2026-09-24",
			enabled: true,
			readOnly: false,
		},
	];
	return { mockAccounts, mockPurchases };
});

vi.mock("../../state/savedRows.ts", () => ({
	useSavedAccounts: () => mockAccounts,
	useSavedPurchases: () => mockPurchases,
	useSavedStartDate: () => "2026-09-24",
}));

vi.mock("../../state/useRemoteProjection.ts", () => ({
	useRemoteProjection: () => ({
		base: null,
		loading: false,
		baseError: null,
	}),
}));

const mockedMove = vi.mocked(moveSavedPurchase);
const mockedRemove = vi.mocked(removeSavedPurchase);
const mockedSaveNew = vi.mocked(saveNewPurchase);

function purchase(id: string) {
	return {
		id,
		name: id,
		amount: 500,
		fromId: "checking",
		startDate: "2026-09-24",
		enabled: true,
		readOnly: false,
	};
}

function renderPanel() {
	return render(<PlannedPurchasePanel />);
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("PlannedPurchasePanel", () => {
	it("moves a row and announces the persisted priority", async () => {
		mockedMove.mockResolvedValue({
			ok: true,
			next: [purchase("chair"), purchase("laptop")],
		});
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "Move chair up" }));
		await waitFor(() => expect(mockedMove).toHaveBeenCalledOnce());
		expect(mockedMove.mock.calls[0]?.slice(1)).toEqual(["chair", -1]);
		expect(screen.getByRole("status").textContent).toContain(
			"chair is now priority 1",
		);
	});

	it("keeps a move failure visible instead of announcing", async () => {
		mockedMove.mockResolvedValue({ ok: false, next: null });
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "Move chair up" }));
		await waitFor(() => expect(mockedMove).toHaveBeenCalledOnce());
		expect(screen.getByRole("alert").textContent).toMatch(
			/could not be moved/i,
		);
		expect(screen.getByRole("status").textContent).toBe("");
	});

	it("removes a row through the inspector and closes on persistence", async () => {
		mockedRemove.mockResolvedValue(true);
		renderPanel();
		fireEvent.click(
			screen.getByRole("button", { name: "Inspect chair, priority 2" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Remove" }));
		fireEvent.click(screen.getByRole("button", { name: "Remove and save" }));
		await waitFor(() => expect(mockedRemove).toHaveBeenCalledWith("chair"));
		await waitFor(() =>
			expect(
				screen.queryByRole("button", { name: "Remove and save" }),
			).toBeNull(),
		);
	});

	it("keeps the remove dialog open with an error after a failure", async () => {
		mockedRemove.mockResolvedValue(false);
		renderPanel();
		fireEvent.click(
			screen.getByRole("button", { name: "Inspect laptop, priority 1" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Remove" }));
		fireEvent.click(screen.getByRole("button", { name: "Remove and save" }));
		await waitFor(() => expect(mockedRemove).toHaveBeenCalledWith("laptop"));
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toMatch(
				/could not be removed/i,
			),
		);
		// The failure stays visible: the dialog does not close.
		expect(
			screen.getByRole("button", { name: "Remove and save" }),
		).toBeTruthy();
	});

	it("adds a row and closes the editor after persistence", async () => {
		mockedSaveNew.mockResolvedValue(true);
		renderPanel();
		fireEvent.click(screen.getByRole("button", { name: "Add purchase" }));
		const dialog = screen
			.getByText("Include in purchase queue")
			.closest("form")!;
		fireEvent.change(
			within(dialog as HTMLElement).getByLabelText("Purchase name"),
			{
				target: { value: "Desk" },
			},
		);
		fireEvent.change(
			within(dialog as HTMLElement).getByLabelText("Cost (USD)"),
			{
				target: { value: "400" },
			},
		);
		fireEvent.change(
			within(dialog as HTMLElement).getByLabelText("Funding account"),
			{
				target: { value: "checking" },
			},
		);
		fireEvent.submit(dialog);
		await waitFor(() => expect(mockedSaveNew).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(screen.queryByLabelText("Purchase name")).toBeNull(),
		);
	});
});
