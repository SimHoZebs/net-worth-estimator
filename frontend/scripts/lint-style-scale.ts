import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import ts from "typescript";

const utility =
	/^(p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy]|[wh]|size|min-[wh]|max-[wh]|basis|indent|inset(?:-[xyse])?|top|right|bottom|left|start|end|translate(?:-[xy])?|scroll-[mp][xytrblse]?|border-spacing(?:-[xy])?)-\[(.+)\]$/;
const cssSpacing =
	/^(?:(?:padding|margin|scroll-padding|scroll-margin)(?:-(?:top|right|bottom|left|block(?:-start|-end)?|inline(?:-start|-end)?))?|(?:min-|max-)?(?:width|height|inline-size|block-size)|(?:row-|column-)?gap|grid-gap|inset(?:-(?:block|inline)(?:-start|-end)?)?|top|right|bottom|left|flex-basis|text-indent|border-spacing)$/;
const className = /class(?:es|names?)?$/i;

function spacing(value: string): { scale: string; negative: boolean } | null {
	const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|rem)?$/i.exec(value);
	if (!match || (!match[2] && Number(match[1]) !== 0)) return null;
	const pixels =
		Number(match[1]) * (match[2]?.toLowerCase() === "rem" ? 16 : 1);
	const absolute = Math.abs(pixels);
	const rounded =
		absolute >= 4
			? Math.round(absolute / 4) * 4
			: [0, 1, 2, 4].reduce((best, next) =>
					Math.abs(next - absolute) <= Math.abs(best - absolute) ? next : best,
				);
	return {
		scale: rounded === 1 ? "px" : String(rounded / 4),
		negative: pixels < 0 && rounded !== 0,
	};
}

/** Split variants only outside arbitrary selectors and function arguments. */
function variantEnd(value: string): number {
	let depth = 0;
	let end = 0;
	for (let index = 0; index < value.length; index++) {
		const character = value[index];
		if (character === "[" || character === "(") depth++;
		if (character === "]" || character === ")") depth--;
		if (character === ":" && depth === 0) end = index + 1;
	}
	return end;
}

/** A rem follows Tailwind's default scale: 1rem = four spacing units. */
export function normalizeSpacingUtility(token: string): string {
	const end = variantEnd(token);
	const prefix = token.slice(0, end);
	let base = token.slice(end);
	const importantBefore = base.startsWith("!") ? "!" : "";
	const importantAfter = base.endsWith("!") ? "!" : "";
	base = base.replace(/^!|!$/g, "");
	const negative = base.startsWith("-");
	if (negative) base = base.slice(1);
	const match = utility.exec(base);
	if (!match) return token;
	const name = match[1]!;
	const values = match[2]!.split("_").map(spacing);
	if (values.some((value) => value === null)) return token;
	let names = [name];
	if (values.length > 1) {
		if (["p", "m", "scroll-p", "scroll-m", "inset"].includes(name)) {
			const suffix = name === "inset" ? "-" : "";
			names =
				values.length === 2
					? [`${name}${suffix}y`, `${name}${suffix}x`]
					: values.length === 3
						? [`${name}${suffix}t`, `${name}${suffix}x`, `${name}${suffix}b`]
						: [
								`${name}${suffix}t`,
								`${name}${suffix}r`,
								`${name}${suffix}b`,
								`${name}${suffix}l`,
							];
			if (name === "inset" && values.length > 2)
				names =
					values.length === 3
						? ["top", "inset-x", "bottom"]
						: ["top", "right", "bottom", "left"];
		} else if (
			["gap", "border-spacing", "translate"].includes(name) &&
			values.length === 2
		) {
			names = name === "gap" ? ["gap-y", "gap-x"] : [`${name}-x`, `${name}-y`];
		} else return token;
	}
	if (names.length !== values.length) return token;
	return names
		.map((name, index) => {
			const value = values[index]!;
			const sign =
				value.scale !== "0" && negative !== value.negative ? "-" : "";
			return `${prefix}${importantBefore}${sign}${name}-${value.scale}${importantAfter}`;
		})
		.join(" ");
}

export function normalizeSpacingClasses(value: string): string {
	return value.replace(/\S+/g, normalizeSpacingUtility);
}

function isSource(path: string): boolean {
	return (
		/\.(?:tsx?|css)$/.test(path) &&
		!/(?:^|[/\\])(?:__tests__|tests?|fixtures)(?:[/\\]|$)|\.(?:test|spec)\.|\.d\.ts$/.test(
			path,
		)
	);
}

