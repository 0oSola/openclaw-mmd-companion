import { normalizeWorkspacePathIdentity } from "./workspacePathIdentity.js";
function normalizeAgent(value) {
    return value.trim().toLowerCase();
}
export function createCodexSessionContext() {
    let generation = 0;
    function advance() {
        generation += 1;
        return generation;
    }
    return {
        capture(context) {
            return {
                generation,
                workspacePath: normalizeWorkspacePathIdentity(context.workspacePath),
                agent: normalizeAgent(context.agent),
            };
        },
        invalidate() {
            return advance();
        },
        advance,
        isCurrent(snapshot, context) {
            return (snapshot.generation === generation &&
                snapshot.workspacePath === normalizeWorkspacePathIdentity(context.workspacePath) &&
                snapshot.agent === normalizeAgent(context.agent));
        },
    };
}
