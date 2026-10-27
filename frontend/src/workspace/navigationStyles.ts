/** Shared by navigation links and the theme control. */
export const navigationLinkClassName =
	"relative flex min-h-11 w-full items-center gap-3 rounded-surface border-0 bg-transparent px-3 py-2 text-left text-sm font-medium text-muted transition-colors duration-150 hover:bg-hover hover:text-primary aria-[current=page]:font-bold aria-[current=page]:text-ink";

/** Sliding active background. Rendered once via a shared motion layoutId
 * inside the active sidebar link; content sits above it via a relative
 * wrapper. */
export const navigationActiveSquareClassName =
	"absolute inset-0 rounded-surface bg-active";
