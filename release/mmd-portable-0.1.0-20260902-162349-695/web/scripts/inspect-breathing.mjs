import { chromium } from "@playwright/test";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sampleRuntime(page) {
  return page.evaluate(() => {
    const runtime = window.__mmdCompanionRuntime;
    if (!runtime) {
      return { ready: false, reason: "runtime-missing" };
    }

    const readBone = (slot) => {
      const bone = runtime.bones?.[slot];
      return bone
        ? {
            name: bone.name,
            rotation: {
              x: Number(bone.rotation?.x || 0),
              y: Number(bone.rotation?.y || 0),
              z: Number(bone.rotation?.z || 0),
            },
          }
        : null;
    };

    return {
      ready: true,
      status: runtime.statusElement?.textContent || "",
      currentClip: Boolean(runtime.currentClip),
      sampleBoneNames: (runtime.baseBoneTransforms || []).slice(0, 40).map((entry) => entry?.bone?.name || "").filter(Boolean),
      morphNames: Object.keys(runtime.model?.morphTargetDictionary || {}),
      expressionMorphSlots: runtime.expressionMorphSlots || {},
      activeEmotion: runtime.activeEmotion,
      activeAction: runtime.activeAction,
      bones: {
        upperBody: readBone("upperBody"),
        neck: readBone("neck"),
        head: readBone("head"),
        leftArm: readBone("leftArm"),
        rightArm: readBone("rightArm"),
      },
    };
  });
}

function summarizeDeltas(samples, slot, axis) {
  const values = samples.map((sample) => sample.bones?.[slot]?.rotation?.[axis]).filter((value) => typeof value === "number");
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    min,
    max,
    range: max - min,
  };
}

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

await page.addInitScript(() => {
  window.localStorage.setItem(
    "mmd_companion_session_v1",
    JSON.stringify({ userId: "playwright-user", renderPipeline: "classic" }),
  );
});

await page.goto(`${baseUrl}/companion`, { waitUntil: "networkidle" });
await page.waitForTimeout(5000);

const baseline = await sampleRuntime(page);
if (!baseline.ready) {
  console.log(JSON.stringify(baseline, null, 2));
  await browser.close();
  process.exit(1);
}

const samples = [];
for (let index = 0; index < 8; index += 1) {
  samples.push(await sampleRuntime(page));
  await sleep(500);
}

const summary = {
  status: baseline.status,
  currentClip: baseline.currentClip,
  sampleBoneNames: baseline.sampleBoneNames,
  morphNames: baseline.morphNames,
  expressionMorphSlots: baseline.expressionMorphSlots,
  activeEmotion: baseline.activeEmotion,
  activeAction: baseline.activeAction,
  boneNames: Object.fromEntries(
    Object.entries(baseline.bones).map(([slot, bone]) => [slot, bone?.name || null]),
  ),
  upperBodyX: summarizeDeltas(samples, "upperBody", "x"),
  upperBodyZ: summarizeDeltas(samples, "upperBody", "z"),
  neckX: summarizeDeltas(samples, "neck", "x"),
  headX: summarizeDeltas(samples, "head", "x"),
  leftArmZ: summarizeDeltas(samples, "leftArm", "z"),
  rightArmZ: summarizeDeltas(samples, "rightArm", "z"),
};

console.log(JSON.stringify(summary, null, 2));

await browser.close();