function analyze(
	path: string,
	source: string,
): { source: string; warnings: string[] } {
	const warnings: string[] = [];
	if (!isSource(path)) return { source, warnings };
	const warn = (line: number, before: string, after: string) => {
		warnings.push(
			`${path}:${line}: warning style-scale: ${before} -> ${after}`,
		);
	};
	if (path.endsWith(".css")) {
		const root = postcss.parse(source, { from: path });
		root.walkAtRules("apply", (rule) => {
			const normalized = normalizeSpacingClasses(rule.params);
			if (normalized === rule.params) return;
			warn(
				rule.source?.start?.line ?? 1,
				`@apply ${rule.params}`,
				`@apply ${normalized}`,
			);
			rule.params = normalized;
		});
		root.walkDecls((declaration) => {
			if (!cssSpacing.test(declaration.prop.toLowerCase())) return;
			// Function arguments and percentages are layout constraints, not scale values.
			const parts = postcss.list.space(declaration.value);
			const values = parts.map((value) => {
				const result = spacing(value);
				if (!result) return value;
				if (result.scale === "0") return "0";
				return `--spacing(${result.negative ? "-" : ""}${result.scale === "px" ? "0.25" : result.scale})`;
			});
			if (values.every((value, index) => value === parts[index])) return;
			const normalized = values.join(" ");
			warn(
				declaration.source?.start?.line ?? 1,
				`${declaration.prop}: ${declaration.value}`,
				`${declaration.prop}: ${normalized}`,
			);
			declaration.value = normalized;
		});
		return { source: root.toString(), warnings };
	}

	const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
	const bindings = new Map<string, ts.Expression | null>();
	const scanBindings = (node: ts.Node) => {
		if (
			(ts.isVariableDeclaration(node) ||
				ts.isParameter(node) ||
				ts.isBindingElement(node)) &&
			ts.isIdentifier(node.name)
		)
			bindings.set(
				node.name.text,
				bindings.has(node.name.text) ? null : (node.initializer ?? null),
			);
		ts.forEachChild(node, scanBindings);
	};
	scanBindings(file);
	const edits: { start: number; end: number; value: string }[] = [];
	const visited = new Set<ts.Node>();
	const visitClasses = (node: ts.Node) => {
		if (visited.has(node)) return;
		visited.add(node);
		if (
			ts.isStringLiteral(node) ||
			ts.isNoSubstitutionTemplateLiteral(node) ||
			ts.isTemplateHead(node) ||
			ts.isTemplateMiddle(node) ||
			ts.isTemplateTail(node)
		) {
			const start = node.getStart(file) + 1;
			const end =
				node.end -
				(ts.isTemplateHead(node) || ts.isTemplateMiddle(node) ? 2 : 1);
			const value = source
				.slice(start, end)
				.replace(/\S+/g, (token, offset: number) => {
					const normalized = normalizeSpacingUtility(token);
					if (normalized !== token)
						warn(
							file.getLineAndCharacterOfPosition(start + offset).line + 1,
							token,
							normalized,
						);
					return normalized;
				});
			if (value !== source.slice(start, end)) edits.push({ start, end, value });
		} else if (ts.isIdentifier(node)) {
			const binding = bindings.get(node.text);
			if (binding) visitClasses(binding);
		} else if (ts.isConditionalExpression(node)) {
			visitClasses(node.whenTrue);
			visitClasses(node.whenFalse);
		} else if (ts.isBinaryExpression(node)) {
			if (
				[
					ts.SyntaxKind.PlusToken,
					ts.SyntaxKind.BarBarToken,
					ts.SyntaxKind.QuestionQuestionToken,
				].includes(node.operatorToken.kind)
			)
				visitClasses(node.left);
			if (
				[
					ts.SyntaxKind.PlusToken,
					ts.SyntaxKind.BarBarToken,
					ts.SyntaxKind.QuestionQuestionToken,
					ts.SyntaxKind.AmpersandAmpersandToken,
				].includes(node.operatorToken.kind)
			)
				visitClasses(node.right);
		} else if (
			ts.isElementAccessExpression(node) ||
			ts.isPropertyAccessExpression(node)
		) {
			const key = ts.isPropertyAccessExpression(node)
				? node.name.text
				: ts.isStringLiteral(node.argumentExpression)
					? node.argumentExpression.text
					: undefined;
			const binding = ts.isIdentifier(node.expression)
				? bindings.get(node.expression.text)
				: undefined;
			if (key && binding && ts.isObjectLiteralExpression(binding)) {
				const property = binding.properties.find(
					(property) =>
						ts.isPropertyAssignment(property) &&
						(ts.isIdentifier(property.name) ||
							ts.isStringLiteral(property.name)) &&
						property.name.text === key,
				);
				if (property) visitClasses(property);
			} else visitClasses(node.expression);
		} else if (ts.isPropertyAssignment(node)) {
			visitClasses(node.initializer);
		} else if (ts.isCallExpression(node)) {
			if (/^(?:clsx|cx|cn|classNames|cva)$/.test(node.expression.getText(file)))
				node.arguments.forEach(visitClasses);
			else if (
				ts.isPropertyAccessExpression(node.expression) &&
				node.expression.name.text === "join"
			)
				visitClasses(node.expression.expression);
		} else {
			ts.forEachChild(node, visitClasses);
		}
	};
	const visit = (node: ts.Node) => {
		if (
			(ts.isJsxAttribute(node) ||
				ts.isPropertyAssignment(node) ||
				ts.isVariableDeclaration(node)) &&
			(ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
			className.test(node.name.text) &&
			node.initializer
		)
			visitClasses(node.initializer);
		if (
			ts.isCallExpression(node) &&
			/^(?:clsx|cx|cn|classNames|cva)$/.test(node.expression.getText(file))
		)
			node.arguments.forEach(visitClasses);
		ts.forEachChild(node, visit);
	};
	visit(file);
	for (const edit of edits.sort((left, right) => right.start - left.start))
		source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
	return { source, warnings };
}

export function normalizeStyleScale(path: string, source: string): string {
	return analyze(path, source).source;
}

export function styleScaleWarnings(path: string, source: string): string[] {
	return analyze(path, source).warnings;
}

if (import.meta.main) {
	const root = fileURLToPath(new URL("../src/", import.meta.url));
	const fix = process.argv.includes("--fix");
	let count = 0;
	for (const path of readdirSync(root, {
		recursive: true,
		encoding: "utf8",
	}).sort()) {
		const relative = `src/${path.replaceAll("\\", "/")}`;
		if (!isSource(relative)) continue;
		const absolute = resolve(root, path);
		const source = readFileSync(absolute, "utf8");
		const result = analyze(relative, source);
		count += result.warnings.length;
		if (fix && source !== result.source) writeFileSync(absolute, result.source);
		else for (const warning of result.warnings) console.warn(warning);
	}
	console.log(`${fix ? "Fixed" : "Found"} ${count} style-scale violation(s).`);
	if (count && !fix) process.exitCode = 1;
}
