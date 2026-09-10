// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ACTION_COMPONENTS = new Map([
  ["Button", "onClick"],
  ["button", "onClick"],
  ["Pressable", "onPress"],
  ["TouchableOpacity", "onPress"],
  ["TouchableHighlight", "onPress"],
  ["TouchableWithoutFeedback", "onPress"],
]);

function collectTsxFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(absolutePath);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [absolutePath] : [];
  });
}

function openingElement(node: ts.JsxElement | ts.JsxSelfClosingElement) {
  return ts.isJsxElement(node) ? node.openingElement : node;
}

function isWrappedByNavigation(node: ts.Node, sourceFile: ts.SourceFile) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent)) {
      const tagName = parent.openingElement.tagName.getText(sourceFile);
      if (tagName === "a" || tagName === "Link") return true;
    }
    if (ts.isSourceFile(parent)) break;
  }
  return false;
}

function isInsideForm(node: ts.Node, sourceFile: ts.SourceFile) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(sourceFile) === "form") return true;
    if (ts.isSourceFile(parent)) break;
  }
  return false;
}

function isSubmitAttribute(attribute: ts.JsxAttribute | undefined) {
  const initializer = attribute?.initializer;
  if (!initializer) return false;
  if (ts.isStringLiteral(initializer)) return initializer.text === "submit";
  if (!ts.isJsxExpression(initializer) || !initializer.expression) return false;
  return ts.isStringLiteral(initializer.expression)
    ? initializer.expression.text === "submit"
    : true;
}

function findInertActions(file: string) {
  const source = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings: string[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const element = openingElement(node);
      const tagName = element.tagName.getText(sourceFile);
      const actionProperty = ACTION_COMPONENTS.get(tagName);
      if (actionProperty) {
        const attributes = element.attributes.properties;
        const jsxAttributes = attributes.filter(ts.isJsxAttribute);
        const attributeNames = new Set(jsxAttributes.map((attribute) => attribute.name.getText(sourceFile)));
        const typeAttribute = jsxAttributes.find((attribute) => attribute.name.getText(sourceFile) === "type");
        const implicitNativeSubmit = tagName === "button" && !typeAttribute && isInsideForm(node, sourceFile);
        const permanentlyDisabled = jsxAttributes.some((attribute) =>
          attribute.name.getText(sourceFile) === "disabled" && !attribute.initializer,
        );
        const wired = attributes.some(ts.isJsxSpreadAttribute)
          || attributeNames.has(actionProperty)
          || isSubmitAttribute(typeAttribute)
          || implicitNativeSubmit
          || permanentlyDisabled
          || isWrappedByNavigation(node, sourceFile);
        if (!wired) {
          const position = sourceFile.getLineAndCharacterOfPosition(element.getStart(sourceFile));
          findings.push(`${path.relative(process.cwd(), file)}:${position.line + 1} <${tagName}>`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
}

describe("interactive action wiring", () => {
  it("rejects web and native action components with no handler, submission, or navigation", () => {
    const files = [
      ...collectTsxFiles(path.join(process.cwd(), "src")),
      ...collectTsxFiles(path.join(process.cwd(), "apps", "mobile")),
    ];
    const inertActions = files.flatMap(findInertActions);

    expect(inertActions, `Inert actions found:\n${inertActions.join("\n")}`).toEqual([]);
  });
});
