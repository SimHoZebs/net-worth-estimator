import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import { EditorSelect } from "./editorFields.tsx";
import { transactionBody } from "./transactionBodies.ts";

it(
	"keeps an imported __none account distinct from the external choice and in the payload",
	{ timeout: 30000 },
	async () => {
		const user = userEvent.setup();
		function AccountSelection() {
			const [fromId, setFromId] = useState("");
			const body = transactionBody({
				name: "Transfer",
				amount: 10,
				fromId: fromId || null,
				toId: "checking",
				startDate: "2026-11-14",
				postedDate: null,
				enabled: true,
				claimScheduleId: null,
				claimOccurrenceDate: null,
			});
			return (
				<>
					<EditorSelect
						value={fromId}
						onValueChange={setFromId}
						emptyLabel="External"
						options={[{ value: "__none", label: "Imported account" }]}
					/>
					<output>{JSON.stringify(body)}</output>
				</>
			);
		}
		render(<AccountSelection />);
		const trigger = screen.getByRole("combobox");
		const payload = () =>
			JSON.parse(screen.getByRole("status").textContent ?? "{}");
		expect(trigger.textContent).toContain("External");
		expect(payload()).not.toHaveProperty("sourceAccountId");
		// Actuate entirely by keyboard: under parallel-suite load the Base UI
		// popup mounts hidden and only becomes accessible/pointer-ready
		// hundreds of milliseconds after the trigger click, so pointer
		// clicks race both transitions. Keyboard selection is what keyboard
		// users do and needs no pointer hit test.
		await user.tab();
		expect(document.activeElement).toBe(trigger);
		await user.keyboard("{ArrowDown}");
		// Await the real open transition instead of racing it. The budget
		// tolerates suite-parallel CPU contention; the assertions below are
		// unchanged.
		await screen.findByRole(
			"option",
			{ name: "Imported account" },
			{ timeout: 10000 },
		);
		await user.keyboard("{Home}");
		await user.keyboard("{ArrowDown}");
		await user.keyboard("{Enter}");
		expect(trigger.textContent).toContain("Imported account");
		expect(payload().sourceAccountId).toBe("__none");
		await user.keyboard("{ArrowDown}");
		await screen.findByRole("option", { name: "External" }, { timeout: 10000 });
		await user.keyboard("{Escape}");
		expect(payload().sourceAccountId).toBe("__none");
		await user.keyboard("{ArrowDown}");
		await screen.findByRole("option", { name: "External" }, { timeout: 10000 });
		await user.keyboard("{Home}");
		await user.keyboard("{Enter}");
		expect(trigger.textContent).toContain("External");
		expect(payload()).not.toHaveProperty("sourceAccountId");
	},
);
