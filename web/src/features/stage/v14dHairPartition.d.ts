/** v14dHairPartition.js 的类型声明（与实现同步维护）。 */

export declare const V14D_HAIR_TINT_LINEAR: readonly [number, number, number];

export type PmxMaterialFaceRange = {
  name: string;
  startIndex: number;
  indexCount: number;
};

export type HairUvGrid = {
  gridU: number;
  gridV: number;
  hairA: Uint32Array;
  hairB: Uint32Array;
};

export type LinearHairTexture = {
  width: number;
  height: number;
  linear: Float32Array;
};

export declare function srgbByteToLinear(c: number): number;
export declare function linearToSrgbByte(l: number): number;
export declare function v14dHairTargetDisplay(rgb: [number, number, number]): [number, number, number];
export declare function sampleHairTextureLinear(texture: LinearHairTexture, u: number, v: number): [number, number, number];
export declare function v14dHairTargetDisplayFromLinear(linearRgb: readonly [number, number, number]): [number, number, number];
export declare function barycentricForTriangleUv(u: number, v: number, triangleUvs: ArrayLike<number>): [number, number, number] | null;
export declare function barycentricInside(values: readonly number[] | null, epsilon?: number): boolean;
export declare function buildHairUvGridFromPmx(
  pmx: ArrayBuffer,
  ranges: { hairA: PmxMaterialFaceRange; hairB: PmxMaterialFaceRange },
  gridU?: number,
  gridV?: number,
): HairUvGrid;
export declare function classifyHairPixel(
  grid: HairUvGrid,
  px: number,
  py: number,
  texW: number,
  texH: number,
): "hairA" | "hairB" | null;
