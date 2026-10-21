import fs from "node:fs";

const endpoint = process.argv[2] ?? "http://127.0.0.1:9229";
const outputDirectory = process.argv[3] ?? "D:/workspace/MMD project/artifacts";

fs.mkdirSync(outputDirectory, { recursive: true });

const targets = await (await fetch(`${endpoint}/json/list`)).json();
const target = targets.find((item) => item.url.includes("/notification.html"));
if (!target) {
  throw new Error("notification.html target not found");
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const resolve = pending.get(message.id);
  if (!resolve) return;
  pending.delete(message.id);
  resolve(message);
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (message) => {
      if (message.error) {
        reject(new Error(`${method}: ${message.error.message}`));
      } else {
        resolve(message);
      }
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return response.result?.result?.value;
}

async function wait(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function capture(fileName) {
  const response = await call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const filePath = `${outputDirectory}/${fileName}`;
  fs.writeFileSync(filePath, Buffer.from(response.result.data, "base64"));
  return filePath;
}

function readState() {
  return evaluate(`(() => {
    const stack = document.querySelector('[data-testid="completion-notice-stack"]');
    return {
      className: stack?.className ?? null,
      cards: document.querySelectorAll('[data-testid^="completion-notice-card-"]').length,
      aggregate: Boolean(document.querySelector('[data-testid^="completion-notice-aggregate-"]')),
      inputs: document.querySelectorAll('[data-testid^="completion-notice-follow-up-input-"]').length,
      text: stack?.innerText ?? "",
    };
  })()`);
}

const initial = await readState();
if (initial.className !== "completion-notice-stack is-expanded") {
  await evaluate(`document.querySelector('[data-testid="completion-notice-toggle"]')?.click(); true`);
  await wait(400);
}

const expanded = await readState();
const expandedPath = await capture("desktop-pet-qa-cdp-notification-expanded.png");

await evaluate(`document.querySelector('[data-testid="completion-notice-toggle"]')?.click(); true`);
await wait(400);

const collapsed = await readState();
const collapsedPath = await capture("desktop-pet-qa-cdp-notification-collapsed.png");

console.log(
  JSON.stringify(
    {
      target: {
        title: target.title,
        url: target.url,
        id: target.id,
      },
      initial,
      expanded,
      collapsed,
      files: {
        expanded: expandedPath,
        collapsed: collapsedPath,
      },
    },
    null,
    2,
  ),
);

socket.close();
