// Shared class source for the server-rendered auth pages. These pages are
// plain HTML strings (and a small DOM script), so they cannot use the React
// button and input primitives directly. The recipes below compose the single
// preset source in frontend/src/components/ui/control-styles.ts (no React
// runtime): the same buttonVariants and inputClassName the React primitives
// render. Both the static templates in pages.ts and the dynamically created
// passkey buttons in client.ts import from this one module, so static and
// dynamic controls always match and there is no second visual owner. Form
// actions, names, autocomplete, CSP, CSRF, and passkey behavior live
// elsewhere and are unchanged by these classes.
import { buttonVariants, inputClassName } from "../../../frontend/src/components/ui/control-styles";

/** Preset default button at the large size, for form submit actions. */
export const primaryButton = buttonVariants({ variant: "default", size: "lg" });

/** Preset outline button at the large size, for secondary form actions. */
export const secondaryButton = buttonVariants({
  variant: "outline",
  size: "lg",
});

/** Preset ghost button at the small size, for inline and list actions. */
export const ghostButton = buttonVariants({ variant: "ghost", size: "sm" });

/** Vertical label-plus-control stack. */
export const fieldClass = "flex min-w-0 flex-col gap-2";

/** Preset label text for a static page. */
export const labelClass = "text-sm font-medium text-muted-foreground";

/** Preset input control. */
export const controlClass = inputClassName;

export const brand = {
  link: "flex items-center gap-2 text-2xl font-bold tracking-tight",
  mark: "grid size-8 place-items-center rounded-xl bg-primary",
  icon: "w-7 fill-none stroke-primary-foreground [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2]",
  path: "m5 23 6-15 6 12 5-9 5 12",
};
