import { useEffect, useRef, useState } from "react";

interface Section {
	id: string;
	label: string;
}

const sections: Section[] = [
	{ id: "overview", label: "Overview" },
	{ id: "projection-chart", label: "Chart" },
	{ id: "projected-shortfalls", label: "Shortfalls" },
	{ id: "model-inputs", label: "Inputs" },
	{ id: "scenario-snapshots", label: "Scenarios" },
	{ id: "projection-settings", label: "Settings" },
];

export function SectionNav() {
	const [activeId, setActiveId] = useState(sections[0].id);
	const observerRef = useRef<IntersectionObserver | null>(null);

	useEffect(() => {
		const els = sections
			.map((s) => document.getElementById(s.id))
			.filter(Boolean) as HTMLElement[];

		observerRef.current = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((e) => e.isIntersecting)
					.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
				if (visible.length > 0) {
					setActiveId(visible[0].target.id);
				}
			},
			{ rootMargin: "-80px 0px -60% 0px", threshold: 0 },
		);

		for (const el of els) {
			observerRef.current.observe(el);
		}

		return () => observerRef.current?.disconnect();
	}, []);

	const handleClick = (id: string) => {
		const el = document.getElementById(id);
		if (el) {
			el.scrollIntoView({ behavior: "smooth", block: "start" });
		}
	};

	return (
		<nav className="sticky top-0 z-30 border-b border-border bg-card/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80 no-print">
			<div className="mx-auto flex max-w-[106rem] items-center gap-1 px-3 py-0 md:px-8">
				<span className="hidden type-eyebrow md:mr-4 md:inline">Net Worth</span>
				<div className="flex gap-0.5 overflow-x-auto scrollbar-none">
					{sections.map((s) => (
						<button
							key={s.id}
							type="button"
							onClick={() => handleClick(s.id)}
							className={`shrink-0 whitespace-nowrap border-b-2 px-2 py-3 text-xs font-medium transition-colors md:px-3 ${
								activeId === s.id
									? "border-primary text-foreground"
									: "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
							}`}
						>
							{s.label}
						</button>
					))}
				</div>
			</div>
		</nav>
	);
}
