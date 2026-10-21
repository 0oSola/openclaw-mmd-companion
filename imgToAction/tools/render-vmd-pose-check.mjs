#!/usr/bin/env node
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

const MAIN_EULA_MODEL_PATH =
  "MMD/\u4f18\u83c8_by_\u539f\u795e_339146e6e418d79e85a515b26414c0b0/\u4f18\u83c8.pmx";
const FALLBACK_EULA_MODEL_PATH = "imgToAction/assets/pmx/\u4f18\u83c8.pmx";
const DEFAULT_VMD_PATH = "imgToAction/outputs/vmd/eula_thinking_chin_edge_bvh_fit02.vmd";
const DEFAULT_PROFILE_PATH = "imgToAction/config/model_profile.eula.json";

const MIME_TYPES = {
  ".bmp": "image/bmp",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".pmx": "application/octet-stream",
  ".pmd": "application/octet-stream",
  ".tga": "application/octet-stream",
  ".vmd": "application/octet-stream",
};

export function parseFrameList(value) {
  const frames = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const frame = Number.parseInt(item, 10);
      if (!Number.isFinite(frame) || `${frame}` !== item || frame < 0) {
        throw new Error(`Invalid frame: ${item}`);
      }
      return frame;
    });
  if (!frames.length) throw new Error("At least one frame is required");
  return frames;
}

