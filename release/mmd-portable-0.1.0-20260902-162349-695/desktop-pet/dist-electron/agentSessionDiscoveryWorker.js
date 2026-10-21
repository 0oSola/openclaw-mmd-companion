import { parentPort } from "node:worker_threads";
import { discoverLocalClaudeSessions, discoverLocalCodexSessions, discoverPetAppServerSessions, } from "./agentSessionDiscovery.js";
import { createWindowsAgentProcessScanner } from "./agentProcessScanner.js";
import { createPetAppServerSessionScanner } from "./petAppServerSessionApi.js";
import { scanRecentCodexSessionFiles } from "./codexSessionFiles.js";
import { scanRecentClaudeSessionFiles } from "./claudeSessionFiles.js";
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
async function discover(request) {
    const limit = Math.max(1, Math.min(request.limit, 200));
    const results = await Promise.allSettled([
        discoverLocalCodexSessions({
            codexHome: request.codexHome,
            wslCodexHome: request.wslCodexHome,
            limit,
            scan: scanRecentCodexSessionFiles,
        }),
        discoverLocalClaudeSessions({
            claudeHome: request.claudeHome,
            limit,
            maxFiles: Math.max(400, limit * 8),
            scan: scanRecentClaudeSessionFiles,
        }),
        discoverPetAppServerSessions({
            limit: Math.min(limit, 50),
            scan: createPetAppServerSessionScanner({
                apiBaseUrl: request.apiBaseUrl,
                userId: request.userId,
            }),
        }),
    ]);
    const candidates = [];
    const providerErrors = [];
    const providers = ["codex", "claude", "pet-app-server"];
    for (const [index, result] of results.entries()) {
        if (result.status === "fulfilled") {
            const agentHome = index === 0 ? request.codexHome : index === 1 ? request.claudeHome : null;
            candidates.push(...result.value.sessions.map((session) => ({ session, agentHome })));
        }
        else {
            providerErrors.push({ provider: providers[index] ?? "unknown", error: errorText(result.reason) });
        }
    }
    let processScanCompleted = false;
    let processObservations = [];
    if (process.platform === "win32") {
        try {
            processObservations = await createWindowsAgentProcessScanner()();
            processScanCompleted = true;
        }
        catch (error) {
            providerErrors.push({ provider: "process", error: errorText(error) });
        }
    }
    return { candidates, processObservations, processScanCompleted, providerErrors };
}
if (!parentPort) {
    throw new Error("Agent session discovery worker requires parentPort");
}
parentPort.once("message", async (request) => {
    try {
        parentPort.postMessage({ ok: true, result: await discover(request) });
    }
    catch (error) {
        parentPort.postMessage({ ok: false, error: errorText(error) });
    }
    finally {
        parentPort.close();
    }
});
