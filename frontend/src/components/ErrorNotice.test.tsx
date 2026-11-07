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

it("renders field errors only while a message exists", () => {
	const { rerender, container } = render(<FieldError id="token-error" />);
	expect(container.firstElementChild).toBeNull();
	expect(screen.queryByRole("alert")).toBeNull();
	rerender(<FieldError id="token-error" message="Paste the entire token." />);
	const description = document.getElementById("token-error")!;
	expect(screen.getByRole("alert")).toBe(description);
	expect(description.textContent).toContain("Paste the entire token.");
});