export function parseCameraSnapshot(value) {
  if (!value) return null;
  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch (error) {
    throw new Error(`Invalid camera JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const position = parsed?.position;
  const target = parsed?.target;
  if (!Array.isArray(position) || position.length !== 3) {
    throw new Error("Invalid camera JSON: position must be a 3-number array");
  }
  if (!Array.isArray(target) || target.length !== 3) {
    throw new Error("Invalid camera JSON: target must be a 3-number array");
  }
  const normalized = {
    fov: Number(parsed?.fov) || 33,
    position: position.map((item) => Number(item)),
    target: target.map((item) => Number(item)),
    locked: parsed?.locked !== false,
  };
  if (normalized.position.some((item) => !Number.isFinite(item))) {
    throw new Error("Invalid camera JSON: position must be a 3-number array");
  }
  if (normalized.target.some((item) => !Number.isFinite(item))) {
    throw new Error("Invalid camera JSON: target must be a 3-number array");
  }
  return normalized;
}

function normalizeOffset(value) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const offset = value.map((item) => Number(item));
  return offset.every(Number.isFinite) ? offset : null;
}

function normalizeOffsets(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => normalizeOffset(value)).filter(Boolean);
}

export function defaultBoneLandmarkRequests(modelProfile) {
  const contact = modelProfile?.contacts?.right_wrist_to_chin_edge || {};
  const chinRequest = { name: "chin", bones: [contact.target_bone || "\u982d"] };
  const renderTargetOffsets = normalizeOffsets(contact.render_target_offsets);
  const renderTargetOffset = normalizeOffset(contact.render_target_offset);
  if (renderTargetOffsets.length) {
    chinRequest.localOffsets = renderTargetOffsets;
    chinRequest.sampleMode = "nearest";
    chinRequest.source = "right_wrist_to_chin_edge.render_target_offsets";
  } else if (renderTargetOffset) {
    chinRequest.localOffset = renderTargetOffset;
    chinRequest.source = "right_wrist_to_chin_edge.render_target_offset";
  }
  return [
    { name: "right_wrist", bones: [contact.effector_bone || "\u53f3\u624b\u9996"] },
    chinRequest,
    { name: "left_wrist", bones: ["\u5de6\u624b\u9996"] },
    { name: "right_shoulder", bones: ["\u53f3\u80a9"] },
    { name: "right_elbow", bones: ["\u53f3\u3072\u3058"] },
    { name: "left_shoulder", bones: ["\u5de6\u80a9"] },
    { name: "left_elbow", bones: ["\u5de6\u3072\u3058"] },
    { name: "waist", bones: ["\u4e0b\u534a\u8eab", "\u30bb\u30f3\u30bf\u30fc"] },
    { name: "right_hip", bones: ["\u53f3\u8db3"] },
    { name: "right_knee", bones: ["\u53f3\u3072\u3056"] },
    { name: "right_ankle", bones: ["\u53f3\u8db3\u9996"] },
    { name: "left_hip", bones: ["\u5de6\u8db3"] },
    { name: "left_knee", bones: ["\u5de6\u3072\u3056"] },
    { name: "left_ankle", bones: ["\u5de6\u8db3\u9996"] },
    { name: "right_toe", bones: ["\u53f3\u3064\u307e\u5148"] },
    { name: "left_toe", bones: ["\u5de6\u3064\u307e\u5148"] },
    { name: "neck", bones: ["\u9996"] },
    { name: "head_front", bones: ["\u982d"], localOffset: [0, 0, 1.0] },
    { name: "head_back", bones: ["\u982d"], localOffset: [0, 0, -1.0] },
    { name: "head_top", bones: ["\u982d"], localOffset: [0, 1.0, 0] },
    { name: "upper_body", bones: ["\u4e0a\u534a\u8eab"] },
    { name: "upper_body2", bones: ["\u4e0a\u534a\u8eab2"] },
    { name: "center", bones: ["\u30bb\u30f3\u30bf\u30fc"] },
  ];
}

function roundMetric(value) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(3));
}

function projectedPoint(value) {
  if (!value) return null;
  const point = value.projected || value;
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, z: Number(point.z) };
}

function projectedSamples(landmark) {
  if (!landmark) return [];
  const samples = Array.isArray(landmark.samples) && landmark.samples.length ? landmark.samples : [landmark];
  return samples
    .map((sample, index) => ({ sample, index, point: projectedPoint(sample) }))
    .filter((entry) => entry.point);
}

export function nearestProjectedSampleDistance(sourceLandmark, targetLandmark) {
  const sourceSamples = projectedSamples(sourceLandmark);
  const targetSamples = projectedSamples(targetLandmark);
  let best = null;
  for (const sourceEntry of sourceSamples) {
    for (const targetEntry of targetSamples) {
      const distance = Math.hypot(sourceEntry.point.x - targetEntry.point.x, sourceEntry.point.y - targetEntry.point.y);
      if (!best || distance < best.distance) {
        best = {
          distance,
          sourceSampleIndex: sourceEntry.index,
          targetSampleIndex: targetEntry.index,
          sourceSample: sourceEntry.sample,
          targetSample: targetEntry.sample,
        };
      }
    }
  }
  return best;
}

function worldPoint(value) {
  if (!value) return null;
  const point = value.world || value;
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

function worldSamples(landmark) {
  if (!landmark) return [];
  const samples = Array.isArray(landmark.samples) && landmark.samples.length ? landmark.samples : [landmark];
  return samples
    .map((sample, index) => ({ sample, index, point: worldPoint(sample) }))
    .filter((entry) => entry.point);
}

function nearestWorldSampleDistance(sourceLandmark, targetLandmark) {
  const sourceSamples = worldSamples(sourceLandmark);
  const targetSamples = worldSamples(targetLandmark);
  let best = null;
  for (const sourceEntry of sourceSamples) {
    for (const targetEntry of targetSamples) {
      const distance = Math.hypot(
        sourceEntry.point.x - targetEntry.point.x,
        sourceEntry.point.y - targetEntry.point.y,
        sourceEntry.point.z - targetEntry.point.z,
      );
      if (!best || distance < best.distance) {
        best = {
          distance,
          sourceSampleIndex: sourceEntry.index,
          targetSampleIndex: targetEntry.index,
          sourceSample: sourceEntry.sample,
          targetSample: targetEntry.sample,
        };
      }
    }
  }
  return best;
}

function firstWorldSamplePoint(landmark) {
  return worldSamples(landmark)[0]?.point ?? null;
}

function midpoint(left, right) {
  if (!left || !right) return null;
  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
    z: (left.z + right.z) / 2,
  };
}

function pointToSegmentDistance(point, start, end) {
  if (!point || !start || !end) return null;
  const segment = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
  const offset = { x: point.x - start.x, y: point.y - start.y, z: point.z - start.z };
  const lengthSquared = segment.x ** 2 + segment.y ** 2 + segment.z ** 2;
  if (lengthSquared <= 1e-9) return Math.hypot(offset.x, offset.y, offset.z);
  const t = Math.max(0, Math.min(1, (offset.x * segment.x + offset.y * segment.y + offset.z * segment.z) / lengthSquared));
  const closest = {
    x: start.x + segment.x * t,
    y: start.y + segment.y * t,
    z: start.z + segment.z * t,
  };
  return Math.hypot(point.x - closest.x, point.y - closest.y, point.z - closest.z);
}

function pointDistance(left, right) {
  if (!left || !right) return null;
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function dotProduct(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function crossProduct(left, right) {
  if (!left || !right) return null;
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function normalizeVector(vector) {
  if (!vector) return null;
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length <= 1e-9) return null;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function vectorBetween(start, end) {
  if (!start || !end) return null;
  return { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
}

function addScaledVector(start, direction, scale) {
  return {
    x: start.x + direction.x * scale,
    y: start.y + direction.y * scale,
    z: start.z + direction.z * scale,
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function segmentToSegmentDistance(firstStart, firstEnd, secondStart, secondEnd) {
  if (!firstStart || !firstEnd || !secondStart || !secondEnd) return null;
  const firstDirection = vectorBetween(firstStart, firstEnd);
  const secondDirection = vectorBetween(secondStart, secondEnd);
  const offset = vectorBetween(secondStart, firstStart);
  const firstLengthSquared = dotProduct(firstDirection, firstDirection);
  const secondLengthSquared = dotProduct(secondDirection, secondDirection);
  if (firstLengthSquared <= 1e-9 && secondLengthSquared <= 1e-9) return pointDistance(firstStart, secondStart);
  if (firstLengthSquared <= 1e-9) return pointToSegmentDistance(firstStart, secondStart, secondEnd);
  if (secondLengthSquared <= 1e-9) return pointToSegmentDistance(secondStart, firstStart, firstEnd);

  const firstSecondDot = dotProduct(firstDirection, secondDirection);
  const firstOffsetDot = dotProduct(firstDirection, offset);
  const secondOffsetDot = dotProduct(secondDirection, offset);
  const denominator = firstLengthSquared * secondLengthSquared - firstSecondDot ** 2;
  let firstScale =
    Math.abs(denominator) > 1e-9
      ? clamp01((firstSecondDot * secondOffsetDot - firstOffsetDot * secondLengthSquared) / denominator)
      : 0;
  let secondScale = (firstSecondDot * firstScale + secondOffsetDot) / secondLengthSquared;

  if (secondScale < 0) {
    secondScale = 0;
    firstScale = clamp01(-firstOffsetDot / firstLengthSquared);
  } else if (secondScale > 1) {
    secondScale = 1;
    firstScale = clamp01((firstSecondDot - firstOffsetDot) / firstLengthSquared);
  }

  return pointDistance(
    addScaledVector(firstStart, firstDirection, firstScale),
    addScaledVector(secondStart, secondDirection, secondScale),
  );
}

function vectorAngleDegrees(left, right) {
  if (!left || !right) return null;
  const leftLength = Math.hypot(left.x, left.y, left.z);
  const rightLength = Math.hypot(right.x, right.y, right.z);
  if (leftLength <= 1e-9 || rightLength <= 1e-9) return null;
  const dot = left.x * right.x + left.y * right.y + left.z * right.z;
  const cosine = Math.max(-1, Math.min(1, dot / (leftLength * rightLength)));
  return (Math.acos(cosine) * 180) / Math.PI;
}

function computeTorsoCoreClearance(samples) {
  const rightShoulder = firstWorldSamplePoint(samples?.right_shoulder);
  const leftShoulder = firstWorldSamplePoint(samples?.left_shoulder);
  const rightElbow = firstWorldSamplePoint(samples?.right_elbow);
  const rightWrist = firstWorldSamplePoint(samples?.right_wrist);
  const leftElbow = firstWorldSamplePoint(samples?.left_elbow);
  const leftWrist = firstWorldSamplePoint(samples?.left_wrist);
  const upperTorso = midpoint(rightShoulder, leftShoulder);
  const lowerTorso = firstWorldSamplePoint(samples?.waist);
  if (!upperTorso || !lowerTorso) return {};
  const clearances = {};
  const points = {
    right_elbow: rightElbow,
    right_wrist: rightWrist,
    left_elbow: leftElbow,
    left_wrist: leftWrist,
  };
  for (const [pointName, point] of Object.entries(points)) {
    const distance = pointToSegmentDistance(point, upperTorso, lowerTorso);
    if (Number.isFinite(distance)) {
      clearances[`${pointName}_to_torso_core_world`] = distance;
    }
  }
  const segments = {
    right_upper_arm: [rightShoulder, rightElbow],
    right_forearm: [rightElbow, rightWrist],
    left_upper_arm: [leftShoulder, leftElbow],
    left_forearm: [leftElbow, leftWrist],
  };
  for (const [segmentName, [start, end]] of Object.entries(segments)) {
    const distance = segmentToSegmentDistance(start, end, upperTorso, lowerTorso);
    if (Number.isFinite(distance)) {
      clearances[`${segmentName}_to_torso_core_world`] = distance;
    }
  }
  return clearances;
}

function computeLimbSegmentLengths(samples) {
  const rightShoulder = firstWorldSamplePoint(samples?.right_shoulder);
  const rightElbow = firstWorldSamplePoint(samples?.right_elbow);
  const rightWrist = firstWorldSamplePoint(samples?.right_wrist);
  const leftShoulder = firstWorldSamplePoint(samples?.left_shoulder);
  const leftElbow = firstWorldSamplePoint(samples?.left_elbow);
  const leftWrist = firstWorldSamplePoint(samples?.left_wrist);
  return {
    right_upper_arm_world: pointDistance(rightShoulder, rightElbow),
    right_forearm_world: pointDistance(rightElbow, rightWrist),
    left_upper_arm_world: pointDistance(leftShoulder, leftElbow),
    left_forearm_world: pointDistance(leftElbow, leftWrist),
  };
}

function computeStanceMetrics(samples) {
  const rightAnkle = firstWorldSamplePoint(samples?.right_ankle);
  const leftAnkle = firstWorldSamplePoint(samples?.left_ankle);
  return {
    right_ankle_world: rightAnkle,
    left_ankle_world: leftAnkle,
    ankle_midpoint_world: midpoint(rightAnkle, leftAnkle),
    ankle_span_world: pointDistance(rightAnkle, leftAnkle),
  };
}

function computeThinkingHandPathMetrics(samples) {
  const rightWrist = firstWorldSamplePoint(samples?.right_wrist);
  const rightElbow = firstWorldSamplePoint(samples?.right_elbow);
  const rightShoulder = firstWorldSamplePoint(samples?.right_shoulder);
  const leftShoulder = firstWorldSamplePoint(samples?.left_shoulder);
  const lowerTorso = firstWorldSamplePoint(samples?.waist);
  const chin = firstWorldSamplePoint(samples?.chin);
  const upperTorso = midpoint(rightShoulder, leftShoulder);
  if (!rightWrist || !upperTorso || !chin) return {};

  let frontAxis = null;
  const shoulderAxis = normalizeVector(vectorBetween(leftShoulder, rightShoulder));
  const upAxis = normalizeVector(vectorBetween(lowerTorso, upperTorso));
  const bodyFrontAxis = normalizeVector(crossProduct(shoulderAxis, upAxis));
  if (bodyFrontAxis) {
    const chinDirection = vectorBetween(upperTorso, chin);
    frontAxis = dotProduct(chinDirection, bodyFrontAxis) < 0 ? { x: -bodyFrontAxis.x, y: -bodyFrontAxis.y, z: -bodyFrontAxis.z } : bodyFrontAxis;
  }
  if (!frontAxis) {
    const front = { x: chin.x - upperTorso.x, y: 0, z: chin.z - upperTorso.z };
    const frontLength = Math.hypot(front.x, front.z);
    if (frontLength <= 1e-8) return {};
    frontAxis = { x: front.x / frontLength, y: 0, z: front.z / frontLength };
  }

  const signedDepth = (point) => {
    if (!point) return null;
    return dotProduct(vectorBetween(upperTorso, point), frontAxis);
  };
  const rightForearmMid = midpoint(rightElbow, rightWrist);
  const metrics = {
    right_wrist_front_offset_world: signedDepth(rightWrist),
    right_elbow_front_offset_world: signedDepth(rightElbow),
    right_forearm_mid_front_offset_world: signedDepth(rightForearmMid),
    front_axis_world: frontAxis,
  };
  return Object.fromEntries(Object.entries(metrics).filter(([, value]) => value !== null));
}

function computeHeadOrientation(samples) {
  const headFront = firstWorldSamplePoint(samples?.head_front);
  const headBack = firstWorldSamplePoint(samples?.head_back);
  const headTop = firstWorldSamplePoint(samples?.head_top);
  if (!headFront || !headBack) return {};
  const fwd = { x: headFront.x - headBack.x, y: headFront.y - headBack.y, z: headFront.z - headBack.z };
  const len = Math.hypot(fwd.x, fwd.y, fwd.z) || 1;
  fwd.x /= len; fwd.y /= len; fwd.z /= len;
  const pitch = Math.asin(Math.max(-1, Math.min(1, fwd.y))) * 180 / Math.PI;
  const yaw = Math.atan2(fwd.x, fwd.z) * 180 / Math.PI;
  return {
    head_pitch_degrees: pitch,
    head_yaw_degrees: yaw,
  };
}

function computeAnkleOrientation(samples) {
  const rightAnkle = firstWorldSamplePoint(samples?.right_ankle);
  const rightToe = firstWorldSamplePoint(samples?.right_toe);
  const leftAnkle = firstWorldSamplePoint(samples?.left_ankle);
  const leftToe = firstWorldSamplePoint(samples?.left_toe);
  if (!rightAnkle || !rightToe) return {};
  const rToeDir = { x: rightToe.x - rightAnkle.x, y: rightToe.y - rightAnkle.y, z: rightToe.z - rightAnkle.z };
  const rLen = Math.hypot(rToeDir.x, rToeDir.y, rToeDir.z) || 1;
  rToeDir.x /= rLen; rToeDir.y /= rLen; rToeDir.z /= rLen;
  const rPitch = Math.asin(Math.max(-1, Math.min(1, rToeDir.y))) * 180 / Math.PI;
  const rYaw = Math.atan2(rToeDir.x, rToeDir.z) * 180 / Math.PI;
  let lPitch = null, lYaw = null;
  if (leftAnkle && leftToe) {
    const lToeDir = { x: leftToe.x - leftAnkle.x, y: leftToe.y - leftAnkle.y, z: leftToe.z - leftAnkle.z };
    const lLen = Math.hypot(lToeDir.x, lToeDir.y, lToeDir.z) || 1;
    lToeDir.x /= lLen; lToeDir.y /= lLen; lToeDir.z /= lLen;
    lPitch = Math.asin(Math.max(-1, Math.min(1, lToeDir.y))) * 180 / Math.PI;
    lYaw = Math.atan2(lToeDir.x, lToeDir.z) * 180 / Math.PI;
  }
  return {
    right_foot_pitch_degrees: rPitch,
    right_foot_yaw_degrees: rYaw,
    left_foot_pitch_degrees: lPitch,
    left_foot_yaw_degrees: lYaw,
  };
}

function computeTorsoOrientation(samples) {
  const waist = firstWorldSamplePoint(samples?.waist);
  const neck = firstWorldSamplePoint(samples?.neck);
  const upperBody = firstWorldSamplePoint(samples?.upper_body);
  if (!waist || !neck) return {};
  const torsoDir = { x: neck.x - waist.x, y: neck.y - waist.y, z: neck.z - waist.z };
  const len = Math.hypot(torsoDir.x, torsoDir.y, torsoDir.z) || 1;
  torsoDir.x /= len; torsoDir.y /= len; torsoDir.z /= len;
  const lean = Math.asin(Math.max(-1, Math.min(1, torsoDir.y))) * 180 / Math.PI;
  const yaw = Math.atan2(torsoDir.x, torsoDir.z) * 180 / Math.PI;
  return {
    torso_lean_degrees: lean,
    torso_yaw_degrees: yaw,
  };
}

function computeShoulderAngles(samples) {
  const rightShoulder = firstWorldSamplePoint(samples?.right_shoulder);
  const leftShoulder = firstWorldSamplePoint(samples?.left_shoulder);
  const rightElbow = firstWorldSamplePoint(samples?.right_elbow);
  const leftElbow = firstWorldSamplePoint(samples?.left_elbow);
  const lowerTorso = firstWorldSamplePoint(samples?.waist);
  const upperTorso = midpoint(rightShoulder, leftShoulder);
  const torsoDown = vectorBetween(upperTorso, lowerTorso);
  return {
    right_upper_arm_to_torso_degrees: vectorAngleDegrees(vectorBetween(rightShoulder, rightElbow), torsoDown),
    left_upper_arm_to_torso_degrees: vectorAngleDegrees(vectorBetween(leftShoulder, leftElbow), torsoDown),
  };
}

function stats(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) {
    return { count: 0, min: null, max: null, avg: null };
  }
  return {
    count: finite.length,
    min: roundMetric(Math.min(...finite)),
    max: roundMetric(Math.max(...finite)),
    avg: roundMetric(finite.reduce((sum, value) => sum + value, 0) / finite.length),
  };
}

function metricSummary(rows, field, holdStartFrame) {
  const all = stats(rows.map((row) => Number(row[field])));
  const finalHoldRows = rows.filter((row) => Number(row.frame) >= holdStartFrame);
  const finalHold = stats(finalHoldRows.map((row) => Number(row[field])));
  return {
    ...all,
    final_hold_count: finalHold.count,
    final_hold_min: finalHold.min,
    final_hold_max: finalHold.max,
    final_hold_avg: finalHold.avg,
  };
}

function evaluateContactHoldStability(rows, options) {
  const holdStartFrame = Number(options.holdStartFrame);
  const contactPassPixels = Number(options.contactPassPixels);
  const stabilityStartFrame = finiteNumber(options.contactStabilityStartFrame) ?? holdStartFrame;
  const maxDriftPixels =
    finiteNumber(options.contactHoldMaxDriftPixels) ?? Math.max(15, Math.min(32, contactPassPixels * 0.35));
  const contactRows = rows
    .map((row) => ({ frame: Number(row.frame), distance: finiteNumber(row.right_wrist_to_chin_screen) }))
    .filter(
      (row) =>
        Number.isFinite(row.frame) &&
        row.frame >= stabilityStartFrame &&
        row.distance !== null &&
        row.distance <= contactPassPixels,
    )
    .sort((left, right) => left.frame - right.frame);
  if (contactRows.length < 2) {
    return {
      ok: true,
      violations: [],
      contact_hold_sample_count: contactRows.length,
      contact_hold_max_drift_pixels: 0,
    };
  }
  const distances = contactRows.map((row) => row.distance);
  const drift = Math.max(...distances) - Math.min(...distances);
  if (drift <= maxDriftPixels) {
    return {
      ok: true,
      violations: [],
      contact_hold_sample_count: contactRows.length,
      contact_hold_max_drift_pixels: roundMetric(drift),
    };
  }
  return {
    ok: false,
    violations: [
      {
        code: "right_wrist_contact_hold_unstable",
        severity: "blocking",
        frame: contactRows.at(-1)?.frame,
        detail: "right wrist contact drifts too much after the thinking hand has reached the chin",
        contact_hold_sample_count: contactRows.length,
        contact_hold_start_frame: roundMetric(stabilityStartFrame),
        contact_hold_max_drift_pixels: roundMetric(drift),
        max_allowed_contact_hold_drift_pixels: roundMetric(maxDriftPixels),
      },
    ],
    contact_hold_sample_count: contactRows.length,
    contact_hold_max_drift_pixels: roundMetric(drift),
  };
}

function evaluateContactHoldPoseStability(rows, options) {
  const holdStartFrame = Number(options.holdStartFrame);
  const contactPassPixels = Number(options.contactPassPixels);
  const stabilityStartFrame = finiteNumber(options.contactStabilityStartFrame) ?? holdStartFrame;
  const maxJointAngleDriftDegrees = finiteNumber(options.contactHoldMaxJointAngleDriftDegrees) ?? 45;
  const contactRows = rows
    .filter((row) => {
      const frame = Number(row.frame);
      const distance = finiteNumber(row.right_wrist_to_chin_screen);
      return Number.isFinite(frame) && frame >= stabilityStartFrame && distance !== null && distance <= contactPassPixels;
    })
    .sort((left, right) => Number(left.frame) - Number(right.frame));
  const angleFields = [
    { source: "joint_angles", field: "right_elbow_degrees", code: "right_elbow" },
    { source: "joint_angles", field: "left_elbow_degrees", code: "left_elbow" },
    { source: "shoulder_angles", field: "right_upper_arm_to_torso_degrees", code: "right_shoulder" },
    { source: "shoulder_angles", field: "left_upper_arm_to_torso_degrees", code: "left_shoulder" },
  ];
  const violations = [];
  let maxObservedDrift = 0;

  for (const spec of angleFields) {
    const values = contactRows
      .map((row) => ({
        frame: Number(row.frame),
        angle: finiteNumber(row[spec.source]?.[spec.field]),
      }))
      .filter((entry) => entry.angle !== null);
    if (values.length < 2) continue;
    const angles = values.map((entry) => entry.angle);
    const minAngle = Math.min(...angles);
    const maxAngle = Math.max(...angles);
    const drift = maxAngle - minAngle;
    maxObservedDrift = Math.max(maxObservedDrift, drift);
    if (drift > maxJointAngleDriftDegrees) {
      const minEntry = values.find((entry) => entry.angle === minAngle);
      const maxEntry = values.find((entry) => entry.angle === maxAngle);
      violations.push({
        code: `${spec.code}_contact_pose_drift`,
        severity: "blocking",
        frame: values.at(-1)?.frame,
        detail: `${spec.code} angle drifts too much while the right wrist is holding chin contact`,
        contact_hold_start_frame: roundMetric(stabilityStartFrame),
        min_angle_degrees: roundMetric(minAngle),
        min_angle_frame: minEntry?.frame,
        max_angle_degrees: roundMetric(maxAngle),
        max_angle_frame: maxEntry?.frame,
        angle_drift_degrees: roundMetric(drift),
        max_allowed_angle_drift_degrees: roundMetric(maxJointAngleDriftDegrees),
      });
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    contact_hold_pose_sample_count: contactRows.length,
    contact_hold_max_joint_angle_drift_degrees: roundMetric(maxObservedDrift),
  };
}

function evaluateThinkingHandApproachPhase(rows, options) {
  const contactPassPixels = Number(options.contactPassPixels);
  const approachStartPixels =
    finiteNumber(options.thinkingHandApproachStartPixels) ?? Math.max(contactPassPixels * 2, contactPassPixels + 60);
  const maxRegressionPixels =
    finiteNumber(options.thinkingHandMaxRegressionPixels) ?? Math.max(45, contactPassPixels * 0.7);
  const sortedRows = [...rows]
    .map((row) => ({ frame: Number(row.frame), distance: finiteNumber(row.right_wrist_to_chin_screen) }))
    .filter((row) => Number.isFinite(row.frame) && row.distance !== null)
    .sort((left, right) => left.frame - right.frame);
  const violations = [];
  let approachStarted = false;
  let bestDistance = Infinity;
  let bestFrame = null;

  for (const row of sortedRows) {
    if (!approachStarted) {
      if (row.distance > approachStartPixels) continue;
      approachStarted = true;
      bestDistance = row.distance;
      bestFrame = row.frame;
      continue;
    }
    if (row.distance < bestDistance) {
      bestDistance = row.distance;
      bestFrame = row.frame;
      continue;
    }
    const regression = row.distance - bestDistance;
    if (regression > maxRegressionPixels) {
      violations.push({
        code: "thinking_hand_approach_regressed",
        severity: "blocking",
        frame: row.frame,
        previous_best_frame: bestFrame,
        detail: "right thinking hand moves away after approaching the chin target",
        right_wrist_to_chin_screen: roundMetric(row.distance),
        previous_best_right_wrist_to_chin_screen: roundMetric(bestDistance),
        regression_pixels: roundMetric(regression),
        max_regression_pixels: roundMetric(maxRegressionPixels),
        approach_start_pixels: roundMetric(approachStartPixels),
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

function evaluateThinkingHandRaisePhase(rows, options) {
  const contactPassPixels = Number(options.contactPassPixels);
  const raiseStartPixels =
    finiteNumber(options.thinkingHandRaiseStartPixels) ?? Math.max(contactPassPixels * 3, contactPassPixels + 140);
  const approachStartPixels =
    finiteNumber(options.thinkingHandApproachStartPixels) ?? Math.max(contactPassPixels * 2, contactPassPixels + 60);
  const minFrontOffsetWorld = finiteNumber(options.thinkingHandMinFrontOffsetWorld) ?? 0;
  const sortedRows = [...rows]
    .filter((row) => Number.isFinite(Number(row.frame)))
    .sort((left, right) => Number(left.frame) - Number(right.frame));
  let worst = null;

  for (const row of sortedRows) {
    const rightWristToChin = finiteNumber(row.right_wrist_to_chin_screen);
    const frontOffset = finiteNumber(row.thinking_hand_path?.right_wrist_front_offset_world);
    if (rightWristToChin === null || frontOffset === null) continue;
    if (rightWristToChin > raiseStartPixels || rightWristToChin <= approachStartPixels) continue;
    if (frontOffset < minFrontOffsetWorld && (!worst || frontOffset < worst.frontOffset)) {
      worst = {
        frame: Number(row.frame),
        frontOffset,
        rightWristToChin,
      };
    }
  }

  if (!worst) return { ok: true, violations: [] };
  return {
    ok: false,
    violations: [
      {
        code: "thinking_hand_raise_behind_torso",
        severity: "blocking",
        frame: worst.frame,
        detail: "right thinking hand raise phase passes along the torso back side before entering the approach corridor",
        right_wrist_front_offset_world: roundMetric(worst.frontOffset),
        min_right_wrist_front_offset_world: roundMetric(minFrontOffsetWorld),
        right_wrist_to_chin_screen: roundMetric(worst.rightWristToChin),
        raise_start_pixels: roundMetric(raiseStartPixels),
        approach_start_pixels: roundMetric(approachStartPixels),
      },
    ],
  };
}

function evaluateThinkingHandFrontPath(rows, options) {
  const contactPassPixels = Number(options.contactPassPixels);
  const approachStartPixels =
    finiteNumber(options.thinkingHandApproachStartPixels) ?? Math.max(contactPassPixels * 2, contactPassPixels + 60);
  const minFrontOffsetWorld = finiteNumber(options.thinkingHandMinFrontOffsetWorld) ?? 0;
  const sortedRows = [...rows]
    .filter((row) => Number.isFinite(Number(row.frame)))
    .sort((left, right) => Number(left.frame) - Number(right.frame));
  let worst = null;

  for (const row of sortedRows) {
    const rightWristToChin = finiteNumber(row.right_wrist_to_chin_screen);
    const frontOffset = finiteNumber(row.thinking_hand_path?.right_wrist_front_offset_world);
    if (rightWristToChin === null || frontOffset === null) continue;
    if (rightWristToChin > approachStartPixels) continue;
    if (frontOffset < minFrontOffsetWorld && (!worst || frontOffset < worst.frontOffset)) {
      worst = {
        frame: Number(row.frame),
        frontOffset,
        rightWristToChin,
      };
    }
  }

  if (!worst) return { ok: true, violations: [] };
  return {
    ok: false,
    violations: [
      {
        code: "thinking_hand_behind_torso",
        severity: "blocking",
        frame: worst.frame,
        detail: "right thinking hand passes behind the torso after the approach phase has started",
        right_wrist_front_offset_world: roundMetric(worst.frontOffset),
        min_right_wrist_front_offset_world: roundMetric(minFrontOffsetWorld),
        right_wrist_to_chin_screen: roundMetric(worst.rightWristToChin),
        approach_start_pixels: roundMetric(approachStartPixels),
      },
    ],
  };
}

function evaluateThinkingHandChainFrontPath(rows, options) {
  const contactPassPixels = Number(options.contactPassPixels);
  const approachStartPixels =
    finiteNumber(options.thinkingHandApproachStartPixels) ?? Math.max(contactPassPixels * 2, contactPassPixels + 60);
  const minFrontOffsetWorld = finiteNumber(options.thinkingHandMinFrontOffsetWorld) ?? 0;
  const trackedPoints = [
    { field: "right_elbow_front_offset_world", code: "right_elbow_behind_torso", label: "right elbow" },
    {
      field: "right_forearm_mid_front_offset_world",
      code: "right_forearm_mid_behind_torso",
      label: "right forearm midpoint",
    },
  ];
  const sortedRows = [...rows]
    .filter((row) => Number.isFinite(Number(row.frame)))
    .sort((left, right) => Number(left.frame) - Number(right.frame));
  let worst = null;

  for (const row of sortedRows) {
    const rightWristToChin = finiteNumber(row.right_wrist_to_chin_screen);
    if (rightWristToChin === null || rightWristToChin > approachStartPixels) continue;
    for (const tracked of trackedPoints) {
      const frontOffset = finiteNumber(row.thinking_hand_path?.[tracked.field]);
      if (frontOffset === null) continue;
      if (frontOffset < minFrontOffsetWorld && (!worst || frontOffset < worst.frontOffset)) {
        worst = {
          frame: Number(row.frame),
          frontOffset,
          rightWristToChin,
          ...tracked,
        };
      }
    }
  }

  if (!worst) return { ok: true, violations: [] };
  return {
    ok: false,
    violations: [
      {
        code: worst.code,
        severity: "blocking",
        frame: worst.frame,
        detail: `${worst.label} is behind the torso body plane after the thinking hand enters the chin approach region`,
        front_offset_world: roundMetric(worst.frontOffset),
        min_front_offset_world: roundMetric(minFrontOffsetWorld),
        right_wrist_to_chin_screen: roundMetric(worst.rightWristToChin),
        approach_start_pixels: roundMetric(approachStartPixels),
      },
    ],
  };
}

function evaluateThinkingHandHoldEntry(rows, options) {
  const holdStartFrame = Number(options.holdStartFrame);
  const contactPassPixels = Number(options.contactPassPixels);
  const holdEntryPixels = finiteNumber(options.thinkingHandHoldEntryPixels) ?? contactPassPixels;
  const holdMaxRegressionPixels = finiteNumber(options.thinkingHandHoldMaxRegressionPixels) ?? Math.max(12, contactPassPixels * 0.25);
  const sortedRows = [...rows]
    .map((row) => ({ frame: Number(row.frame), distance: finiteNumber(row.right_wrist_to_chin_screen) }))
    .filter((row) => Number.isFinite(row.frame) && row.distance !== null)
    .sort((left, right) => left.frame - right.frame);
  const holdRows = sortedRows.filter((row) => row.frame >= holdStartFrame);
  if (!holdRows.length) return { ok: true, violations: [] };

  const firstHold = holdRows[0];
  if (firstHold.distance > holdEntryPixels) {
    return {
      ok: false,
      violations: [
        {
          code: "thinking_hand_hold_started_too_early",
          severity: "blocking",
          frame: firstHold.frame,
          detail: "final thinking hold starts before the right hand has entered the chin-contact corridor",
          right_wrist_to_chin_screen: roundMetric(firstHold.distance),
          hold_entry_pixels: roundMetric(holdEntryPixels),
        },
      ],
    };
  }

  const bestHoldDistance = Math.min(...holdRows.map((row) => row.distance));
  const regression = firstHold.distance - bestHoldDistance;
  if (regression > holdMaxRegressionPixels) {
    return {
      ok: false,
      violations: [
        {
          code: "thinking_hand_hold_started_too_early",
          severity: "blocking",
          frame: firstHold.frame,
          detail: "final thinking hold starts before the right hand has settled into the chin-contact corridor",
          right_wrist_to_chin_screen: roundMetric(firstHold.distance),
          best_hold_right_wrist_to_chin_screen: roundMetric(bestHoldDistance),
          hold_regression_pixels: roundMetric(regression),
          hold_max_regression_pixels: roundMetric(holdMaxRegressionPixels),
        },
      ],
    };
  }

  return { ok: true, violations: [] };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function evaluateSupportArmPhase(rows, options) {
  const holdStartFrame = Number(options.holdStartFrame);
  const contactPassPixels = Number(options.contactPassPixels);
  const thinkingHandIncompletePixels =
    finiteNumber(options.thinkingHandIncompletePixels) ?? Math.max(contactPassPixels * 2, contactPassPixels + 60);
  const prematureSupportPixels = finiteNumber(options.prematureSupportPixels) ?? 120;
  const prematureSupportWorldDistance = finiteNumber(options.prematureSupportWorldDistance) ?? 1.4;
  const violations = [];

  for (const row of rows) {
    const frame = Number(row.frame);
    if (!Number.isFinite(frame) || frame <= 0 || frame >= holdStartFrame) continue;
    const rightWristToChin = finiteNumber(row.right_wrist_to_chin_screen);
    const leftWristToWaist = finiteNumber(row.left_wrist_to_waist_screen);
    const leftWristToWaistWorld = finiteNumber(row.left_wrist_to_waist_world);
    if (rightWristToChin === null || leftWristToWaist === null) continue;
    const supportArmLockedByProjection = leftWristToWaist < prematureSupportPixels;
    const supportArmLockedByWorld =
      leftWristToWaistWorld === null || leftWristToWaistWorld < prematureSupportWorldDistance;
    if (rightWristToChin > thinkingHandIncompletePixels && supportArmLockedByProjection && supportArmLockedByWorld) {
      violations.push({
        code: "support_arm_locked_before_thinking_hand",
        severity: "blocking",
        frame,
        detail: "left support arm is already locked near the waist while the right thinking hand is still far from the chin",
        right_wrist_to_chin_screen: roundMetric(rightWristToChin),
        left_wrist_to_waist_screen: roundMetric(leftWristToWaist),
        left_wrist_to_waist_world:
          leftWristToWaistWorld === null ? undefined : roundMetric(leftWristToWaistWorld),
        thinking_hand_incomplete_pixels: roundMetric(thinkingHandIncompletePixels),
        premature_support_pixels: roundMetric(prematureSupportPixels),
        premature_support_world_distance:
          leftWristToWaistWorld === null ? undefined : roundMetric(prematureSupportWorldDistance),
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

function evaluateElbowAngles(rows, options) {
  const min = finiteNumber(options.elbowAngleMinDegrees) ?? 20;
  const max = finiteNumber(options.elbowAngleMaxDegrees) ?? 172;
  const violations = [];

  for (const row of rows) {
    const angles = row.joint_angles || {};
    for (const side of ["right", "left"]) {
      const value = finiteNumber(angles[`${side}_elbow_degrees`]);
      if (value === null) continue;
      if (value < min || value > max) {
        violations.push({
          code: `${side}_elbow_angle_out_of_range`,
          severity: "blocking",
          frame: Number(row.frame),
          detail: `${side} elbow angle is outside the plausible human transition range`,
          angle_degrees: roundMetric(value),
          min_degrees: min,
          max_degrees: max,
        });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

function evaluateKneeAngles(rows, options) {
  const min = finiteNumber(options.kneeAngleMinDegrees) ?? 25;
  const max = finiteNumber(options.kneeAngleMaxDegrees) ?? 179.5;
  const violations = [];

  for (const row of rows) {
    const angles = row.joint_angles || {};
    for (const side of ["right", "left"]) {
      const value = finiteNumber(angles[`${side}_knee_degrees`]);
      if (value === null) continue;
      if (value < min || value > max) {
        violations.push({
          code: `${side}_knee_angle_out_of_range`,
          severity: "blocking",
          frame: Number(row.frame),
          detail: `${side} knee angle is outside the plausible human transition range`,
          angle_degrees: roundMetric(value),
          min_degrees: min,
          max_degrees: max,
        });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

function evaluateTemporalElbowAngleDeltas(rows, options) {
  const maxDeltaPer30Frames = finiteNumber(options.elbowAngleMaxDeltaPer30Frames) ?? 95;
  const violations = [];
  const sortedRows = [...rows]
    .filter((row) => Number.isFinite(Number(row.frame)))
    .sort((left, right) => Number(left.frame) - Number(right.frame));

  for (let index = 1; index < sortedRows.length; index += 1) {
    const previous = sortedRows[index - 1];
    const current = sortedRows[index];
    const frameDelta = Number(current.frame) - Number(previous.frame);
    if (!Number.isFinite(frameDelta) || frameDelta <= 0) continue;
    const scaleTo30 = 30 / frameDelta;
    for (const side of ["right", "left"]) {
      const field = `${side}_elbow_degrees`;
      const previousAngle = finiteNumber(previous.joint_angles?.[field]);
      const currentAngle = finiteNumber(current.joint_angles?.[field]);
      if (previousAngle === null || currentAngle === null) continue;
      const deltaPer30Frames = Math.abs(currentAngle - previousAngle) * scaleTo30;
      if (deltaPer30Frames > maxDeltaPer30Frames) {
        violations.push({
          code: `${side}_elbow_angle_temporal_jump`,
          severity: "blocking",
          frame: Number(current.frame),
          previous_frame: Number(previous.frame),
          detail: `${side} elbow angle changes too quickly between sampled frames`,
          previous_angle_degrees: roundMetric(previousAngle),
          current_angle_degrees: roundMetric(currentAngle),
          delta_per_30_frames: roundMetric(deltaPer30Frames),
          max_delta_per_30_frames: roundMetric(maxDeltaPer30Frames),
        });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

function evaluateTemporalKneeAngleDeltas(rows, options) {
  const maxDeltaPer30Frames = finiteNumber(options.kneeAngleMaxDeltaPer30Frames) ?? 90;
  const violations = [];
  const sortedRows = [...rows]
    .filter((row) => Number.isFinite(Number(row.frame)))
    .sort((left, right) => Number(left.frame) - Number(right.frame));

  for (let index = 1; index < sortedRows.length; index += 1) {
    const previous = sortedRows[index - 1];
    const current = sortedRows[index];
    const frameDelta = Number(current.frame) - Number(previous.frame);
    if (!Number.isFinite(frameDelta) || frameDelta <= 0) continue;
    const scaleTo30 = 30 / frameDelta;
    for (const side of ["right", "left"]) {
      const field = `${side}_knee_degrees`;
      const previousAngle = finiteNumber(previous.joint_angles?.[field]);
      const currentAngle = finiteNumber(current.joint_angles?.[field]);
      if (previousAngle === null || currentAngle === null) continue;
      const deltaPer30Frames = Math.abs(currentAngle - previousAngle) * scaleTo30;
      if (deltaPer30Frames > maxDeltaPer30Frames) {
        violations.push({
          code: `${side}_knee_angle_temporal_jump`,
          severity: "blocking",
          frame: Number(current.frame),
          previous_frame: Number(previous.frame),
          detail: `${side} knee angle changes too quickly between sampled frames`,
          previous_angle_degrees: roundMetric(previousAngle),
          current_angle_degrees: roundMetric(currentAngle),
          delta_per_30_frames: roundMetric(deltaPer30Frames),
          max_delta_per_30_frames: roundMetric(maxDeltaPer30Frames),
        });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

function evaluateShoulderAngles(rows, options) {
  const min = finiteNumber(options.shoulderAngleMinDegrees) ?? 0;
  const max = finiteNumber(options.shoulderAngleMaxDegrees) ?? 155;
  const violations = [];

  for (const row of rows) {
    const angles = row.shoulder_angles || {};
    for (const side of ["right", "left"]) {
      const value = finiteNumber(angles[`${side}_upper_arm_to_torso_degrees`]);
      if (value === null) continue;
      if (value < min || value > max) {
        violations.push({
          code: `${side}_shoulder_angle_out_of_range`,
          severity: "blocking",
          frame: Number(row.frame),
          detail: `${side} upper-arm direction is outside the plausible torso-relative shoulder range`,
          angle_degrees: roundMetric(value),
          min_degrees: min,
          max_degrees: max,
        });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

function evaluateTemporalShoulderAngleDeltas(rows, options) {
  const maxDeltaPer30Frames = finiteNumber(options.shoulderAngleMaxDeltaPer30Frames) ?? 90;
  const violations = [];
  const sortedRows = [...rows]
    .filter((row) => Number.isFinite(Number(row.frame)))
    .sort((left, right) => Number(left.frame) - Number(right.frame));

  for (let index = 1; index < sortedRows.length; index += 1) {
    const previous = sortedRows[index - 1];
    const current = sortedRows[index];
    const frameDelta = Number(current.frame) - Number(previous.frame);
    if (!Number.isFinite(frameDelta) || frameDelta <= 0) continue;
    const scaleTo30 = 30 / frameDelta;
    for (const side of ["right", "left"]) {
      const field = `${side}_upper_arm_to_torso_degrees`;
      const previousAngle = finiteNumber(previous.shoulder_angles?.[field]);
      const currentAngle = finiteNumber(current.shoulder_angles?.[field]);
      if (previousAngle === null || currentAngle === null) continue;
      const deltaPer30Frames = Math.abs(currentAngle - previousAngle) * scaleTo30;
      if (deltaPer30Frames > maxDeltaPer30Frames) {
        violations.push({
          code: `${side}_shoulder_angle_temporal_jump`,
          severity: "blocking",
          frame: Number(current.frame),
          previous_frame: Number(previous.frame),
          detail: `${side} shoulder upper-arm direction changes too quickly between sampled frames`,
          previous_angle_degrees: roundMetric(previousAngle),
          current_angle_degrees: roundMetric(currentAngle),
          delta_per_30_frames: roundMetric(deltaPer30Frames),
          max_delta_per_30_frames: roundMetric(maxDeltaPer30Frames),
        });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

function evaluateTorsoCoreClearance(rows, options) {
  const minDistance = finiteNumber(options.torsoCoreMinDistance) ?? 0.45;
  const fields = [
    "right_elbow_to_torso_core_world",
    "right_wrist_to_torso_core_world",
    "left_elbow_to_torso_core_world",
    "left_wrist_to_torso_core_world",
  ];
  const violations = [];

  for (const row of rows) {
    const clearance = row.body_clearance || {};
    for (const field of fields) {
      const distance = finiteNumber(clearance[field]);
      if (distance === null || distance >= minDistance) continue;
      const joint = field.replace("_to_torso_core_world", "");
      violations.push({
        code: `${joint}_torso_core_intrusion`,
        severity: "blocking",
        frame: Number(row.frame),
        detail: `${joint} is inside the torso core clearance volume`,
        torso_core_distance_world: roundMetric(distance),
        min_torso_core_distance_world: roundMetric(minDistance),
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

function evaluateLimbSegmentCoreClearance(rows, options) {
  const minDistance = finiteNumber(options.torsoCoreSegmentMinDistance) ?? 0.32;
  const fields = ["right_forearm_to_torso_core_world", "left_forearm_to_torso_core_world"];
  const violations = [];

  for (const row of rows) {
    const clearance = row.body_clearance || {};
    for (const field of fields) {
      const distance = finiteNumber(clearance[field]);
      if (distance === null || distance >= minDistance) continue;
      const segment = field.replace("_to_torso_core_world", "");
      violations.push({
        code: `${segment}_torso_core_segment_intrusion`,
        severity: "blocking",
        frame: Number(row.frame),
        detail: `${segment} segment crosses too close to the torso core volume`,
        torso_core_segment_distance_world: roundMetric(distance),
        min_torso_core_segment_distance_world: roundMetric(minDistance),
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

function median(values) {
  const finite = values.map((value) => Number(value)).filter(Number.isFinite).sort((left, right) => left - right);
  if (!finite.length) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
}

function evaluateLimbSegmentLengthStability(rows, options) {
  const maxRelativeDeviation = finiteNumber(options.limbSegmentMaxRelativeDeviation) ?? 0.45;
  const fields = ["right_upper_arm_world", "right_forearm_world", "left_upper_arm_world", "left_forearm_world"];
  const violations = [];

  for (const field of fields) {
    const values = rows
      .map((row) => ({ frame: Number(row.frame), value: finiteNumber(row.segment_lengths?.[field]) }))
      .filter((entry) => entry.value !== null);
    if (values.length < 2) continue;
    const baseline = median(values.map((entry) => entry.value));
    if (!baseline || baseline <= 1e-8) continue;
    for (const entry of values) {
      const relativeDeviation = Math.abs(entry.value - baseline) / baseline;
      if (relativeDeviation > maxRelativeDeviation) {
        violations.push({
          code: `${field}_length_unstable`,
          severity: "blocking",
          frame: entry.frame,
          detail: `${field} changes too much across sampled frames`,
          segment_length_world: roundMetric(entry.value),
          baseline_length_world: roundMetric(baseline),
          relative_deviation: roundMetric(relativeDeviation),
          max_relative_deviation: roundMetric(maxRelativeDeviation),
        });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

function evaluateAnkleStanceStability(rows, options) {
  const maxAnkleDriftWorld = finiteNumber(options.ankleStanceMaxDriftWorld) ?? 0.55;
  const maxSpanDriftWorld = finiteNumber(options.ankleStanceMaxSpanDriftWorld) ?? 0.45;
  const sortedRows = [...rows]
    .filter((row) => Number.isFinite(Number(row.frame)))
    .sort((left, right) => Number(left.frame) - Number(right.frame));
  const violations = [];
  let maxAnkleDrift = 0;
  let maxSpanDrift = 0;
  let sampleCount = 0;

  for (const side of ["right", "left"]) {
    const field = `${side}_ankle_world`;
    const values = sortedRows
      .map((row) => ({ frame: Number(row.frame), point: worldPoint(row.stance_metrics?.[field]) }))
      .filter((entry) => entry.point);
    if (values.length < 2) continue;
    sampleCount = Math.max(sampleCount, values.length);
    const baseline = values[0].point;
    let worstEntry = null;
    for (const entry of values) {
      const drift = pointDistance(entry.point, baseline);
      if (!Number.isFinite(drift)) continue;
      maxAnkleDrift = Math.max(maxAnkleDrift, drift);
      if (!worstEntry || drift > worstEntry.drift) {
        worstEntry = { ...entry, drift };
      }
    }
    if (worstEntry?.drift > maxAnkleDriftWorld) {
      violations.push({
        code: `${side}_ankle_stance_drift`,
        severity: "blocking",
        frame: worstEntry.frame,
        detail: `${side} ankle drifts too far from the initial stationary stance`,
        ankle_drift_world: roundMetric(worstEntry.drift),
        max_ankle_drift_world: roundMetric(maxAnkleDriftWorld),
      });
    }
  }

  const spans = sortedRows
    .map((row) => ({ frame: Number(row.frame), value: finiteNumber(row.stance_metrics?.ankle_span_world) }))
    .filter((entry) => entry.value !== null);
  if (spans.length >= 2) {
    sampleCount = Math.max(sampleCount, spans.length);
    const baselineSpan = spans[0].value;
    let worstSpan = null;
    for (const entry of spans) {
      const drift = Math.abs(entry.value - baselineSpan);
      if (!Number.isFinite(drift)) continue;
      maxSpanDrift = Math.max(maxSpanDrift, drift);
      if (!worstSpan || drift > worstSpan.drift) {
        worstSpan = { ...entry, drift };
      }
    }
    if (worstSpan?.drift > maxSpanDriftWorld) {
      violations.push({
        code: "ankle_span_stance_drift",
        severity: "blocking",
        frame: worstSpan.frame,
        detail: "ankle stance width changes too much for a stationary thinking action",
        ankle_span_world: roundMetric(worstSpan.value),
        baseline_ankle_span_world: roundMetric(baselineSpan),
        ankle_span_drift_world: roundMetric(worstSpan.drift),
        max_ankle_span_drift_world: roundMetric(maxSpanDriftWorld),
      });
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    sample_count: sampleCount,
    max_ankle_drift_world: sampleCount ? roundMetric(maxAnkleDrift) : null,
    max_ankle_span_drift_world: sampleCount ? roundMetric(maxSpanDrift) : null,
  };
}

export function summarizePoseMetrics(rows, options = {}) {
  const holdStartFrame = Number.isFinite(options.holdStartFrame) ? Number(options.holdStartFrame) : 180;
  const contactPassPixels = Number.isFinite(options.contactPassPixels) ? Number(options.contactPassPixels) : 30;
  const rightWristToChin = metricSummary(rows, "right_wrist_to_chin_screen", holdStartFrame);
  const leftWristToWaist = metricSummary(rows, "left_wrist_to_waist_screen", holdStartFrame);
  const leftWristToWaistWorld = metricSummary(rows, "left_wrist_to_waist_world", holdStartFrame);
  const finalContactOk = rightWristToChin.final_hold_count > 0 && rightWristToChin.final_hold_max <= contactPassPixels;
  const contactHoldStability = evaluateContactHoldStability(rows, { ...options, holdStartFrame, contactPassPixels });
  const contactHoldPoseStability = evaluateContactHoldPoseStability(rows, {
    ...options,
    holdStartFrame,
    contactPassPixels,
  });
  const thinkingHandRaisePhase = evaluateThinkingHandRaisePhase(rows, {
    ...options,
    holdStartFrame,
    contactPassPixels,
  });
  const thinkingHandApproachPhase = evaluateThinkingHandApproachPhase(rows, {
    ...options,
    holdStartFrame,
    contactPassPixels,
  });
  const thinkingHandFrontPath = evaluateThinkingHandFrontPath(rows, {
    ...options,
    holdStartFrame,
    contactPassPixels,
  });
  const thinkingHandChainFrontPath = evaluateThinkingHandChainFrontPath(rows, {
    ...options,
    holdStartFrame,
    contactPassPixels,
  });
  const thinkingHandHoldEntry = evaluateThinkingHandHoldEntry(rows, {
    ...options,
    holdStartFrame,
    contactPassPixels,
  });
  const supportArmPhase = evaluateSupportArmPhase(rows, { ...options, holdStartFrame, contactPassPixels });
  const elbowAngles = evaluateElbowAngles(rows, options);
  const kneeAngles = evaluateKneeAngles(rows, options);
  const temporalElbowAngles = evaluateTemporalElbowAngleDeltas(rows, options);
  const temporalKneeAngles = evaluateTemporalKneeAngleDeltas(rows, options);
  const shoulderAngles = evaluateShoulderAngles(rows, options);
  const temporalShoulderAngles = evaluateTemporalShoulderAngleDeltas(rows, options);
  const torsoCoreClearance = evaluateTorsoCoreClearance(rows, options);
  const limbSegmentCoreClearance = evaluateLimbSegmentCoreClearance(rows, options);
  const limbSegmentLengths = evaluateLimbSegmentLengthStability(rows, options);
  const ankleStance = evaluateAnkleStanceStability(rows, options);
  const qualityViolations = [
    ...contactHoldStability.violations,
    ...contactHoldPoseStability.violations,
    ...thinkingHandRaisePhase.violations,
    ...thinkingHandApproachPhase.violations,
    ...thinkingHandFrontPath.violations,
    ...thinkingHandChainFrontPath.violations,
    ...thinkingHandHoldEntry.violations,
    ...supportArmPhase.violations,
    ...elbowAngles.violations,
    ...kneeAngles.violations,
    ...temporalElbowAngles.violations,
    ...temporalKneeAngles.violations,
    ...shoulderAngles.violations,
    ...temporalShoulderAngles.violations,
    ...torsoCoreClearance.violations,
    ...limbSegmentCoreClearance.violations,
    ...limbSegmentLengths.violations,
    ...ankleStance.violations,
  ];
  return {
    hold_start_frame: holdStartFrame,
    contact_pass_pixels: contactPassPixels,
    right_wrist_to_chin_screen: rightWristToChin,
    right_wrist_contact_hold: {
      sample_count: contactHoldStability.contact_hold_sample_count,
      max_drift_pixels: contactHoldStability.contact_hold_max_drift_pixels,
    },
    right_wrist_contact_pose_hold: {
      sample_count: contactHoldPoseStability.contact_hold_pose_sample_count,
      max_joint_angle_drift_degrees: contactHoldPoseStability.contact_hold_max_joint_angle_drift_degrees,
    },
    left_wrist_to_waist_screen: leftWristToWaist,
    left_wrist_to_waist_world: leftWristToWaistWorld,
    ankle_stance: {
      sample_count: ankleStance.sample_count,
      max_ankle_drift_world: ankleStance.max_ankle_drift_world,
      max_ankle_span_drift_world: ankleStance.max_ankle_span_drift_world,
    },
    quality_gates: {
      right_wrist_final_hold_under_threshold: finalContactOk,
      right_wrist_contact_hold_stable: contactHoldStability.ok,
      right_wrist_contact_pose_stable: contactHoldPoseStability.ok,
      thinking_hand_raise_phase_coherent: thinkingHandRaisePhase.ok,
      thinking_hand_approach_phase_coherent: thinkingHandApproachPhase.ok,
      thinking_hand_stays_in_front_of_torso: thinkingHandFrontPath.ok,
      thinking_hand_chain_stays_in_front_of_torso: thinkingHandChainFrontPath.ok,
      thinking_hand_hold_entry_coherent: thinkingHandHoldEntry.ok,
      transition_support_arm_phase_coherent: supportArmPhase.ok,
      elbow_angles_plausible_all_frames: elbowAngles.ok,
      knee_angles_plausible_all_frames: kneeAngles.ok,
      elbow_angle_temporal_delta_plausible_all_frames: temporalElbowAngles.ok,
      knee_angle_temporal_delta_plausible_all_frames: temporalKneeAngles.ok,
      shoulder_angles_plausible_all_frames: shoulderAngles.ok,
      shoulder_angle_temporal_delta_plausible_all_frames: temporalShoulderAngles.ok,
      limb_endpoints_clear_torso_core_all_frames: torsoCoreClearance.ok,
      limb_segments_clear_torso_core_all_frames: limbSegmentCoreClearance.ok,
      limb_segment_lengths_stable_all_frames: limbSegmentLengths.ok,
      ankle_stance_stable_all_frames: ankleStance.ok,
      overall_motion_quality:
        finalContactOk &&
        contactHoldStability.ok &&
        contactHoldPoseStability.ok &&
        thinkingHandRaisePhase.ok &&
        thinkingHandApproachPhase.ok &&
        thinkingHandFrontPath.ok &&
        thinkingHandChainFrontPath.ok &&
        thinkingHandHoldEntry.ok &&
        supportArmPhase.ok &&
        elbowAngles.ok &&
        kneeAngles.ok &&
        temporalElbowAngles.ok &&
        temporalKneeAngles.ok &&
        shoulderAngles.ok &&
        temporalShoulderAngles.ok &&
        torsoCoreClearance.ok &&
        limbSegmentCoreClearance.ok &&
        limbSegmentLengths.ok &&
        ankleStance.ok,
    },
    quality_violations: qualityViolations,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatPixels(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}px` : "missing";
}

function formatDegrees(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}deg` : "missing";
}

function formatUnits(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}u` : "missing";
}

function minFiniteValue(values) {
  const finite = values.map((value) => Number(value)).filter(Number.isFinite);
  return finite.length ? Math.min(...finite) : null;
}

export function buildContactSheetHtml({ title, createdAt, model, vmd, rows, summary }) {
  const figures = rows
    .map((row) => {
      const imageSrc = row.imageFile || path.basename(String(row.imagePath || ""));
      const rightElbow = formatDegrees(row.joint_angles?.right_elbow_degrees);
      const leftElbow = formatDegrees(row.joint_angles?.left_elbow_degrees);
      const rightKnee = formatDegrees(row.joint_angles?.right_knee_degrees);
      const leftKnee = formatDegrees(row.joint_angles?.left_knee_degrees);
      const rightShoulder = formatDegrees(row.shoulder_angles?.right_upper_arm_to_torso_degrees);
      const leftShoulder = formatDegrees(row.shoulder_angles?.left_upper_arm_to_torso_degrees);
      const leftWaistWorld = formatUnits(row.left_wrist_to_waist_world);
      const torsoClearance = formatUnits(minFiniteValue(Object.values(row.body_clearance || {})));
      const frontDepthWrist = formatUnits(row.thinking_hand_path?.right_wrist_front_offset_world);
      const frontDepthElbow = formatUnits(row.thinking_hand_path?.right_elbow_front_offset_world);
      const frontDepthForearmMid = formatUnits(row.thinking_hand_path?.right_forearm_mid_front_offset_world);
      return `<figure>
  <img src="${escapeHtml(imageSrc)}" alt="frame ${escapeHtml(row.frame)}">
  <figcaption>
    <strong>f${escapeHtml(row.frame)}</strong>
    <span>right wrist to chin: ${escapeHtml(formatPixels(row.right_wrist_to_chin_screen))}</span>
    <span>left wrist to waist: ${escapeHtml(formatPixels(row.left_wrist_to_waist_screen))}</span>
    <span>left wrist to waist world: ${escapeHtml(leftWaistWorld)}</span>
    <span>torso core clearance: ${escapeHtml(torsoClearance)}</span>
    <span>front depth: wrist ${escapeHtml(frontDepthWrist)}, elbow ${escapeHtml(frontDepthElbow)}, forearm mid ${escapeHtml(frontDepthForearmMid)}</span>
    <span>elbow angle R/L: ${escapeHtml(rightElbow)} / ${escapeHtml(leftElbow)}</span>
    <span>knee angle R/L: ${escapeHtml(rightKnee)} / ${escapeHtml(leftKnee)}</span>
    <span>shoulder angle R/L: ${escapeHtml(rightShoulder)} / ${escapeHtml(leftShoulder)}</span>
  </figcaption>
</figure>`;
    })
    .join("\n");
  const gate = summary?.quality_gates?.overall_motion_quality ? "pass" : "fail";
  const violations = (summary?.quality_violations || [])
    .map((violation) => {
      const frame = Number.isFinite(Number(violation.frame)) ? `f${violation.frame}: ` : "";
      return `<li>${escapeHtml(frame)}${escapeHtml(violation.code)} - ${escapeHtml(violation.detail || "")}</li>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f5f5f5; color: #171717; }
    header { padding: 14px 18px; background: #fff; border-bottom: 1px solid #d8d8d8; }
    h1 { margin: 0 0 6px; font-size: 18px; font-weight: 700; }
    .meta { display: grid; grid-template-columns: max-content 1fr; gap: 4px 10px; font-size: 12px; color: #4b5563; }
    .violations { margin: 10px 0 0; padding-left: 18px; font-size: 12px; color: #991b1b; }
    main { display: grid; grid-template-columns: repeat(3, minmax(320px, 1fr)); gap: 14px; padding: 14px; }
    figure { margin: 0; background: #fff; border: 1px solid #d8d8d8; border-radius: 4px; overflow: hidden; }
    img { display: block; width: 100%; height: auto; background: white; }
    figcaption { display: grid; gap: 3px; padding: 8px 10px; font-size: 12px; }
    strong { font-size: 13px; }
    .gate { font-weight: 700; color: ${gate === "pass" ? "#166534" : "#991b1b"}; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <span>created</span><span>${escapeHtml(createdAt)}</span>
      <span>model</span><span>${escapeHtml(model)}</span>
      <span>vmd</span><span>${escapeHtml(vmd)}</span>
      <span>motion quality gate</span><span class="gate">${gate}</span>
    </div>
    ${violations ? `<ul class="violations">${violations}</ul>` : ""}
  </header>
  <main>${figures}</main>
</body>
</html>
`;
}

export function parseArgs(argv) {
  const options = {
    webUrl: "http://127.0.0.1:3100",
    model: defaultModelPath(),
    modelProfile: DEFAULT_PROFILE_PATH,
    vmd: DEFAULT_VMD_PATH,
    out: "imgToAction/outputs/actions/thinking_chin_edge/fit_latest_preview",
    frames: [0, 60, 120, 180, 240, 292],
    fps: 30,
    renderPipeline: "genshin",
    viewportWidth: 1536,
    viewportHeight: 1536,
    headless: true,
    holdStartFrame: 180,
    contactPassPixels: 30,
    title: "VMD Pose Check",
    camera: "",
    metricsOnly: false,
    _debugBonePersistence: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--web-url") {
      options.webUrl = next;
      index += 1;
    } else if (arg === "--model") {
      options.model = next;
      index += 1;
    } else if (arg === "--model-profile") {
      options.modelProfile = next;
      index += 1;
    } else if (arg === "--vmd") {
      options.vmd = next;
      index += 1;
    } else if (arg === "--out") {
      options.out = next;
      index += 1;
    } else if (arg === "--frames") {
      options.frames = parseFrameList(next);
      index += 1;
    } else if (arg === "--fps") {
      options.fps = Number(next) || options.fps;
      index += 1;
    } else if (arg === "--render-pipeline") {
      options.renderPipeline = next;
      index += 1;
    } else if (arg === "--viewport") {
      const [width, height] = next.split("x").map((item) => Number.parseInt(item, 10));
      if (Number.isFinite(width) && Number.isFinite(height)) {
        options.viewportWidth = width;
        options.viewportHeight = height;
      }
      index += 1;
    } else if (arg === "--hold-start-frame") {
      options.holdStartFrame = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--contact-pass-pixels") {
      options.contactPassPixels = Number(next);
      index += 1;
    } else if (arg === "--title") {
      options.title = next;
      index += 1;
    } else if (arg === "--camera") {
      options.camera = next;
      index += 1;
    } else if (arg === "--headful") {
      options.headless = false;
    } else if (arg === "--debug-bone-persistence") {
      options._debugBonePersistence = true;
    } else if (arg === "--metrics-only") {
      options.metricsOnly = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node imgToAction/tools/render-vmd-pose-check.mjs [options]

Options:
  --web-url URL                 Next dev server URL. Default: http://127.0.0.1:3100
  --model PATH                  PMX path under repo root.
  --model-profile PATH          Model profile JSON. Default: ${DEFAULT_PROFILE_PATH}
  --vmd PATH                    VMD path under repo root. Default: ${DEFAULT_VMD_PATH}
  --out PATH                    Output directory.
  --frames LIST                 Comma list of VMD frames. Default: 0,60,120,180,240,292
  --fps N                       VMD FPS used for seek. Default: 30
  --render-pipeline NAME        MMD render pipeline. Default: genshin
  --viewport WxH                Browser viewport. Default: 1536x1536
  --hold-start-frame N          First frame counted as final hold. Default: 180
  --contact-pass-pixels N       Max final-hold right-wrist/chin pixel distance. Default: 30
  --camera JSON                 Optional calibration camera snapshot JSON.
  --metrics-only                Write render_metrics.json without frame PNGs or contact sheet artifacts.
  --headful                     Show Chromium
`);
}

function defaultModelPath() {
  return existsSync(path.resolve(projectRoot, MAIN_EULA_MODEL_PATH)) ? MAIN_EULA_MODEL_PATH : FALLBACK_EULA_MODEL_PATH;
}

function resolveWithinProject(filePath) {
  const resolved = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(projectRoot, filePath);
  if (resolved !== projectRoot && !resolved.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`Path is outside project root: ${filePath}`);
  }
  return resolved;
}

function startStaticServer(root) {
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (!url.pathname.startsWith("/files/")) {
        response.writeHead(404, { "Access-Control-Allow-Origin": "*" });
        response.end("Not found");
        return;
      }
      const decodedPath = decodeURIComponent(url.pathname.slice("/files/".length));
      const target = path.resolve(root, decodedPath);
      if ((target !== root && !target.startsWith(`${root}${path.sep}`)) || !existsSync(target)) {
        response.writeHead(404, { "Access-Control-Allow-Origin": "*" });
        response.end("Not found");
        return;
      }
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": MIME_TYPES[path.extname(target).toLowerCase()] || "application/octet-stream",
      });
      createReadStream(target).pipe(response);
    } catch (error) {
      response.writeHead(500, { "Access-Control-Allow-Origin": "*" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function toServedUrl(baseUrl, filePath) {
  return `${baseUrl}/files/${path
    .relative(projectRoot, filePath)
    .split(path.sep)
    .map(encodeURIComponent)
    .join("/")}`;
}

async function importPlaywright() {
  const requireFromWeb = createRequire(path.join(projectRoot, "web", "package.json"));
  try {
    return requireFromWeb("playwright");
  } catch (error) {
    const packageUrl = pathToFileURL(path.join(projectRoot, "web", "node_modules", "@playwright", "test", "index.js"));
    try {
      return await import(packageUrl.href);
    } catch {
      throw error;
    }
  }
}

async function waitForRuntime(page, consoleMessages = []) {
  try {
    await page.waitForFunction(
      () => Boolean(window.__mmdCompanionRuntime?.model && !window.__mmdCompanionRuntime?.isLoadingVmd),
      null,
      { timeout: 60_000 },
    );
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const runtime = window.__mmdCompanionRuntime;
      return {
        href: window.location.href,
        hasRuntime: Boolean(runtime),
        hasModel: Boolean(runtime?.model),
        isLoadingVmd: Boolean(runtime?.isLoadingVmd),
        currentVmdUrl: runtime?.currentVmdUrl || "",
        status: document.querySelector(".mio-stage-status")?.textContent || "",
        bodyText: document.body?.innerText?.slice(0, 1000) || "",
      };
    });
    throw new Error(
      `MMD runtime did not become ready: ${JSON.stringify({
        ...diagnostics,
        consoleMessages: consoleMessages.slice(-20),
      })}`,
      { cause: error },
    );
  }
}

function isBenignBrowserConsoleMessage(text) {
  return (
    /THREE\.Material: '(skinning|morphTargets|envMap|combine)' is not a property/i.test(text) ||
    /GPU stall due to ReadPixels/i.test(text) ||
    /Failed to load resource: net::ERR_NETWORK_ACCESS_DENIED/i.test(text)
  );
}

async function loadVmd(page, vmdUrl) {
  const played = await page.evaluate(async (url) => {
    const runtime = window.__mmdCompanionRuntime;
    runtime?.setCalibrationCaptureMode?.(true);
    const result = await runtime?.playVmd?.(url, 1, [], { disableCrossfade: true });
    runtime?.setCalibrationCaptureMode?.(true);
    return result !== false;
  }, vmdUrl);
  if (!played) throw new Error(`Failed to load VMD: ${vmdUrl}`);
  await waitForRuntime(page);
}

async function applyRequestedCamera(page, cameraSnapshot) {
  const actual = await page.evaluate((snapshot) => {
    const runtime = window.__mmdCompanionRuntime;
    if (!runtime) return null;
    if (snapshot) {
      return runtime.applyCameraSnapshot?.(snapshot, { locked: snapshot.locked }) ?? null;
    }
    return runtime.getCameraSnapshot?.() ?? null;
  }, cameraSnapshot);
  await page.waitForTimeout(80);
  return actual;
}

async function seekAndMeasure(page, { frame, fps, requests }) {
  const ok = await page.evaluate(
    ({ frame, fps }) => window.__mmdCompanionRuntime?.seekVmdFrame?.(frame, fps) === true,
    { frame, fps },
  );
  if (!ok) throw new Error(`Failed to seek frame ${frame}`);
  await page.waitForTimeout(120);

  // Debug: read bone quats immediately and after delay to check if render loop overwrites
  if (existsSync(path.join(projectRoot, 'tmp', 'debug_bone_persist.flag'))) {
    const immediate = await page.evaluate((reqs) => {
      const model = window.__mmdCompanionRuntime?.model;
      model?.updateMatrixWorld?.(true);
      const bonesByName = new Map();
      const visit = (o) => { if (!o) return; for (const b of o.skeleton?.bones||[]) if (b?.name) bonesByName.set(b.name, b); for (const c of o.children||[]) visit(c); };
      visit(model);
      const r = {};
      for (const n of ['右足首','右足','右ひざ','右腕','首','頭']) {
        const b = bonesByName.get(n);
        r[n] = b ? b.quaternion.x.toFixed(4)+','+b.quaternion.y.toFixed(4)+','+b.quaternion.z.toFixed(4)+','+b.quaternion.w.toFixed(4) : 'NF';
      }
      return r;
    }, requests);
    await page.waitForTimeout(300);
    const after = await page.evaluate((reqs) => {
      const model = window.__mmdCompanionRuntime?.model;
      model?.updateMatrixWorld?.(true);
      const bonesByName = new Map();
      const visit = (o) => { if (!o) return; for (const b of o.skeleton?.bones||[]) if (b?.name) bonesByName.set(b.name, b); for (const c of o.children||[]) visit(c); };
      visit(model);
      const r = {};
      for (const n of ['右足首','右足','右ひざ','右腕','首','頭']) {
        const b = bonesByName.get(n);
        r[n] = b ? b.quaternion.x.toFixed(4)+','+b.quaternion.y.toFixed(4)+','+b.quaternion.z.toFixed(4)+','+b.quaternion.w.toFixed(4) : 'NF';
      }
      return r;
    }, requests);
    console.error(`  [debug] frame ${frame} immediate: ${JSON.stringify(immediate)}`);
    console.error(`  [debug] frame ${frame} after 300ms: ${JSON.stringify(after)}`);
  }

  const row = await page.evaluate(({ requests, frame }) => {
    const runtime = window.__mmdCompanionRuntime;
    const camera = runtime?.camera;
    const model = runtime?.model;
    const canvas = runtime?.renderer?.domElement || document.querySelector("canvas");
    if (!runtime || !camera || !model || !canvas) {
      throw new Error("MMD runtime is missing model, camera, or canvas");
    }

    model.updateMatrixWorld?.(true);
    camera.updateMatrixWorld?.(true);
    camera.updateProjectionMatrix?.();

    const bonesByName = new Map();
    const visit = (object) => {
      if (!object) return;
      for (const bone of object.skeleton?.bones || []) {
        if (bone?.name && !bonesByName.has(bone.name)) bonesByName.set(bone.name, bone);
      }
      if (object.name && object.isBone && !bonesByName.has(object.name)) bonesByName.set(object.name, object);
      for (const child of object.children || []) visit(child);
    };
    visit(model);

    const multiplyMatrixVector = (matrix, vector) => {
      const e = matrix.elements;
      const [x, y, z, w] = vector;
      return [
        e[0] * x + e[4] * y + e[8] * z + e[12] * w,
        e[1] * x + e[5] * y + e[9] * z + e[13] * w,
        e[2] * x + e[6] * y + e[10] * z + e[14] * w,
        e[3] * x + e[7] * y + e[11] * z + e[15] * w,
      ];
    };
    const transformLocalPoint = (matrix, offset) => {
      const local = Array.isArray(offset) && offset.length === 3 ? offset.map(Number) : [0, 0, 0];
      const [x, y, z, w] = multiplyMatrixVector(matrix, [local[0], local[1], local[2], 1]);
      const divisor = Math.abs(w) > 1e-8 ? w : 1;
      return { x: x / divisor, y: y / divisor, z: z / divisor };
    };

    const projectWorld = (world) => {
      const view = multiplyMatrixVector(camera.matrixWorldInverse, [world.x, world.y, world.z, 1]);
      const clip = multiplyMatrixVector(camera.projectionMatrix, view);
      const ndcX = clip[0] / clip[3];
      const ndcY = clip[1] / clip[3];
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((ndcX + 1) / 2) * rect.width,
        y: ((1 - ndcY) / 2) * rect.height,
        z: clip[2] / clip[3],
      };
    };

    const landmarks = {};
    const missing = [];
    for (const request of requests) {
      const samples = [];
      const localOffsets =
        Array.isArray(request.localOffsets) && request.localOffsets.length
          ? request.localOffsets
          : [request.localOffset || [0, 0, 0]];
      for (const boneName of request.bones) {
        const bone = bonesByName.get(boneName);
        if (!bone) continue;
        bone.updateMatrixWorld?.(true);
        localOffsets.forEach((offset, offsetIndex) => {
          const localOffset = Array.isArray(offset) && offset.length === 3 ? offset.map(Number) : [0, 0, 0];
          const world = transformLocalPoint(bone.matrixWorld, localOffset);
          const label = request.localOffsets?.length ? `${request.name}_${offsetIndex}` : request.name;
          samples.push({ bone: boneName, label, localOffset, world, projected: projectWorld(world) });
        });
      }
      if (!samples.length) {
        missing.push(request.name);
        continue;
      }
      landmarks[request.name] = {
        x: samples.reduce((sum, sample) => sum + sample.projected.x, 0) / samples.length,
        y: samples.reduce((sum, sample) => sum + sample.projected.y, 0) / samples.length,
        z: samples.reduce((sum, sample) => sum + sample.projected.z, 0) / samples.length,
        samples,
      };
    }

    const distance = (left, right) => {
      if (!left || !right) return null;
      return Math.hypot(left.x - right.x, left.y - right.y);
    };
    const averageWorld = (landmark) => {
      if (!landmark?.samples?.length) return null;
      return {
        x: landmark.samples.reduce((sum, sample) => sum + sample.world.x, 0) / landmark.samples.length,
        y: landmark.samples.reduce((sum, sample) => sum + sample.world.y, 0) / landmark.samples.length,
        z: landmark.samples.reduce((sum, sample) => sum + sample.world.z, 0) / landmark.samples.length,
      };
    };
    const elbowAngle = (shoulder, elbow, wrist) => {
      if (!shoulder || !elbow || !wrist) return null;
      const upper = { x: shoulder.x - elbow.x, y: shoulder.y - elbow.y, z: shoulder.z - elbow.z };
      const lower = { x: wrist.x - elbow.x, y: wrist.y - elbow.y, z: wrist.z - elbow.z };
      const upperLength = Math.hypot(upper.x, upper.y, upper.z);
      const lowerLength = Math.hypot(lower.x, lower.y, lower.z);
      if (upperLength <= 1e-8 || lowerLength <= 1e-8) return null;
      const dot = upper.x * lower.x + upper.y * lower.y + upper.z * lower.z;
      const cosine = Math.max(-1, Math.min(1, dot / (upperLength * lowerLength)));
      return (Math.acos(cosine) * 180) / Math.PI;
    };

    const rightShoulderWorld = averageWorld(landmarks.right_shoulder);
    const rightElbowWorld = averageWorld(landmarks.right_elbow);
    const rightWristWorld = averageWorld(landmarks.right_wrist);
    const leftShoulderWorld = averageWorld(landmarks.left_shoulder);
    const leftElbowWorld = averageWorld(landmarks.left_elbow);
    const leftWristWorld = averageWorld(landmarks.left_wrist);
    const rightHipWorld = averageWorld(landmarks.right_hip);
    const rightKneeWorld = averageWorld(landmarks.right_knee);
    const rightAnkleWorld = averageWorld(landmarks.right_ankle);
    const leftHipWorld = averageWorld(landmarks.left_hip);
    const leftKneeWorld = averageWorld(landmarks.left_knee);
    const leftAnkleWorld = averageWorld(landmarks.left_ankle);

    const _boneQuats = {};
    for (const _bn of ["右足首","右足","右ひざ","首","頭","下半身","右足ＩＫ","左足ＩＫ","右腕","右ひじ","上半身","上半身2","右肩","左足首","左足","左ひざ"]) {
      const _b = bonesByName.get(_bn);
      if (_b) {
        _boneQuats[_bn] = { x: +_b.quaternion.x.toFixed(6), y: +_b.quaternion.y.toFixed(6), z: +_b.quaternion.z.toFixed(6), w: +_b.quaternion.w.toFixed(6) };
      }
    }
    return {
      frame,
      bone_quaternions: _boneQuats,
      right_wrist_to_chin_average_screen: distance(landmarks.right_wrist, landmarks.chin),
      left_wrist_to_waist_screen: distance(landmarks.left_wrist, landmarks.waist),
      joint_angles: {
        right_elbow_degrees: elbowAngle(rightShoulderWorld, rightElbowWorld, rightWristWorld),
        left_elbow_degrees: elbowAngle(leftShoulderWorld, leftElbowWorld, leftWristWorld),
        right_knee_degrees: elbowAngle(rightHipWorld, rightKneeWorld, rightAnkleWorld),
        left_knee_degrees: elbowAngle(leftHipWorld, leftKneeWorld, leftAnkleWorld),
      },
      projected: Object.fromEntries(
        Object.entries(landmarks).map(([name, value]) => [name, { x: value.x, y: value.y, z: value.z }]),
      ),
      samples: landmarks,
      missing,
    };
  }, { requests, frame });

  const contact = nearestProjectedSampleDistance(row.samples?.right_wrist, row.samples?.chin);
  const leftWristToWaistWorld = nearestWorldSampleDistance(row.samples?.left_wrist, row.samples?.waist);
  const bodyClearance = computeTorsoCoreClearance(row.samples);
  const segmentLengths = computeLimbSegmentLengths(row.samples);
  const stanceMetrics = computeStanceMetrics(row.samples);
  const thinkingHandPath = computeThinkingHandPathMetrics(row.samples);
  const shoulderAngles = computeShoulderAngles(row.samples);
  return {
    ...row,
    right_wrist_to_chin_screen: contact?.distance ?? row.right_wrist_to_chin_average_screen ?? null,
    left_wrist_to_waist_world: leftWristToWaistWorld?.distance ?? null,
    body_clearance: bodyClearance,
    segment_lengths: segmentLengths,
    stance_metrics: stanceMetrics,
    thinking_hand_path: thinkingHandPath,
    shoulder_angles: shoulderAngles,
    head_orientation: computeHeadOrientation(row.samples),
    ankle_orientation: computeAnkleOrientation(row.samples),
    torso_orientation: computeTorsoOrientation(row.samples),
    projected: {
      ...row.projected,
      chin_contact_target: contact?.targetSample?.projected ?? null,
    },
    contact_pairs: {
      right_wrist_to_chin: contact,
      left_wrist_to_waist_world: leftWristToWaistWorld,
    },
  };
}

async function writeSheetScreenshot(browser, outputDir) {
  const sheetPath = path.join(outputDir, "contact-sheet.html");
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 1 });
  try {
    await page.goto(pathToFileURL(sheetPath).href, { waitUntil: "load" });
    await page.screenshot({ path: path.join(outputDir, "contact_sheet.png"), fullPage: true });
  } finally {
    await page.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const modelPath = resolveWithinProject(options.model);
  const vmdPath = resolveWithinProject(options.vmd);
  const modelProfilePath = resolveWithinProject(options.modelProfile);
  const outputDir = resolveWithinProject(options.out);
  if (!existsSync(modelPath)) throw new Error(`Model not found: ${modelPath}`);
  if (!existsSync(vmdPath)) throw new Error(`VMD not found: ${vmdPath}`);
  if (!existsSync(modelProfilePath)) throw new Error(`Model profile not found: ${modelProfilePath}`);
  mkdirSync(outputDir, { recursive: true });

  const modelProfile = JSON.parse(readFileSync(modelProfilePath, "utf8"));
  const requests = defaultBoneLandmarkRequests(modelProfile);
  const requestedCamera = parseCameraSnapshot(options.camera);
  const staticServer = await startStaticServer(projectRoot);
  const { chromium } = await importPlaywright();
  const browser = await chromium.launch({ headless: options.headless });
  const page = await browser.newPage({
    viewport: { width: options.viewportWidth, height: options.viewportHeight },
    deviceScaleFactor: 1,
  });
  const consoleMessages = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      const text = message.text();
      if (!isBenignBrowserConsoleMessage(text)) consoleMessages.push(`[${message.type()}] ${text}`);
    }
  });
  page.on("pageerror", (error) => {
    consoleMessages.push(`[pageerror] ${error.message}`);
  });

  try {
    const renderUrl = new URL("/mmd-calibration-render", options.webUrl);
    renderUrl.searchParams.set("modelUrl", toServedUrl(staticServer.baseUrl, modelPath));
    renderUrl.searchParams.set("renderPipeline", options.renderPipeline);
    if (requestedCamera) renderUrl.searchParams.set("camera", JSON.stringify(requestedCamera));
    await page.goto(renderUrl.href, { waitUntil: "domcontentloaded" });
    await waitForRuntime(page, consoleMessages);
    await page.evaluate(() => window.__mmdCompanionRuntime?.setCalibrationCaptureMode?.(true));
    await loadVmd(page, toServedUrl(staticServer.baseUrl, vmdPath));
    const actualCamera = await applyRequestedCamera(page, requestedCamera);

    const rows = [];
    for (const frame of options.frames) {
      const row = await seekAndMeasure(page, { frame, fps: options.fps, requests });
      if (options.metricsOnly) {
        rows.push(row);
      } else {
        const imageFile = `frame_${String(frame).padStart(3, "0")}.png`;
        const imagePath = path.join(outputDir, imageFile);
        await page.screenshot({ path: imagePath, fullPage: false });
        rows.push({
          ...row,
          imageFile,
          imagePath: path.relative(projectRoot, imagePath).replaceAll(path.sep, "/"),
        });
      }
    }

    const summary = summarizePoseMetrics(rows, {
      holdStartFrame: options.holdStartFrame,
      contactPassPixels: options.contactPassPixels,
    });
    const createdAt = new Date().toISOString();
    const payload = {
      createdAt,
      model: path.relative(projectRoot, modelPath).replaceAll(path.sep, "/"),
      vmd: path.relative(projectRoot, vmdPath).replaceAll(path.sep, "/"),
      renderPipeline: options.renderPipeline,
      requestedCamera,
      actualCamera,
      fps: options.fps,
      frames: options.frames,
      landmarkRequests: requests,
      rows,
      summary,
      consoleMessages,
      sheet: options.metricsOnly
        ? null
        : path.relative(projectRoot, path.join(outputDir, "contact_sheet.png")).replaceAll(path.sep, "/"),
      sheetHtml: options.metricsOnly
        ? null
        : path.relative(projectRoot, path.join(outputDir, "contact-sheet.html")).replaceAll(path.sep, "/"),
    };
    writeFileSync(path.join(outputDir, "render_metrics.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    if (!options.metricsOnly) {
      writeFileSync(
        path.join(outputDir, "contact-sheet.html"),
        buildContactSheetHtml({
          title: options.title,
          createdAt,
          model: payload.model,
          vmd: payload.vmd,
          rows,
          summary,
        }),
        "utf8",
      );
      await writeSheetScreenshot(browser, outputDir);
    }
    console.log(
      `Wrote ${rows.length} frames to ${path.relative(projectRoot, outputDir)} ` +
        `right_hold_max=${summary.right_wrist_to_chin_screen.final_hold_max}px ` +
        `gate=${summary.quality_gates.overall_motion_quality ? "pass" : "fail"}`,
    );
  } finally {
    await page.close();
    await browser.close();
    staticServer.server.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
