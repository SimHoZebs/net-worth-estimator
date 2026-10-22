import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import ts from "typescript";
import {
	approvedSpacing,
	normalizeSpacingClasses,
	normalizeSpacingUtility,
	sizingWarning,
	spacing,
} from "./style-scale.ts";
export {
	normalizeSpacingClasses,
	normalizeSpacingUtility,
} from "./style-scale.ts";

const cssSpacing =
	/^(?:(?:padding|margin|scroll-padding|scroll-margin)(?:-(?:top|right|bottom|left|block(?:-start|-end)?|inline(?:-start|-end)?))?|(?:min-|max-)?(?:width|height|inline-size|block-size)|(?:row-|column-)?gap|grid-gap|inset(?:-(?:block|inline)(?:-start|-end)?)?|top|right|bottom|left|flex-basis|text-indent|border-spacing)$/;
const className = /(?:class(?:es|names?)?|styles)$/i;

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
	const check = (token: string, line: number) => {
		const message = sizingWarning(token);
		if (message) warn(line, token, message);
	};
	if (path.endsWith(".css")) {
		const root = postcss.parse(source, { from: path });
		root.walkAtRules("apply", (rule) => {
			const normalized = normalizeSpacingClasses(rule.params);
			normalized
				.split(/\s+/)
				.forEach((token) => check(token, rule.source?.start?.line ?? 1));
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
			const ordinary =
				/^(?:padding|margin|scroll-padding|scroll-margin|(?:row-|column-)?gap|grid-gap|border-spacing)(?:-|$)/.test(
					declaration.prop,
				);
			const values = parts.map((value) => {
				const scaleCall = /^--spacing\((-?[\d.]+)\)$/.exec(value);
				const result =
					scaleCall && ordinary
						? {
								scale:
									Math.abs(Number(scaleCall[1])) === 0.25
										? "px"
										: String(Math.abs(Number(scaleCall[1]))),
								negative: Number(scaleCall[1]) < 0,
							}
						: spacing(value);
				if (!result) return value;
				if (ordinary) result.scale = approvedSpacing(result.scale);
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
					check(
						normalized,
						file.getLineAndCharacterOfPosition(start + offset).line + 1,
					);
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
			const name =
				ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)
					? node.name.text
					: undefined;
			// CVA defaults and compound conditions select variants; they are not classes.
			if (name === "defaultVariants") return;
			if (
				name === "compoundVariants" &&
				ts.isArrayLiteralExpression(node.initializer)
			) {
				for (const element of node.initializer.elements) {
					if (!ts.isObjectLiteralExpression(element)) continue;
					for (const property of element.properties) {
						if (
							ts.isPropertyAssignment(property) &&
							(ts.isIdentifier(property.name) ||
								ts.isStringLiteral(property.name)) &&
							/^(?:class|className)$/.test(property.name.text)
						)
							visitClasses(property.initializer);
					}
				}
				return;
			}
			visitClasses(node.initializer);
		} else if (ts.isCallExpression(node)) {
			if (
				/^(?:clsx|cx|cn|classNames|cva|mergeStyles)$/.test(
					node.expression.getText(file),
				)
			)
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
			/^(?:clsx|cx|cn|classNames|cva|mergeStyles)$/.test(
				node.expression.getText(file),
			)
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
	let remaining = 0;
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
		const unresolved = fix
			? analyze(relative, result.source).warnings
			: result.warnings;
		remaining += unresolved.length;
		for (const warning of unresolved) console.warn(warning);
	}
	console.log(
		fix
			? `Fixed ${count - remaining} style-scale violation(s); ${remaining} remain.`
			: `Found ${remaining} style-scale violation(s).`,
	);
	if (remaining) process.exitCode = 1;
}
