import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import ts from "typescript";
import { CODE_EXTS, relRepo, repoRoot, walkFiles } from "./_walk.ts";

export interface CheckedSourceProgram {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly rootNames: readonly string[];
}

const cachedPrograms = new Map<string, CheckedSourceProgram>();

/** One checked program per explicit source-root and extension scope in this test process. */
export function sourceProgram(
  sourceRoot = join(repoRoot(), "core", "src"),
  extensions: readonly string[] = CODE_EXTS,
): CheckedSourceProgram {
  const key = `${sourceRoot}\0${extensions.join("\0")}`;
  const cached = cachedPrograms.get(key);
  if (cached !== undefined) return cached;

  const configPath = join(repoRoot(), "tsconfig.json");
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, repoRoot());
  const rootNames = walkFiles(sourceRoot, extensions);
  const program = ts.createProgram({ rootNames, options: parsed.options });
  const result = { program, checker: program.getTypeChecker(), rootNames };
  cachedPrograms.set(key, result);
  return result;
}

export function repoSourceFile(program: ts.Program, relativePath: string): ts.SourceFile {
  const expected = resolve(repoRoot(), relativePath);
  const source = program.getSourceFiles().find((candidate) => resolve(candidate.fileName) === expected);
  assert.notEqual(source, undefined, `missing source file ${relativePath}`);
  return source!;
}

export function functionDeclaration(source: ts.SourceFile, name: string): ts.FunctionDeclaration {
  const matches = source.statements.filter((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.equal(matches.length, 1, `${relRepo(source.fileName)} must declare exactly one ${name}`);
  return matches[0]!;
}

export function sourceLocation(source: ts.SourceFile, node: ts.Node): string {
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${relRepo(source.fileName)}:${String(position.line + 1)}:${String(position.character + 1)}`;
}
