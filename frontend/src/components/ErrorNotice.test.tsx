import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ErrorNotice, FieldError } from "./ErrorNotice.tsx";
import { runInteractions } from "../mocks/interactions.ts";

it("keeps retry actions beside the failure message", async () => {
	const retry = vi.fn();
	const { rerender } = render(<ErrorNotice message={null} />);
	expect(screen.queryByRole("alert")).toBeNull();
	rerender(
		<ErrorNotice message="Save failed" action="Retry save" onAction={retry} />,
	);
	expect(screen.getByRole("alert").textContent).toContain("Save failed");
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
