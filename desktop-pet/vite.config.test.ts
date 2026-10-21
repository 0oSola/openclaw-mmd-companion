import { resolve } from "node:path";

import { build, loadConfigFromFile, mergeConfig } from "vite";
import { describe, expect, it } from "vitest";

function normalizePath(value: string) {
  return value.replaceAll("\\", "/");
}

function collectReactPackageRoots(ids: Set<string>) {
  const roots = new Map<string, Set<string>>();
  for (const rawId of ids) {
    const id = rawId.replace(/^\u0000/, "").split("?", 1)[0];
    const match = id.match(/^(.*[\\\\/])node_modules[\\\\/](react-dom|react)(?:[\\\\/]|$)/);
    if (!match) continue;
    const packageName = match[2];
    const packageRoot = normalizePath(match[1] + "node_modules/" + packageName);
    const packageRoots = roots.get(packageName) ?? new Set<string>();
    packageRoots.add(packageRoot);
    roots.set(packageName, packageRoots);
  }
  return roots;
}

describe("desktop-pet Vite renderer dependency identity", () => {
  it("resolves React and ReactDOM from the desktop-pet package root", async () => {
    const loaded = await loadConfigFromFile(
      { command: "build", mode: "production" },
      resolve("vite.config.ts"),
      process.cwd(),
    );
    if (!loaded) throw new Error("Vite configuration could not be loaded");

    const moduleIds = new Set<string>();
    await build(
      mergeConfig(loaded.config, {
        logLevel: "error",
        plugins: [
          {
            name: "collect-react-package-roots",
            moduleParsed(moduleInfo) {
              if (/node_modules[\\\\/](?:react-dom|react)(?:[\\\\/]|$)/.test(moduleInfo.id)) {
                moduleIds.add(moduleInfo.id);
              }
            },
          },
        ],
        build: { write: false },
      }),
    );

    const roots = collectReactPackageRoots(moduleIds);
    const expectedRoots = new Map([
      ["react", new Set([normalizePath(resolve("node_modules/react"))])],
      ["react-dom", new Set([normalizePath(resolve("node_modules/react-dom"))])],
    ]);

    expect(roots).toEqual(expectedRoots);
  });
});
