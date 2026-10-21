import data from "./characterArrivalGeometry.json";
import outline from "./characterArrivalOutline.json";

export type ArrivalView = {
  projection: number[]; view: number[]; model?: number[];
  viewport: { left: number; top: number; width: number; height: number };
};
export type ArrivalProjection = {
  key: string; points: Array<[number, number]>; mvp: Float32Array; normal: Float32Array;
  viewport: [number, number, number, number];
};
const bytes = (encoded: string) => Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
let decoded: ReturnType<typeof decode> | null = null;
function decode() {
  const packed = new Int16Array(bytes(data.positions).buffer), positions = new Float32Array(packed.length);
  for (let i = 0; i < packed.length; i++) positions[i] = data.center[i % 3] + packed[i] * data.step[i % 3];
  const normals = Float32Array.from(new Int8Array(bytes(data.normals).buffer), v => v / 127);
  return { positions, normals, indices: new Uint16Array(bytes(data.indices).buffer), samples: new Uint16Array(bytes(data.samples).buffer) };
}
export const arrivalGeometryMatches = data.modelSha256 === outline.modelSha256 && data.modelRelativePath === outline.modelRelativePath
  && data.motionSha256 === outline.motionSha256 && data.motionFilename === outline.motionFilename && data.frame === 0 && data.fps === 30;
export function getArrivalGeometry() { return decoded ||= decode(); }

const multiply = (a: number[], b: number[]) => Array.from({ length: 16 }, (_, index) => {
  const row = index % 4, column = Math.floor(index / 4);
  return a[row] * b[column * 4] + a[row + 4] * b[column * 4 + 1] + a[row + 8] * b[column * 4 + 2] + a[row + 12] * b[column * 4 + 3];
});
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function normalMatrix(matrix: number[]) {
  const a = matrix.slice(0, 3), b = matrix.slice(4, 7), c = matrix.slice(8, 11), bc = cross(b, c);
  const determinant = a.reduce((sum, value, i) => sum + value * bc[i], 0);
  return new Float32Array([...bc, ...cross(c, a), ...cross(a, b)].map(n => n / (determinant || 1)));
}

export function createArrivalProjection() {
  if (!arrivalGeometryMatches) return null;
  const geometry = getArrivalGeometry();
  let cached: ArrivalProjection | null = null;
  return (input: ArrivalView, box: { left: number; top: number; width: number; height: number }): ArrivalProjection => {
    const v = input.viewport;
    const key = [...input.projection, ...input.view, ...(input.model || data.modelMatrix), v.left - box.left, v.top - box.top, v.width, v.height, box.width, box.height].map(n => n.toFixed(6)).join(",");
    if (cached?.key === key) return cached;
    const mv = multiply(input.view, input.model || data.modelMatrix), e = multiply(input.projection, mv), points: Array<[number, number]> = [];
    for (const index of geometry.samples) {
      const x = geometry.positions[index * 3], y = geometry.positions[index * 3 + 1], z = geometry.positions[index * 3 + 2];
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      const depth = (e[2] * x + e[6] * y + e[10] * z + e[14]) / w;
      if (w <= 0 || depth < -1 || depth > 1) continue;
      const nx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
      const ny = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
      points.push([(v.left - box.left + (nx + 1) * .5 * v.width) / box.width, (v.top - box.top + (1 - ny) * .5 * v.height) / box.height]);
    }
    cached = { key, points, mvp: new Float32Array(e), normal: normalMatrix(mv),
      viewport: [v.width / box.width, v.height / box.height, (v.left - box.left + v.width / 2) / box.width * 2 - 1, 1 - (v.top - box.top + v.height / 2) / box.height * 2] };
    return cached;
  };
}
