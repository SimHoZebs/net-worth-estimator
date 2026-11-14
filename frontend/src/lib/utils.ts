import { createCn } from "cn/config";

/**
 * Application class merger: the generated `cn` extended with the semantic
 * radius (control, surface) and shadow (overlay) scale, so overrides like
 * `cn(base, "rounded-none")` collapse to one class. Import this instead of
 * the bare `cn` package or `mergeStyles`; both names share this instance.
 */
export const cn = createCn({
	extend: { theme: { radius: ["control", "surface"], shadow: ["overlay"] } },
});
