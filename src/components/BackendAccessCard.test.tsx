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

		fireEvent.change(screen.getByLabelText("Access token"), {
			target: { value: "secret-token" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Set token" }));

		expect(getAuthToken()).toBe("secret-token");
		expect(screen.queryByText("secret-token")).toBeNull();
		expect(screen.getByText("Token set")).not.toBeNull();
	});

	it("clears the token", () => {
		render(<BackendAccessCard />);

		fireEvent.change(screen.getByLabelText("Access token"), {
			target: { value: "secret-token" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Set token" }));
		fireEvent.click(screen.getByRole("button", { name: "Clear token" }));

		expect(getAuthToken()).toBeNull();
		expect(screen.getByText("No token (read-only)")).not.toBeNull();
	});
});
