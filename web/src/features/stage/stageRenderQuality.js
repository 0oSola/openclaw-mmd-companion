// 只控制3D绘制精度；动画时间、材质和CSS尺寸不参与调整。
export class StageRenderQuality {
  constructor(renderer) {
    this.renderer = renderer;
    this.baseRatio = renderer.getPixelRatio();
    this.mode = "auto";
    this.scale = 1;
    this.resetWindow();
  }

  resetWindow() { this.elapsed = 0; this.frames = 0; this.goodWindows = 0; }

  applyScale(scale) {
    if (this.scale === scale) return;
    this.scale = scale;
    this.renderer.setPixelRatio(this.baseRatio * scale);
  }

  setMode(mode) {
    if (!["auto", "full", "fluid"].includes(mode)) throw new Error("未知舞台绘制模式");
    this.mode = mode;
    this.resetWindow();
    this.applyScale(mode === "fluid" ? 0.7 : 1);
  }

  update(milliseconds, active) {
    if (this.mode !== "auto") return;
    if (!active || !Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 1000) {
      this.resetWindow();
      return;
    }
    this.elapsed += milliseconds;
    this.frames++;
    if (this.elapsed < 1800 || this.frames < 8) return;
    const mean = this.elapsed / this.frames;
    this.elapsed = 0; this.frames = 0;
    if (mean > 42) {
      this.goodWindows = 0;
      this.applyScale(Math.max(0.6, Math.round((this.scale - 0.15) * 100) / 100));
    } else if (mean < 22) {
      if (++this.goodWindows >= 3) {
        this.goodWindows = 0;
        this.applyScale(Math.min(1, Math.round((this.scale + 0.1) * 100) / 100));
      }
    } else this.goodWindows = 0;
  }
}
