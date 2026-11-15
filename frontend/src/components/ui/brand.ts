// Shared React-free brand recipe for the header mark and the
// server-rendered sign-in pages. No React runtime: both the React header in
// `Brand.tsx` and `auth/better-auth/src/controls.ts` import these strings,
// so there is one visual owner and no appearance change.
export const brandLink =
	"flex items-center gap-2 text-2xl font-bold tracking-tight";
export const brandMark = "grid size-8 place-items-center rounded-xl bg-primary";
export const brandIcon =
	"w-7 fill-none stroke-primary-foreground [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2]";
export const brandPath = "m5 23 6-15 6 12 5-9 5 12";

export const brand = {
	link: brandLink,
	mark: brandMark,
	icon: brandIcon,
	path: brandPath,
};
