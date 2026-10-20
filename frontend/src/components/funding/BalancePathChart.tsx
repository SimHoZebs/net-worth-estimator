import { useMemo } from "react";
import { money } from "../../domain/format.ts";
import type { FundingGap } from "../../domain/fundingGaps.ts";
import { summarizeFundingGap } from "../../domain/fundingGaps.ts";

/** Projected balance path with the refused payment as an explanatory red vector. Never posted. */
export function BalancePathChart({ gap }: { gap: FundingGap }) {
	const summary = useMemo(() => summarizeFundingGap(gap), [gap]);
	const chart = useMemo(() => {
		const points = [
			gap.openingBalance,
			...summary.rows.map((row) => row.balanceAfter),
		];
		const hypothetical = summary.projectedBalanceIfExecuted;
		const peak = Math.max(1000, ...points, hypothetical);
		const trough = Math.min(0, ...points, hypothetical);
		const ymax = peak + Math.max(450, (peak - trough) * 0.13);
		const ymin = trough - Math.max(350, (peak - trough) * 0.09);
		const left = 28;
		const right = 609;
		const top = 14;
		const bottom = 201;
		const x = (index: number) =>
			left + (index / points.length) * (right - left);
		const y = (value: number) =>
			top + ((ymax - value) / (ymax - ymin)) * (bottom - top);
		const path = points
			.map(
				(value, i) =>
					`${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(value).toFixed(1)}`,
			)
			.join(" ");
		const end = points.length - 1;
		const endX = x(end);
		const nextX = x(end + 1);
		const line = `M ${endX} ${y(points[end] ?? 0)} L ${nextX} ${y(hypothetical)}`;
		const area = `${path} L ${endX} ${y(0)} L ${x(0)} ${y(0)} Z`;
		return {
			path,
			line,
			area,
			nextX,
			lastX: endX,
			currentY: y(points[end] ?? 0),
			failedY: y(hypothetical),
			baseline: y(0),
			hypothetical,
		};
	}, [gap.openingBalance, summary]);
	return (
		<div className="funding-chart-wrap">
			<svg
				viewBox="0 0 640 222"
				role="img"
				aria-label={`Balance starts at ${money(gap.openingBalance)}, moves to ${money(summary.available)} before the payment, and would fall to ${money(chart.hypothetical)} if the refused payment were forced. A horizontal line marks zero.`}
				preserveAspectRatio="none"
			>
				<defs>
					<linearGradient id="funding-balance-area" x1="0" x2="0" y1="0" y2="1">
						<stop offset="0%" stopColor="#315f47" stopOpacity=".18" />
						<stop offset="100%" stopColor="#315f47" stopOpacity="0" />
					</linearGradient>
				</defs>
				<rect
					x="28"
					y={chart.baseline}
					width="581"
					height={Math.max(0, 201 - chart.baseline)}
					fill="#a34536"
					opacity=".06"
				/>
				<line
					x1="28"
					x2="609"
					y1={chart.baseline}
					y2={chart.baseline}
					stroke="#8a907e"
					strokeWidth="1.4"
					strokeDasharray="6 6"
				/>
				<text x="28" y={chart.baseline - 7} fill="#737970" fontSize="11">
					$0
				</text>
				<path d={chart.area} fill="url(#funding-balance-area)" />
				<path
					d={chart.path}
					fill="none"
					stroke="#315f47"
					strokeWidth="3.5"
					strokeLinejoin="round"
					strokeLinecap="round"
				/>
				<line
					x1={chart.nextX}
					x2={chart.nextX}
					y1="11"
					y2="201"
					stroke="#a34536"
					strokeWidth="1"
					strokeDasharray="5 5"
					opacity=".6"
				/>
				<path
					d={chart.line}
					fill="none"
					stroke="#a34536"
					strokeWidth="4"
					strokeLinecap="round"
				/>
				<circle
					cx={chart.lastX}
					cy={chart.currentY}
					r="5.5"
					fill="#315f47"
					stroke="white"
					strokeWidth="2"
				/>
				<circle
					cx={chart.nextX}
					cy={chart.failedY}
					r="7"
					fill="#a34536"
					stroke="white"
					strokeWidth="2"
				/>
				<text
					x={chart.nextX - 4}
					y={Math.max(20, chart.failedY - 13)}
					fill="#9b493a"
					fontSize="12"
					fontWeight="700"
					textAnchor="end"
				>
					−{money(summary.shortfall)}
				</text>
			</svg>
			<div className="funding-chart-foot">
				<span>
					{gap.windowStartDate.slice(5).replace("-", "/")} · Window start
				</span>
				<span>$0 threshold</span>
				<span>Failure · {gap.date.slice(5).replace("-", "/")}</span>
			</div>
		</div>
	);
}
