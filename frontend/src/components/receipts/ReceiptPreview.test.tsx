import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReceiptPreview } from "./ReceiptPreview.tsx";
import { runInteractions } from "../../mocks/interactions.ts";

const image = vi.hoisted(() => ({
	data: undefined as Blob | undefined,
	error: null as Error | null,
	isError: false,
	refetch: vi.fn(),
}));
vi.mock("@/state/receipts.ts", () => ({ useReceiptImage: () => image }));

const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();

beforeEach(() => {
	image.data = undefined;
	image.error = null;
	image.isError = false;
	createObjectURL.mockReset();
	revokeObjectURL.mockReset();
	createObjectURL.mockImplementation(
		() => `blob:receipt-${createObjectURL.mock.calls.length}`,
	);
	vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
});

it("contains long image errors without a reserved box and retains retry", async () => {
	image.error = new Error("A long receipt failure. ".repeat(100));
	image.isError = true;
	render(<ReceiptPreview id="receipt" digest="one" filename="shop.png" />);
	const alert = screen.getByRole("alert");
	expect(alert.textContent).toContain(image.error.message);
	expect(alert.parentElement?.classList.contains("h-24")).toBe(false);
	expect(alert.parentElement?.classList.contains("overflow-auto")).toBe(false);
	await runInteractions([{ click: ["button", "Retry image"] }]);
	expect(image.refetch).toHaveBeenCalledOnce();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("renders the current browser URL and revokes each image on replacement and unmount", () => {
	const view = render(
		<ReceiptPreview id="receipt" digest="one" filename="shop.png" />,
	);
	expect(screen.queryByRole("img")).toBeNull();
	const first = new Blob(["first"], { type: "image/png" });
	image.data = first;
	view.rerender(
		<ReceiptPreview id="receipt" digest="one" filename="shop.png" />,
	);
	expect(createObjectURL).toHaveBeenCalledWith(first);
	expect(screen.getByRole("img").getAttribute("src")).toBe("blob:receipt-1");
	image.data = new Blob(["second"], { type: "image/png" });
	view.rerender(
		<ReceiptPreview id="receipt" digest="two" filename="shop.png" />,
	);
	expect(revokeObjectURL).toHaveBeenCalledWith("blob:receipt-1");
	expect(screen.getByRole("img").getAttribute("src")).toBe("blob:receipt-2");
	view.unmount();
	expect(revokeObjectURL).toHaveBeenCalledWith("blob:receipt-2");
});

it("downloads the same current URL that the image renders", () => {
	image.data = new Blob(["image"], { type: "image/png" });
	let downloaded: { href: string | null; filename: string } | undefined;
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
		this: HTMLAnchorElement,
	) {
		downloaded = { href: this.getAttribute("href"), filename: this.download };
	});
	render(<ReceiptPreview id="receipt" digest="one" filename="shop.png" />);
	fireEvent.click(screen.getByRole("button", { name: "Download image" }));
	expect(downloaded?.href).toBe(screen.getByRole("img").getAttribute("src"));
	expect(downloaded?.filename).toBe("shop.png");
});
