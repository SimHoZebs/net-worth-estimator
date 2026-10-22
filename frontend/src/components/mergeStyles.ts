import { extendTailwindMerge } from "tailwind-merge";

/** Keep external class overrides aware of the application's semantic scale. */
export const mergeStyles = extendTailwindMerge({
	extend: {
		theme: {
			radius: ["control", "surface"],
			shadow: ["overlay"],
		},
	},
});
