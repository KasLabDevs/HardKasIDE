/**
 * Monaco's TypeScript worker, knowing the module extensions. Monaco 0.52 decides a file's kind from `.ts/.tsx/.js/.jsx`
 * only and takes anything else for JavaScript (we run with `allowJs`), so a `.mts` file, or a package's `.d.mts`
 * types, came up full of "Type annotations can only be used in TypeScript files" while `tsc` is happy.
 */
// @ts-expect-error Monaco ships this worker without type declarations.
import * as monacoTsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker";
import { scriptKindFor, type ScriptKinds } from "./scriptKind";

const { initialize, TypeScriptWorker, ts } = monacoTsWorker as unknown as {
  initialize(factory: (ctx: unknown, createData: unknown) => unknown): void;
  TypeScriptWorker: new (ctx: unknown, createData: unknown) => { getScriptKind(fileName: string): number };
  ts: { ScriptKind: ScriptKinds };
};

class ModuleAwareWorker extends TypeScriptWorker {
  getScriptKind(fileName: string): number {
    return scriptKindFor(fileName, ts.ScriptKind) ?? super.getScriptKind(fileName);
  }
}

// Importing the worker module installed Monaco's own handler; this one replaces it before the first message.
self.onmessage = () => {
  initialize((ctx: unknown, createData: unknown) => new ModuleAwareWorker(ctx, createData));
};
