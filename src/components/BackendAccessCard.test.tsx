// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { clearAuthToken, getAuthToken } from "@/lib/auth-token";
import { BackendAccessCard } from "./BackendAccessCard";

afterEach(() => {
	cleanup();
	clearAuthToken();
});

describe("BackendAccessCard", () => {
	it("stores the token without displaying it", () => {
		render(<BackendAccessCard />);

		fireEvent.change(screen.getByLabelText("Token"), {
			target: { value: "secret-token" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Set" }));

		expect(getAuthToken()).toBe("secret-token");
		expect(screen.queryByText("secret-token")).toBeNull();
		expect(screen.getByText("Token set")).not.toBeNull();
	});

	it("clears the token", () => {
		render(<BackendAccessCard />);

		fireEvent.change(screen.getByLabelText("Token"), {
			target: { value: "secret-token" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Set" }));
		fireEvent.click(screen.getByRole("button", { name: "Clear" }));

		expect(getAuthToken()).toBeNull();
		expect(screen.getByText("No token")).not.toBeNull();
	});
});
