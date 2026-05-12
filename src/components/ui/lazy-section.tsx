import { type ReactNode, useEffect, useRef, useState } from "react";

interface LazySectionProps {
	children: ReactNode;
	rootMargin?: string;
}

export function LazySection({
	children,
	rootMargin = "300px",
}: LazySectionProps) {
	const ref = useRef<HTMLDivElement | null>(null);
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		if (!ref.current || visible) return;

		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					setVisible(true);
					observer.disconnect();
				}
			},
			{ rootMargin },
		);

		observer.observe(ref.current);
		return () => observer.disconnect();
	}, [rootMargin, visible]);

	return <div ref={ref}>{visible ? children : null}</div>;
}
