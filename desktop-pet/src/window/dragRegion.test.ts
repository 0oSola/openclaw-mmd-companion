import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop pet drag region css", () => {
  it("keeps DOM pointer events available in whole-window drag mode", () => {
    const css = readFileSync(path.resolve(__dirname, "../styles.css"), "utf8");

    expect(css).toMatch(
      /\.pet-shell\[data-interaction-mode="window-drag"\]\s*{[^}]*-webkit-app-region:\s*no-drag/s,
    );
    expect(css).toMatch(
      /\.pet-shell\[data-interaction-mode="window-drag"\]\s+canvas[^{]*{[^}]*-webkit-app-region:\s*no-drag/s,
    );
  });

  it("paints a real overlay hit surface above WebGL so transparent windows receive mouse input", () => {
    const css = readFileSync(path.resolve(__dirname, "../styles.css"), "utf8");
    const app = readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");

    expect(app).toContain('className="pet-input-hit-surface"');
    expect(css).toMatch(/\.pet-input-hit-surface\s*{[^}]*position:\s*fixed/s);
    expect(css).toMatch(/\.pet-input-hit-surface\s*{[^}]*z-index:\s*10/s);
    expect(css).toMatch(/\.pet-input-hit-surface\s*{[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.08\)/s);
  });

  it("keeps the MMD stage interactive in camera-adjust mode", () => {
    const css = readFileSync(path.resolve(__dirname, "../styles.css"), "utf8");

    expect(css).toMatch(/\.pet-shell\[data-interaction-mode="camera-adjust"\][^{]*{[^}]*-webkit-app-region:\s*no-drag/s);
  });

  it("includes visible click ripple styles for character action switching", () => {
    const css = readFileSync(path.resolve(__dirname, "../styles.css"), "utf8");

    expect(css).toMatch(/\.pet-stage \.mio-stage-click-ripple\s*{/);
    expect(css).toMatch(/animation:\s*mio-stage-click-ripple 720ms ease-out forwards/);
    expect(css).toMatch(/@keyframes mio-stage-click-ripple/);
  });

  it("keeps interactive Pet panels out of whole-window drag handling", () => {
    const css = readFileSync(path.resolve(__dirname, "../styles.css"), "utf8");
    const app = readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");

    expect(app).toContain('closest(".pet-panel, .pet-status-action")');
    expect(app).toContain('className="pet-panel pet-session-panel"');
    expect(app).toContain('className="pet-panel pet-prompt-panel"');
    expect(app).toContain('className="pet-status-action"');
    expect(css).toMatch(/\.pet-status-action\s*{[^}]*-webkit-app-region:\s*no-drag/s);
  });

  it("renders session details inside the non-drag More Sessions panel", () => {
    const css = readFileSync(path.resolve(__dirname, "../styles.css"), "utf8");
    const app = readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");

    expect(app).toContain("item.workspace");
    expect(app).toContain("item.status");
    expect(app).toContain("item.time");
    expect(app).toContain("item.promptPreview");
    expect(app).toContain("item.summaryPreview");
    expect(css).toMatch(/\.pet-session-detail-grid\s*{/);
    expect(css).toMatch(/\.pet-session-preview\s*{/);
    expect(css).toMatch(/\.pet-session-row\s*{[^}]*-webkit-app-region:\s*no-drag/s);
  });
});
