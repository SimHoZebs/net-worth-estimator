// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account, PlannedPurchase } from "../../domain/model.ts";
import { plannedPurchaseSchema } from "../../domain/model.ts";
import {
	saveNewPurchase,
	savePurchaseEdit,
} from "../../state/purchaseWrites.ts";
import { WishListEditor } from "./WishListEditor.tsx";

const modalProbe = vi.hoisted(() => ({
	current: null as null | {
		onClose?: () => void;
		onCloseRequest?: () => boolean;
	},
}));

vi.mock("../../components/Modal.tsx", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../components/Modal.tsx")>()),
	Modal: ({
		children,
		...props
	}: {
		children: ReactNode;
		onClose?: () => void;
		onCloseRequest?: () => boolean;
	}) => {
		modalProbe.current = props;
		return <section>{children}</section>;
	},
}));

vi.mock("../../state/purchaseWrites.ts", () => ({
	saveNewPurchase: vi.fn(),
	savePurchaseEdit: vi.fn(),
}));

const mockedSaveNew = vi.mocked(saveNewPurchase);
const mockedSaveEdit = vi.mocked(savePurchaseEdit);

const accounts: Account[] = [
	{
		id: "checking",
		name: "Everyday checking",
		kind: "cash",
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
	{
		id: "savings",
		name: "Emergency fund",
		kind: "cash",
		enabled: true,
		archived: false,
		balance: 42000,
		minBalance: 0,
		maxBalance: null,
		color: null,
		observedOn: "2026-09-24",
		balanceCheck: true,
		source: "Manual entry",
		readOnly: false,
	},
];

const existing: PlannedPurchase = {
	id: "desk",
	name: "Desk",
	amount: 400,
	fromId: "checking",
	startDate: "2026-09-24",
	enabled: true,
	readOnly: false,
};

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function fillCreateForm() {
	fireEvent.change(screen.getByLabelText("Purchase name"), {
		target: { value: "Desk" },
	});
	fireEvent.change(screen.getByLabelText("Cost (USD)"), {
		target: { value: "400" },
	});
	fireEvent.change(screen.getByLabelText("Funding account"), {
		target: { value: "checking" },
	});
}

function submitForm() {
	fireEvent.submit(
		screen.getByRole("button", { name: "Add purchase" }).closest("form")!,
	);
}

describe("WishListEditor", () => {
	it("saves a new hypothetical wish and closes only after persistence", async () => {
		mockedSaveNew.mockResolvedValue(true);
		const onSaved = vi.fn();
		const onClose = vi.fn();
		render(
			<WishListEditor
				accounts={accounts}
				startDate="2026-09-24"
				item={null}
				priority={0}
				onSaved={onSaved}
				onClose={onClose}
			/>,
		);
		fillCreateForm();
		submitForm();
		await waitFor(() => expect(mockedSaveNew).toHaveBeenCalledOnce());
		const [saved, priority] = mockedSaveNew.mock.calls[0]!;
		expect(priority).toBe(0);
		// A wishlist row is hypothetical: it validates as a planned purchase
		// and never carries scheduled-transaction fields.
		expect(plannedPurchaseSchema.safeParse(saved).success).toBe(true);
		expect(saved).not.toHaveProperty("frequency");
		expect(saved).not.toHaveProperty("toId");
		expect(saved).toMatchObject({
			name: "Desk",
			amount: 400,
			fromId: "checking",
			startDate: "2026-09-24",
			enabled: true,
		});
		expect(screen.getByText(/never buys anything/i)).toBeTruthy();
		await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
		expect(onClose).not.toHaveBeenCalled();
	});

	it("keeps the form open with its values when the save fails", async () => {
		mockedSaveNew.mockResolvedValue(false);
		const onSaved = vi.fn();
		render(
			<WishListEditor
				accounts={accounts}
				startDate="2026-09-24"
				item={null}
				priority={0}
				onSaved={onSaved}
				onClose={() => {}}
			/>,
		);
		fillCreateForm();
		submitForm();
		await waitFor(() => expect(mockedSaveNew).toHaveBeenCalledOnce());
		expect(onSaved).not.toHaveBeenCalled();
		expect(screen.getByRole("alert")).toBeTruthy();
		expect(
			(screen.getByLabelText("Purchase name") as HTMLInputElement).value,
		).toBe("Desk");
	});

	it("edits the selected row in place without moving it", async () => {
		mockedSaveEdit.mockResolvedValue(true);
		const onSaved = vi.fn();
		render(
			<WishListEditor
				accounts={accounts}
				startDate="2026-09-24"
				item={existing}
				priority={2}
				onSaved={onSaved}
				onClose={() => {}}
			/>,
		);
		expect(
			(screen.getByLabelText("Purchase name") as HTMLInputElement).value,
		).toBe("Desk");
		expect(
			(screen.getByLabelText("Cost (USD)") as HTMLInputElement).value,
		).toBe("400");
		fireEvent.change(screen.getByLabelText("Cost (USD)"), {
			target: { value: "450.25" },
		});
		fireEvent.submit(
			screen.getByRole("button", { name: "Save purchase" }).closest("form")!,
		);
		await waitFor(() => expect(mockedSaveEdit).toHaveBeenCalledOnce());
		expect(mockedSaveEdit.mock.calls[0]).toEqual([
			expect.objectContaining({ id: "desk", amount: 450.25 }),
			2,
		]);
		await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
	});

	it("validates locally without calling the server", async () => {
		const onSaved = vi.fn();
		render(
			<WishListEditor
				accounts={accounts}
				startDate="2026-09-24"
				item={null}
				priority={0}
				onSaved={onSaved}
				onClose={() => {}}
			/>,
		);
		fireEvent.change(screen.getByLabelText("Cost (USD)"), {
			target: { value: "0" },
		});
		fireEvent.change(screen.getByLabelText("Funding account"), {
			target: { value: "checking" },
		});
		submitForm();
		await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
		expect(mockedSaveNew).not.toHaveBeenCalled();
		expect(onSaved).not.toHaveBeenCalled();
	});

	it("retains the read-only fieldset and blocked submit action", () => {
		render(
			<WishListEditor
				accounts={accounts}
				startDate="2026-09-24"
				item={{ ...existing, readOnly: true }}
				priority={0}
				onSaved={() => {}}
				onClose={() => {}}
			/>,
		);
		const field = screen.getByRole("checkbox", {
			name: "Include in purchase queue",
		});
		expect(field.closest("fieldset")?.disabled).toBe(true);
		expect(
			(
				screen.getByRole("button", {
					name: "Save purchase",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		fireEvent.submit(field.closest("form")!);
		expect(mockedSaveEdit).not.toHaveBeenCalled();
	});

	it("asks to discard dirty changes and keeps the form on continue", () => {
		const onClose = vi.fn();
		render(
			<WishListEditor
				accounts={accounts}
				startDate="2026-09-24"
				item={null}
				priority={0}
				onSaved={() => {}}
				onClose={onClose}
			/>,
		);
		fireEvent.change(screen.getByLabelText("Purchase name"), {
			target: { value: "Unsaved desk" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onClose).not.toHaveBeenCalled();
		expect(screen.getByRole("alert").textContent).toContain(
			"Discard the changes in this form?",
		);
		fireEvent.click(screen.getByRole("button", { name: "Continue" }));
		expect(
			(screen.getByLabelText("Purchase name") as HTMLInputElement).value,
		).toBe("Unsaved desk");
		expect(onClose).not.toHaveBeenCalled();
		// Reopen the confirm step, then discard through it.
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("routes dialog close requests through the dirty guard", () => {
		const onClose = vi.fn();
		render(
			<WishListEditor
				accounts={accounts}
				startDate="2026-09-24"
				item={null}
				priority={0}
				onSaved={() => {}}
				onClose={onClose}
			/>,
		);
		// A clean form lets the dialog close (Close button, Escape, backdrop).
		expect(modalProbe.current?.onCloseRequest?.()).toBe(true);
		fireEvent.change(screen.getByLabelText("Purchase name"), {
			target: { value: "Unsaved desk" },
		});
		// A dirty form blocks the dialog close and shows the inline confirm.
		let blocked: boolean | undefined;
		act(() => {
			blocked = modalProbe.current?.onCloseRequest?.();
		});
		expect(blocked).toBe(false);
		expect(screen.getByRole("alert").textContent).toContain(
			"Discard the changes in this form?",
		);
		expect(onClose).not.toHaveBeenCalled();
	});
});
