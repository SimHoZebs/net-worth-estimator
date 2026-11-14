// Guest chrome: a fixed frame marks the whole viewport as a shared guest
// session. It is click-through and stays out of the document flow, so it
// adds no space, moves no target, and never intercepts input. Base UI
// dialog portals use z-50 and cover the lower-layer guest frame.
export function GuestFrame() {
	return (
		<div className="pointer-events-none fixed inset-0 z-(--z-guest) border-2 border-solid border-guest print:hidden">
			<p className="absolute top-0 left-1/2 -translate-x-1/2 rounded-b-md bg-guest px-2 py-0.5 text-xs font-semibold text-guest-foreground">
				guest view
			</p>
		</div>
	);
}
