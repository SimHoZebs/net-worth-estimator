import { cleanup, fireEvent, render } from "@testing-library/react";
import { Save } from "lucide-react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, IconButton, TextButton } from "./Button.tsx";
import {
	buttonStyles,
	iconButtonStyles,
	textButtonStyles,
} from "./buttonStyles.ts";

afterEach(cleanup);

describe("native action primitives", () => {
	it("defaults to a non-submit action and forwards native props and ref", () => {
		const ref = createRef<HTMLButtonElement>();
		const click = vi.fn();
		const view = render(
			<Button ref={ref} name="action" value="save" onClick={click}>
				Save
			</Button>,
		);
		const button = view.getByRole("button") as HTMLButtonElement;
		expect(button.type).toBe("button");
		expect(button.name).toBe("action");
		expect(button.value).toBe("save");
		expect(ref.current).toBe(button);
		fireEvent.click(button);
		expect(click).toHaveBeenCalledOnce();
	});

	it.each([Button, TextButton])(
		"supports external native form submission",
		(Action) => {
			const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
			const view = render(
				<>
					<form id="editor" onSubmit={submit} />
					<Action form="editor" type="submit">
						Apply
					</Action>
				</>,
			);
			fireEvent.click(view.getByRole("button"));
			expect(submit).toHaveBeenCalledOnce();
		},
	);

	it("keeps external form submission, labels, ref, and disabled behavior for icon actions", () => {
		const ref = createRef<HTMLButtonElement>();
		const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
		const view = render(
			<>
				<form id="editor" onSubmit={submit} />
				<IconButton
					ref={ref}
					icon={Save}
					iconSize={16}
					label="Apply changes"
					type="submit"
					form="editor"
				/>
			</>,
		);
		const button = view.getByRole("button", { name: "Apply changes" });
		expect(ref.current).toBe(button);
		expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
			"true",
		);
		expect(button.querySelector("svg")?.getAttribute("width")).toBe("16");
		fireEvent.click(button);
		expect(submit).toHaveBeenCalledOnce();
		view.rerender(
			<>
				<form id="editor" onSubmit={submit} />
				<IconButton
					icon={Save}
					label="Apply changes"
					type="submit"
					form="editor"
					disabled
				/>
			</>,
		);
		fireEvent.click(view.getByRole("button"));
		expect(submit).toHaveBeenCalledOnce();
	});

	it("resolves caller overrides without private class hooks", () => {
		const view = render(
			<Button
				variant="primary"
				size="sm"
				className="bg-surface px-6 rounded-none"
			>
				Save
			</Button>,
		);
		const classes = view.getByRole("button").classList;
		expect(classes.contains("bg-primary")).toBe(false);
		expect(classes.contains("px-3")).toBe(false);
		expect(classes.contains("rounded-control")).toBe(false);
		expect(classes.contains("px-6")).toBe(true);
	});

	it("exports style recipes independently of React rendering", () => {
		expect(buttonStyles({ variant: "danger", size: "sm" })).toContain(
			"bg-danger-solid",
		);
		expect(textButtonStyles({ tone: "danger" })).toContain("text-danger-text");
		expect(iconButtonStyles({ size: "sm" })).toContain("size-7");
	});
});
