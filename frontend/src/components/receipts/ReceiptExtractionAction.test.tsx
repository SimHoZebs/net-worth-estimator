import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReceiptExtractionAction } from "./ReceiptExtractionAction.tsx";

afterEach(cleanup);

it("shows an accessible busy state and blocks duplicate extraction", () => {
	const onExtract = vi.fn();
	const props = {
		available: true,
		pending: false,
		complete: false,
		disabled: false,
		onExtract,
	};
	const { rerender } = render(<ReceiptExtractionAction {...props} />);
	const idle = screen.getByRole("button", { name: "Extract details" });
	fireEvent.click(idle);
	expect(onExtract).toHaveBeenCalledTimes(1);
	expect(idle.getAttribute("aria-busy")).toBe("false");
	rerender(<ReceiptExtractionAction {...props} pending />);
	const pending = screen.getByRole("button", { name: "Extracting details…" });
	expect(pending.getAttribute("aria-busy")).toBe("true");
	expect((pending as HTMLButtonElement).disabled).toBe(true);
	expect(pending.querySelector("progress")?.hasAttribute("value")).toBe(false);
	expect(screen.getByRole("status").textContent).toContain(
		"Scanning the receipt",
	);
	fireEvent.click(pending);
	expect(onExtract).toHaveBeenCalledTimes(1);
	rerender(<ReceiptExtractionAction {...props} complete />);
	expect(screen.getByRole("status").textContent).toContain(
		"Receipt details extracted",
	);
	expect(screen.getByRole("button").getAttribute("aria-busy")).toBe("false");
});

it("keeps extraction unavailable while another edit or disabled source blocks it", () => {
	const props = {
		available: false,
		pending: false,
		complete: false,
		disabled: false,
		onExtract: vi.fn(),
	};
	const { rerender } = render(<ReceiptExtractionAction {...props} />);
	expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
	expect(screen.getByRole("status").textContent).toContain("not configured");
	rerender(<ReceiptExtractionAction {...props} available disabled />);
	expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
});
