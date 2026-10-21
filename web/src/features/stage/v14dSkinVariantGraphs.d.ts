/** v14dSkinVariantGraphs.js 的类型声明（与实现同步维护）。 */

import type { Engine, ShaderGraph } from "reze-engine";

type RezeStyleGroup = ReturnType<Engine["getStyleGroups"]>[number];

export declare const V14D_FACE_V1_COMPOSITE_GRAPH: ShaderGraph;
export declare const V14D_BODY_V1_COMPOSITE_GRAPH: ShaderGraph;
export declare const V14D_BODY_LIVE_COMPOSITE_GRAPH: ShaderGraph;
export declare const V14D_HAIR_V1_COMPOSITE_GRAPH: ShaderGraph;
export declare const V14D_BROWS_LASHES_V1_COMPOSITE_GRAPH: ShaderGraph;

export declare function buildV14dSkinVariantStyleGroups(
  originalGroups: readonly RezeStyleGroup[],
): RezeStyleGroup[];

export type BadSkinGraphKind =
  | "wrongGraph"
  | "failCompile"
  | "missingHairA"
  | "missingHairB"
  | "wrongHairMaterial"
  | "wrongTint"
  | "missingBrows"
  | "missingLashes"
  | "swapBrowsLashes"
  | "wrongBrowsLashesTint"
  | "wrongBrowsLashesAlpha";

export declare function perturbV14dSkinVariantStyleGroups(
  groups: readonly RezeStyleGroup[],
  kind: BadSkinGraphKind,
): RezeStyleGroup[];

export type V14dSkinVariantBindingCounts = {
  faceDrawCalls: number;
  faceOnComposite: number;
  bodyDrawCalls: number;
  bodyOnComposite: number;
  hairADrawCalls: number;
  hairAOnComposite: number;
  hairBDrawCalls: number;
  hairBOnComposite: number;
  browsDrawCalls: number;
  browsOnComposite: number;
  lashesDrawCalls: number;
  lashesOnComposite: number;
};

export declare function collectV14dSkinVariantBindingCounts(
  engine: Engine | null,
): V14dSkinVariantBindingCounts;
