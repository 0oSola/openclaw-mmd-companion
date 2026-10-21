import { normalizeWorkspacePathIdentity } from "./workspacePathIdentity.js";

export type CodexSessionContextIdentity = {
  workspacePath: string;
  agent: string;
};

export type CodexSessionContextSnapshot = {
  readonly generation: number;
  readonly workspacePath: string;
  readonly agent: string;
};

function normalizeAgent(value: string): string {
  return value.trim().toLowerCase();
}

export function createCodexSessionContext() {
  let generation = 0;

  function advance(): number {
    generation += 1;
    return generation;
  }

  return {
    capture(context: CodexSessionContextIdentity): CodexSessionContextSnapshot {
      return {
        generation,
        workspacePath: normalizeWorkspacePathIdentity(context.workspacePath),
        agent: normalizeAgent(context.agent),
      };
    },

    invalidate(): number {
      return advance();
    },

    advance,

    isCurrent(snapshot: CodexSessionContextSnapshot, context: CodexSessionContextIdentity): boolean {
      return (
        snapshot.generation === generation &&
        snapshot.workspacePath === normalizeWorkspacePathIdentity(context.workspacePath) &&
        snapshot.agent === normalizeAgent(context.agent)
      );
    },
  };
}
