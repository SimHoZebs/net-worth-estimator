import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ErrorNotice, FieldError } from "./ErrorNotice.tsx";
import { runInteractions } from "../mocks/interactions.ts";

it("keeps the reserved container through failure and recovery", () => {
	const { container, rerender } = render(
		<ErrorNotice reserve message={null} />,
	);
	const slot = container.firstElementChild;
	expect(slot?.classList.contains("h-24")).toBe(true);
	expect(slot?.classList.contains("overflow-auto")).toBe(true);
	expect(screen.queryByRole("alert")).toBeNull();
	expect(slot?.hasAttribute("tabindex")).toBe(false);
	rerender(<ErrorNotice reserve message="Save failed" />);
	expect(container.firstElementChild).toBe(slot);
	expect(screen.getByRole("alert").textContent).toContain("Save failed");
	expect(slot?.getAttribute("tabindex")).toBe("0");
	rerender(<ErrorNotice reserve message={null} />);
	expect(container.firstElementChild).toBe(slot);
	expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps retry actions inside reserved feedback", async () => {
	const retry = vi.fn();
	render(
		<ErrorNotice
			reserve
			message="Save failed"
			action="Retry save"
			onAction={retry}
		/>,
	);
	await runInteractions([{ click: ["button", "Retry save"] }]);
	expect(retry).toHaveBeenCalledOnce();
});

it("keeps a stable field description target without premature error text", () => {
	const { rerender } = render(<FieldError id="token-error" />);
	const description = document.getElementById("token-error")!;
	expect(description.textContent).toBe("");
	expect(description.classList.contains("h-[3lh]")).toBe(true);
	expect(description.classList.contains("overflow-auto")).toBe(true);
	rerender(<FieldError id="token-error" message="Paste the entire token." />);
	expect(screen.getByRole("alert")).toBe(description);
	expect(description.textContent).toContain("Paste the entire token.");
});
