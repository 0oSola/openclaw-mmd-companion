import { handleStop } from "./index.mjs";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

let input;
try {
  input = JSON.parse(raw);
} catch {
  process.stdout.write(JSON.stringify({
    continue: false,
    stopReason: "作者知识交接 Stop Hook 收到的输入不是有效 JSON。",
  }));
  process.exit(0);
}

process.stdout.write(JSON.stringify(await handleStop(input)));
