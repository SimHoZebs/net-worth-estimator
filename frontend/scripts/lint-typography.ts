import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import ts from "typescript";

/** Warn about ownership, without prescribing font names, roles, or sizes. */
export function typographyWarnings(path: string, source: string): string[] {
	const warnings: string[] = [];
	const warn = (property: string, line = 1) =>
		warnings.push(
			`${path}:${line}: warning typography-owner: Use shared typography roles instead of local ${property} (src/styles/README.md).`,
		);
	if (path.endsWith(".css")) {
		postcss.parse(source, { from: path }).walkDecls((declaration) => {
			const property = declaration.prop.toLowerCase();
			if (
				(path !== "src/styles/typography.css" &&
					(property === "font-family" ||
						(property === "font" && declaration.value !== "inherit"))) ||
				(property.startsWith("--font-") && path !== "src/styles/tokens.css")
			)
				warn(property, declaration.source?.start?.line);
		});
		return warnings;
	}
	const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
	const visit = (node: ts.Node) => {
		let property = "";
		if (ts.isPropertyAssignment(node) || ts.isJsxAttribute(node)) {
			const name = node.name;
			property =
				ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)
					? name.expression.text
					: ts.isIdentifier(name) || ts.isStringLiteral(name)
						? name.text
						: "";
		} else if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken
		) {
			if (ts.isPropertyAccessExpression(node.left))
				property = node.left.name.text;
			else if (
				ts.isElementAccessExpression(node.left) &&
				ts.isStringLiteral(node.left.argumentExpression)
			) {
				property = node.left.argumentExpression.text;
			}
		} else if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.name.text === "setProperty" &&
			node.arguments[0] &&
			ts.isStringLiteral(node.arguments[0])
		)
			property = node.arguments[0].text;
		if (
			["font", "fontFamily", "font-family"].includes(property) ||
			property.startsWith("--font-")
		) {
			warn(
				property,
				file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
			);
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return warnings;
}

if (import.meta.main) {
	const root = fileURLToPath(new URL("../src/", import.meta.url));
	for (const path of readdirSync(root, { recursive: true, encoding: "utf8" })) {
		if (!/\.(css|[jt]sx?)$/.test(path) || /\.test\.[jt]sx?$/.test(path))
			continue;
		const source = readFileSync(resolve(root, path), "utf8");
		for (const warning of typographyWarnings(
			`src/${path.replaceAll("\\", "/")}`,
			source,
		)) {
			console.warn(warning);
		}
	}
}
