import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useEditDraft } from "./useEditDraft.ts";

afterEach(cleanup);

it("takes a baseline when each field first becomes an edit", () => {
	const view = renderHook(
		({ name, balance }) => useEditDraft("account", { name, balance }),
		{ initialProps: { name: "Old", balance: "100" } },
	);
	act(() => view.result.current.update({ name: "Mine" }));
	view.rerender({ name: "Old", balance: "200" });
	expect(view.result.current.value.balance).toBe("200");
	act(() => view.result.current.update({ balance: "250" }));
	expect(view.result.current.conflict).toBe(false);
	view.rerender({ name: "Old", balance: "300" });
	expect(view.result.current.conflict).toBe(true);
	act(() => view.result.current.reset());
	expect(view.result.current.value).toEqual({ name: "Old", balance: "300" });
	expect(view.result.current.dirty).toBe(false);
});
