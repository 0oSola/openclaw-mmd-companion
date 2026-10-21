const endpoint = process.argv[2] ?? "http://127.0.0.1:9229";
const promptText = process.argv[3] ?? "QA follow-up from floating notice";

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

const snapshot = () =>
  evaluate(`(() => ({
    href: location.href,
    readyState: document.readyState,
    stackClass: document.querySelector('[data-testid="completion-notice-stack"]')?.className ?? null,
    cards: [...document.querySelectorAll('[data-testid^="completion-notice-card-"]')]
      .map((node) => node.getAttribute("data-testid")),
    inputs: [...document.querySelectorAll('[data-testid^="completion-notice-follow-up-input-"]')]
      .map((node) => ({
        testId: node.getAttribute("data-testid"),
        value: node.value,
        rect: (() => {
          const r = node.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        })(),
      })),
    buttons: [...document.querySelectorAll("button[data-testid]")]
      .map((node) => ({
        testId: node.getAttribute("data-testid"),
        disabled: node.disabled,
        text: node.textContent?.trim() ?? "",
      })),
  }))()`);

console.log(JSON.stringify({ phase: "before", state: await snapshot() }, null, 2));

await evaluate(`(() => {
  const toggle = document.querySelector('[data-testid="completion-notice-toggle"]');
  if (!toggle) throw new Error("completion notice toggle not found");
  toggle.click();
  return true;
})()`);
await new Promise((resolve) => setTimeout(resolve, 350));

console.log(JSON.stringify({ phase: "expanded", state: await snapshot() }, null, 2));

const result = await evaluate(`(() => {
  const input = [...document.querySelectorAll('[data-testid^="completion-notice-follow-up-input-"]')].at(-1);
  if (!input) throw new Error("follow-up input not found after expand");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("HTMLInputElement.value setter not found");
  setter.call(input, ${JSON.stringify(promptText)});
  input.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
    data: ${JSON.stringify(promptText)},
  }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  const form = input.closest("form");
  if (!form) throw new Error("follow-up form not found");
  form.requestSubmit();
  return {
    inputTestId: input.getAttribute("data-testid"),
    value: input.value,
    submitted: true,
  };
})()`);

console.log(JSON.stringify({ phase: "submitted", result }, null, 2));
await new Promise((resolve) => setTimeout(resolve, 700));
console.log(JSON.stringify({ phase: "after-submit", state: await snapshot() }, null, 2));

socket.close();
