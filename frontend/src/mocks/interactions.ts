import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect } from "vitest";

type Role = Parameters<typeof screen.getByRole>[0];
type Name = string | RegExp;

/**
 * One user step. Keys are the action; values are its arguments. Scenarios
 * stay readable as data and reuse the same vocabulary across components.
 * `cancel` models the browser turning Escape into a dialog cancel event;
 * jsdom does not synthesize that event from a key press.
 */
export type Interaction =
	| { click: readonly [role: Role, name: Name] }
	| { cancel: true }
	| { backdrop: true }
	| { type: readonly [label: string, text: string] }
	| { select: readonly [label: string, value: string] }
	| { check: string }
	| { uncheck: string }
	| { press: string }
	| { waitForText: string }
	| { waitForTextGone: string }
	| { expectText: string }
	| { expectNoText: string }
	| { expectPresent: readonly [role: Role, name: Name] }
	| { expectAbsent: readonly [role: Role, name: Name] }
	| { expectEnabled: readonly [role: Role, name: Name] }
	| { expectDisabled: readonly [role: Role, name: Name] }
	| { expectValue: readonly [label: string, value: string] }
	| { expectFocus: readonly [role: Role, name: Name] };

export type InteractionScope = () => HTMLElement;

function activeDialog(scope: InteractionScope): HTMLDialogElement {
	const root = scope();
	if (root instanceof HTMLDialogElement) return root;
	const dialog = root.querySelector("dialog");
	if (!(dialog instanceof HTMLDialogElement))
		throw new Error("No dialog in scope");
	return dialog;
}

function describeStep(step: Interaction): string {
	return Object.keys(step)[0] ?? "interaction";
}

/**
 * Run a scenario through real user events. The scope is resolved lazily, so
 * a scenario can render after the harness is created and can point at a
 * dialog that opens partway through. Failures name the step index.
 */
export async function runInteractions(
	steps: readonly Interaction[],
	scope: InteractionScope = () => document.body,
): Promise<void> {
	const user = userEvent.setup();
	const query = () => within(scope());
	for (const [index, step] of steps.entries()) {
		try {
			if ("click" in step) {
				await user.click(
					query().getByRole(step.click[0], { name: step.click[1] }),
				);
			} else if ("cancel" in step) {
				fireEvent(
					activeDialog(scope),
					new Event("cancel", { bubbles: true, cancelable: true }),
				);
			} else if ("backdrop" in step) {
				// The backdrop is the dialog element itself; user-event has no
				// pointer target outside the rendered content.
				fireEvent.click(activeDialog(scope));
			} else if ("type" in step) {
				const field = query().getByLabelText(step.type[0]);
				await user.clear(field);
				await user.type(field, step.type[1]);
			} else if ("select" in step) {
				await user.selectOptions(
					query().getByLabelText(step.select[0]),
					step.select[1],
				);
			} else if ("check" in step) {
				const control = query().getByLabelText(step.check) as HTMLInputElement;
				if (!control.checked) await user.click(control);
			} else if ("uncheck" in step) {
				const control = query().getByLabelText(
					step.uncheck,
				) as HTMLInputElement;
				if (control.checked) await user.click(control);
			} else if ("press" in step) {
				await user.keyboard(step.press);
			} else if ("waitForText" in step) {
				await query().findByText(step.waitForText);
			} else if ("waitForTextGone" in step) {
				await waitFor(() =>
					expect(query().queryByText(step.waitForTextGone)).toBeNull(),
				);
			} else if ("expectText" in step) {
				expect(query().getByText(step.expectText)).toBeTruthy();
			} else if ("expectNoText" in step) {
				expect(query().queryByText(step.expectNoText)).toBeNull();
			} else if ("expectPresent" in step) {
				expect(
					query().getByRole(step.expectPresent[0], {
						name: step.expectPresent[1],
					}),
				).toBeTruthy();
			} else if ("expectAbsent" in step) {
				expect(
					query().queryByRole(step.expectAbsent[0], {
						name: step.expectAbsent[1],
					}),
				).toBeNull();
			} else if ("expectEnabled" in step) {
				const control = query().getByRole(step.expectEnabled[0], {
					name: step.expectEnabled[1],
				}) as HTMLButtonElement;
				expect(control.disabled).toBe(false);
			} else if ("expectDisabled" in step) {
				const control = query().getByRole(step.expectDisabled[0], {
					name: step.expectDisabled[1],
				}) as HTMLButtonElement;
				expect(control.disabled).toBe(true);
			} else if ("expectValue" in step) {
				const control = query().getByLabelText(
					step.expectValue[0],
				) as HTMLInputElement;
				expect(control.value).toBe(step.expectValue[1]);
			} else if ("expectFocus" in step) {
				const target = query().getByRole(step.expectFocus[0], {
					name: step.expectFocus[1],
				});
				await waitFor(() => expect(document.activeElement).toBe(target));
			}
		} catch (cause) {
			throw new Error(
				`Interaction ${index + 1} (${describeStep(step)}) failed: ${
					cause instanceof Error ? cause.message : String(cause)
				}`,
				{ cause },
			);
		}
	}
}

/** Scope for one dialog by accessible name, resolved on every step. */
export function dialogScope(name: Name): InteractionScope {
	return () => screen.getByRole("dialog", { name });
}
