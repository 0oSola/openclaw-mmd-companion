import { readFile } from "node:fs/promises";
import { validateAuthorHandoff } from "./index.mjs";

const responsePath = process.argv[2];
if (!responsePath) {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: "用法：node validate-response.mjs <response-file>",
  }));
  process.exit(1);
}

try {
  const message = await readFile(responsePath, "utf8");
  const result = validateAuthorHandoff(message);
  process.stdout.write(JSON.stringify({
    ok: true,
    present: result.present,
    candidate_count: result.present ? result.payload.marker.knowledge_candidates.length : 0,
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exit(1);
}
