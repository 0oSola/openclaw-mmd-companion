#!/usr/bin/env python3
"""动作验收 Gate — 程序化验收 VMD 动作生成结果。

依据 imgToAction/docs/motion_acceptance_gate.md 规范实现。
所有阈值来自 pmx_geometry_reference.md 顶点数据和坐标校准结果。

用法:
    python motion_acceptance_gate.py <vmd_file> [--fk-model fk_world_model] [--output report.json]
"""
from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# ─── 常量 (来自 pmx_geometry_reference.md) ───

PMX_SCALE = 0.9
PMX_OFFSET = (0.0, -9.738, 0.697)
TORSO_SCALE = 8.54
# 前方轴 (PMX 模型空间, Z- = 前方)
FRONT_AXIS = (0.0, 0.14, -0.99)

# 下巴尖 (骨13 下齿)
CHIN_TIP = [0.0, 18.87, -1.41]
# 下巴表面探测点
CHIN_SURFACE = [0.0, 18.44, -0.50]
# 思考动作中手部视觉轮廓必须低于下巴表面，避免“掌/指顶到脸上方”的假通过。
HAND_CONTOUR_CHIN_CLEARANCE = 0.25
RIGHT_THINKING_ELBOW_ANGLE = (40.0, 90.0)
RIGHT_THINKING_WRIST_CHIN_DISTANCE = (1.8, 2.6)
RIGHT_THINKING_HAND_CHIN_DISTANCE_MAX = 0.85
RIGHT_THINKING_ELBOW_X_RANGE = (-2.6, -1.0)
RIGHT_ARM_ANATOMY_ELBOW_ANGLE = (55.0, 100.0)
RIGHT_ARM_ANATOMY_SHOULDER_WRIST_DISTANCE = (2.95, 4.1)
RIGHT_HAND_SHAPE_FINGERTIP_Y_SPREAD_MAX = 0.30
RIGHT_HAND_SHAPE_Y_EXTENT_MAX = 1.13
RIGHT_HAND_SHAPE_TOP_CLEARANCE_MIN = 0.05
RIGHT_APPROACH_WRIST_CHIN_DISTANCE = 4.60
RIGHT_APPROACH_CLOSE_WRIST_CHIN_DISTANCE = 3.60
RIGHT_APPROACH_FINGERTIP_Y_SPREAD_MAX = 0.65
RIGHT_APPROACH_HAND_Y_EXTENT_MAX = 1.30
RIGHT_APPROACH_AVG_TIP_REACH_MAX = 1.68
RIGHT_APPROACH_CLOSE_FINGERTIP_Y_SPREAD_MAX = 0.50
RIGHT_APPROACH_CLOSE_HAND_Y_EXTENT_MAX = 1.22
RIGHT_APPROACH_CLOSE_AVG_TIP_REACH_MAX = 1.62
RIGHT_CONTACT_THUMB_CHIN_DISTANCE_MAX = 1.10
RIGHT_CONTACT_INDEX_CHIN_DISTANCE_MAX = 0.60
RIGHT_CONTACT_POINTS_SEPARATION_MIN = 0.25
RIGHT_WRIST_BEND_MAX = 55.0
RIGHT_PALM_NORMAL_CHIN_ANGLE_MAX = 70.0
RIGHT_CONTACT_RELATIVE_DRIFT_MAX = 0.12

# 右肩C (骨55)
RIGHT_SHOULDER_C = [-1.417, 17.305, -0.006]
# 左肩C (骨20)
LEFT_SHOULDER_C = [1.417, 17.305, -0.006]
# 右手腕 T-pose (骨66)
RIGHT_WRIST_TPOSE = [-5.813, 13.866, 0.033]
# 左手腕 T-pose (骨31)
LEFT_WRIST_TPOSE = [5.813, 13.866, 0.033]

# 手臂段长度
UPPER_ARM_LEN = 3.009
FOREARM_LEN = 2.578
ARM_TOTAL_LEN = 5.587

# 全身包围盒
BODY_BOUNDS = {
    "x": (-7.617, 7.617),
    "y": (-0.011, 21.653),
    "z": (-2.299, 3.846),
}

# 骨骼段长度 (PMX)
SEGMENT_LENGTHS = {
    "upper_arm": (2.5, 3.5),   # 上臂 3.009 ±0.5
    "forearm": (2.1, 3.1),     # 前臂 2.578 ±0.5
    "thigh": (4.7, 5.7),       # 大腿 5.240 ±0.5
    "shin": (4.6, 5.6),        # 小腿 5.065 ±0.5
}

# 躯干碰撞体 AABB (PMX 模型空间) — §2.3
COLLISION_BODIES = {
    "head":         {"x": (-1.89, 1.83), "y": (18.06, 21.65), "z": (-1.97, 0.95)},
    "upper_chest":  {"x": (-1.29, 1.29), "y": (15.31, 18.10), "z": (-2.11, 0.67)},
    "mid_chest":    {"x": (-1.32, 1.32), "y": (13.90, 15.02), "z": (-1.85, 0.01)},
    "waist":        {"x": (-1.83, 1.83), "y": (11.58, 13.90), "z": (-1.78, 0.83)},
}

# 关节角度限制 — §6.1
JOINT_LIMITS = {
    "elbow": (20.0, 175.0),
    "knee": (15.0, 175.0),
    "shoulder_arm": (0.0, 170.0),
}

# 最大角速度 (rad/frame) — §6.2
MAX_ANGULAR_VELOCITY = {
    "torso": 0.15,
    "upper_arm": 0.25,
    "forearm": 0.35,
    "wrist": 0.40,
    "finger": 0.40,
    "leg": 0.20,
}
MAX_ANGULAR_ACCELERATION = {
    "upper_arm": 0.035,
    "forearm": 0.050,
    "wrist": 0.060,
}
MAX_ANGULAR_JERK = {
    "upper_arm": 0.012,
    "forearm": 0.018,
    "wrist": 0.022,
}

# T-pose 基准
TPOSE_ANGLES = {
    "right_elbow": 171.67,
    "left_elbow": 171.66,
    "right_knee": 171.79,
    "left_knee": 170.80,
}

# 脚踝基准
TPOSE_ANKLES = {
    "right": [-0.757, 1.780, 0.118],
    "left":  [0.757, 1.788, 0.118],
}

# 骨骼名映射
BONE_NAMES = {
    "head": "頭", "neck": "首", "chin": "下齿",
    "right_shoulder": "右肩C", "left_shoulder": "左肩C",
    "right_upper_arm": "右腕", "left_upper_arm": "左腕",
    "right_elbow": "右ひじ", "left_elbow": "左ひじ",
    "right_wrist": "右手首", "left_wrist": "左手首",
    "right_hip": "右足", "left_hip": "左足",
    "right_knee": "右ひざ", "left_knee": "左ひざ",
    "right_ankle": "右足首", "left_ankle": "左足首",
    "upper_body": "上半身2", "lower_body": "下半身",
}

RIGHT_HAND_CONTOUR_BONES = (
    "right_wrist",
    "right_thumb_0", "right_thumb_1", "right_thumb_2", "right_thumb_tip",
    "right_index_1", "right_index_2", "right_index_3", "right_index_tip",
    "right_middle_1", "right_middle_2", "right_middle_3", "right_middle_tip",
    "right_ring_1", "right_ring_2", "right_ring_3", "right_ring_tip",
    "right_pinky_1", "right_pinky_2", "right_pinky_3", "right_pinky_tip",
)

LEFT_HAND_CONTOUR_BONES = (
    "left_wrist",
    "left_thumb_0", "left_thumb_1", "left_thumb_2", "left_thumb_tip",
    "left_index_1", "left_index_2", "left_index_3", "left_index_tip",
    "left_middle_1", "left_middle_2", "left_middle_3", "left_middle_tip",
    "left_ring_1", "left_ring_2", "left_ring_3", "left_ring_tip",
    "left_pinky_1", "left_pinky_2", "left_pinky_3", "left_pinky_tip",
)


# ─── 工具函数 ───

def sub(a, b):
    return [a[i] - b[i] for i in range(3)]


def add(a, b):
    return [a[i] + b[i] for i in range(3)]


def mul(a, s):
    return [a[i] * s for i in range(3)]


def dot(a, b):
    return sum(a[i] * b[i] for i in range(3))


def length(v):
    return math.sqrt(dot(v, v))


def normalize(v):
    l = length(v)
    return [v[i] / l for i in range(3)] if l > 1e-10 else [0, 0, 0]


def normalize_quaternion(q):
    """Normalize an XYZW quaternion without dropping its scalar component."""
    norm = math.sqrt(sum(value * value for value in q[:4]))
    if norm <= 1e-10:
        return [0.0, 0.0, 0.0, 1.0]
    return [value / norm for value in q[:4]]


def cross(a, b):
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]


def quaternion_angle(a, b):
    """Shortest angular distance between two quaternions in radians."""
    if not a or not b or len(a) < 4 or len(b) < 4:
        return 0.0
    qa = normalize_quaternion(a)
    qb = normalize_quaternion(b)
    cosine = abs(sum(qa[index] * qb[index] for index in range(4)))
    cosine = max(-1.0, min(1.0, cosine))
    return 2.0 * math.acos(cosine)


def angle_between(a, b):
    """两向量夹角 (度)。"""
    na, nb = length(a), length(b)
    if na < 1e-8 or nb < 1e-8:
        return 0.0
    cos_a = max(-1.0, min(1.0, dot(a, b) / (na * nb)))
    return math.degrees(math.acos(cos_a))


def dist(a, b):
    return length(sub(a, b))


def evaluate_left_akimbo_hand_contour(wrist, hand_samples):
    """Evaluate the Eula-specific mesh-safe side-down akimbo contour."""
    if len(hand_samples) < 6:
        return {"valid": False, "mode": None, "available_bones": len(hand_samples)}

    min_x = min(pos[0] for pos in hand_samples)
    max_x = max(pos[0] for pos in hand_samples)
    min_y = min(pos[1] for pos in hand_samples)
    max_y = max(pos[1] for pos in hand_samples)
    min_z = min(pos[2] for pos in hand_samples)
    max_z = max(pos[2] for pos in hand_samples)
    finger_drop = wrist[1] - min_y
    x_span = max_x - min_x
    valid = (
        11.40 <= min_y <= 12.20
        and 13.00 <= max_y <= 13.95
        and 1.20 <= finger_drop <= 2.20
        and 1.45 <= min_x <= 2.05
        and 2.00 <= max_x <= 2.70
        and x_span <= 1.00
        and -1.80 <= min_z
        and max_z <= -0.55
    )
    return {
        "valid": valid,
        "mode": "side_down" if valid else None,
        "hand_x_range": [round(min_x, 3), round(max_x, 3)],
        "hand_y_range": [round(min_y, 3), round(max_y, 3)],
        "hand_z_range": [round(min_z, 3), round(max_z, 3)],
        "finger_drop": round(finger_drop, 3),
        "x_span": round(x_span, 3),
    }


def in_aabb(point, aabb):
    """点是否在 AABB 内 (含边界)。"""
    return (aabb["x"][0] <= point[0] <= aabb["x"][1] and
            aabb["y"][0] <= point[1] <= aabb["y"][1] and
            aabb["z"][0] <= point[2] <= aabb["z"][1])


def aabb_penetration(point, aabb):
    """点穿入 AABB 的深度 (0 = 在表面或外部)。"""
    if not in_aabb(point, aabb):
        return 0.0
    dx = min(point[0] - aabb["x"][0], aabb["x"][1] - point[0])
    dy = min(point[1] - aabb["y"][0], aabb["y"][1] - point[1])
    dz = min(point[2] - aabb["z"][0], aabb["z"][1] - point[2])
    return min(dx, dy, dz)


def front_depth(point):
    """计算点相对于躯干中心的前深度 (PMX 空间)。
    正值 = 在前方, 负值 = 在后方。"""
    torso_center = [0.0, 14.0, -0.5]
    rel = sub(point, torso_center)
    return dot(rel, list(FRONT_AXIS))


# ─── Gate 数据结构 ───

@dataclass
class GateResult:
    gate_id: str
    name: str
    priority: str  # P0 | P1
    status: str    # PASS | WARN | FAIL
    details: dict = field(default_factory=dict)
    fix_guide: str = ""


@dataclass
class AcceptanceReport:
    vmd_file: str
    overall: str = "PASS"
    gates: list[GateResult] = field(default_factory=list)

    def to_dict(self) -> dict:
        passed = sum(1 for g in self.gates if g.status == "PASS")
        warned = sum(1 for g in self.gates if g.status == "WARN")
        failed = sum(1 for g in self.gates if g.status == "FAIL")

        if failed > 0:
            self.overall = "FAIL"
        elif warned >= 3:
            self.overall = "WARN"
        else:
            self.overall = "PASS"

        return {
            "vmd_file": self.vmd_file,
            "overall": self.overall,
            "total_gates": len(self.gates),
            "passed": passed,
            "warned": warned,
            "failed": failed,
            "gates": {
                g.gate_id: {
                    "name": g.name,
                    "priority": g.priority,
                    "status": g.status,
                    "details": g.details,
                    "fix_guide": g.fix_guide,
                }
                for g in self.gates
            }
        }


# ─── Gate 实现 ───

def g1_coordinate_integrity(frames: list[dict]) -> GateResult:
    """G1: 坐标系完整性。"""
    violations = []

    for fi, frame in enumerate(frames):
        joints = frame.get("joints", {})
        for jname, jpos in joints.items():
            if not jpos or len(jpos) < 3:
                violations.append({"frame": fi, "joint": jname, "issue": "missing"})
                continue
            for ax, val in enumerate(jpos):
                if not math.isfinite(val):
                    violations.append({"frame": fi, "joint": jname, "issue": "non_finite"})
                    continue

            # 检查是否在全身包围盒内 (允许 2.0 余量)
            x, y, z = jpos[0], jpos[1], jpos[2]
            margin = 2.0
            if not (BODY_BOUNDS["x"][0] - margin <= x <= BODY_BOUNDS["x"][1] + margin):
                violations.append({"frame": fi, "joint": jname, "issue": "x_out_of_bounds", "value": x})

    status = "PASS" if not violations else "FAIL"
    fix = (
        "1. 检查 VMD 生成器是否有除零或 NaN 计算\n"
        "2. 确认 BVH→PMX 坐标映射公式: pmx = pmx_pelvis + (bvh - bvh_pelvis) * 8.54 * [1,1,-1]\n"
        "3. 检查骨骼段长度是否畸变 (上臂应≈3.0, 前臂≈2.6, 大腿≈5.2)\n"
        "4. 在 gen_v9e.py 中添加 assert 对每帧关节坐标做 isfinite 检查\n"
        "5. 排查 fk_world_model.py 的 FK 计算是否有 quaternion 归一化失败"
    )
    return GateResult("G1", "坐标系完整性", "P0", status,
                      {"violations": violations[:20], "total_violations": len(violations)}, fix)


def g2_bone_position(frames: list[dict]) -> GateResult:
    """G2: 骨骼位置合理性。"""
    position_limits = {
        "head":        {"y": (17.5, 22.5), "x": (-2.5, 2.5), "z": (-2.5, 1.5)},
        "right_wrist": {"y": (8.0, 21.0), "x": (-9.0, 3.0), "z": (-5.0, 3.0)},
        "left_wrist":  {"y": (8.0, 21.0), "x": (-3.0, 9.0), "z": (-4.0, 3.0)},
        "right_elbow": {"y": (9.0, 19.0), "x": (-9.0, 1.0), "z": (-4.0, 3.0)},
        "left_elbow":  {"y": (9.0, 19.0), "x": (-1.0, 9.0), "z": (-4.0, 3.0)},
        "right_ankle": {"y": (-1.5, 4.0), "x": (-2.5, 0.5), "z": (-2.5, 2.5)},
        "left_ankle":  {"y": (-1.5, 4.0), "x": (-0.5, 2.5), "z": (-2.0, 2.0)},
    }

    violations = []
    for fi, frame in enumerate(frames):
        joints = frame.get("joints", {})
        for jname, limits in position_limits.items():
            if jname not in joints:
                continue
            pos = joints[jname]
            for axis, (lo, hi) in limits.items():
                idx = {"x": 0, "y": 1, "z": 2}[axis]
                val = pos[idx]
                if not (lo <= val <= hi):
                    violations.append({
                        "frame": fi, "joint": jname, "axis": axis,
                        "value": round(val, 3), "range": [lo, hi]
                    })

    status = "PASS" if not violations else "FAIL"
    fix = (
        "1. 检查骨骼是否超出解剖学范围 (头Y应17.5-22.5, 手腕Y应8-21, 踝Y应-1.5-4)\n"
        "2. 确认 BVH→PMX 比例因子 8.54 是否正确 (torso scale)\n"
        "3. 检查 IK 求解器是否把手腕目标设到了模型外部\n"
        "4. 如果是 raise 阶段手腕过高: 降低 hold 目标 Y 值\n"
        "5. 如果是脚踝漂移: 检查 IK 脚踝锁定是否启用"
    )
    return GateResult("G2", "骨骼位置合理性", "P0", status,
                      {"violations": violations[:20], "total_violations": len(violations)}, fix)


def g3_collision(frames: list[dict]) -> GateResult:
    """G3: 碰撞检测 (穿模)。"""
    violations = []

    # 每帧允许的穿透深度
    collision_rules = [
        # (joint, body_part, max_penetration, allow_phase)
        ("right_wrist", "waist", 0.0, None),
        ("right_wrist", "mid_chest", 0.0, None),
        ("right_wrist", "upper_chest", 0.3, None),
        # Head: use front-surface check, not full AABB
        # Head front surface (nose) Z=-1.97, chin surface Z=-1.41
        # Hand touching face/chin has Z between -1.0 and -1.97 — NOT a penetration
        # Only flag as penetration if wrist goes DEEP into head (Z > -1.0, behind chin)
        ("right_wrist", "head", 0.0, None),  # will be handled specially below
        ("right_elbow", "waist", 0.0, None),
        ("right_elbow", "upper_chest", 0.2, None),
        ("left_wrist", "waist", 0.0, None),
        ("left_wrist", "mid_chest", 0.0, None),
        ("left_wrist", "upper_chest", 0.3, None),
        ("left_elbow", "waist", 0.0, None),
    ]

    for fi, frame in enumerate(frames):
        joints = frame.get("joints", {})
        is_hold = joints.get("right_wrist", [0, 0, 0])[1] > joints.get("right_shoulder", [0, 0, 0])[1]

        for joint_name, body_part, max_pen, _ in collision_rules:
            if joint_name not in joints:
                continue
            pos = joints[joint_name]
            aabb = COLLISION_BODIES[body_part]
            pen = aabb_penetration(pos, aabb)

            # Head: special handling — AABB is too conservative
            # Head AABB Z[-1.97, 0.95] covers nose to back-of-head
            # Hand at face/chin has Z between -1.0 and -1.97, which is AT the surface, not inside
            # Only flag if wrist penetrates deeper than chin surface (Z > -1.0 in head Y range)
            effective_max = max_pen
            if body_part == "head":
                HEAD_FRONT_Z = -1.97   # nose tip
                CHIN_SURFACE_Z = -1.0  # in front of chin, hand touching face is OK
                if joint_name in ("right_wrist", "left_wrist"):
                    # Only flag if wrist Z > CHIN_SURFACE_Z (deep inside head, behind chin)
                    if pos[2] > CHIN_SURFACE_Z and in_aabb(pos, aabb):
                        # Deep penetration: wrist is well inside head mesh
                        pen = pos[2] - CHIN_SURFACE_Z
                    else:
                        pen = 0.0  # Hand at face surface — not a penetration
                elif joint_name in ("right_elbow", "left_elbow"):
                    # Elbow should not be in head area at all
                    pass  # use default AABB check
                else:
                    pen = 0.0

            if pen > effective_max + 1e-6:
                violations.append({
                    "frame": fi, "joint": joint_name, "body_part": body_part,
                    "penetration": round(pen, 3), "limit": effective_max,
                    "phase": "hold" if is_hold else "non_hold"
                })

    status = "FAIL" if violations else "PASS"
    fix = (
        "G3 碰撞检测失败修复:\n"
        "1. 手腕穿入腰部/胸部: 在 gen_v9e.py 的 correct_arm_front_depth() 中增加前向推力\n"
        "   - raise 阶段: 手腕 Z 须 < -1.0 (躯干前表面)\n"
        "   - 手腕在腰部范围 (Y 11.6-13.9) 时: 推 Z 到 -2.0 以下\n"
        "   - 手腕在胸部范围 (Y 15.3-18.1) 时: 推 Z 到 -2.2 以下 (胸部前表面 Z=-2.11)\n"
        "2. 肘穿入躯干: 在 fk_world_model.py 的 apply_joint_limits() 中限制肘外偏\n"
        "   - 肘 X 不得进入躯干 X 范围 (|X| < 1.3 时需 Y < 13.9 或 > 18.1)\n"
        "3. hold 阶段手贴脸: 允许头部穿透 0.8, 超过则降低手腕 Z 偏移\n"
        "4. 使用 /tmp/vertex_collision.py 的 is_inside_mesh() 做精确顶点级碰撞检测替代 AABB\n"
        "5. 在 Stage 5 优先级约束中: 碰撞约束为最高优先级, 违反碰撞时 IK 目标应回退"
    )
    return GateResult("G3", "碰撞检测", "P0", status,
                      {"violations": violations[:20], "total_violations": len(violations)}, fix)


def g4_chin_distance(frames: list[dict]) -> GateResult:
    """G4: 下巴接触距离。"""
    # 找 hold 阶段。旧规则只用「右手腕 Y > 右肩 Y」，但托下巴动作中
    # 掌/指接触下巴时，腕点可以略低于肩；优先使用动作帧段识别。
    hold_distances = []
    worst = None
    worst_frame = -1

    default_chin_pos = CHIN_TIP

    for fi, frame in enumerate(frames):
        joints = frame.get("joints", {})
        if "right_wrist" not in joints or "right_shoulder" not in joints:
            continue
        wrist = joints["right_wrist"]
        shoulder = joints["right_shoulder"]
        if _is_thinking_hold_frame(fi, frame, len(frames)) or wrist[1] > shoulder[1]:
            # Head/neck pre-motion changes the chin position over time. Use the
            # per-frame rendered chin when available instead of freezing f0.
            chin_pos = joints.get("chin", default_chin_pos)
            d = dist(wrist, chin_pos)
            hold_distances.append(d)
            if worst is None or d > worst:
                worst = d
                worst_frame = fi

    if not hold_distances:
        return GateResult("G4", "下巴接触距离", "P1", "WARN",
                          {"reason": "no_hold_phase_detected"},
                          "1. 未检测到 hold 阶段 (默认应覆盖 f110-f210 或动作中 wrist_y > shoulder_y 的帧)\n"
                          "2. 检查渲染导出的 frame index 是否保留真实 VMD 帧号\n"
                          "3. 如果动作时长不是 0-240 帧，扩展 _is_thinking_hold_frame() 的阶段判定\n"
                          "4. 如果 BVH 动作幅度太小, 增大 TORSO_SCALE 或手动放大手臂 Y 位移")

    avg_dist = sum(hold_distances) / len(hold_distances)
    min_dist = min(hold_distances)

    if min_dist < 1.0:
        status, score = "PASS", 100
    elif min_dist <= 2.0:
        status, score = "PASS", 70
    elif min_dist <= 3.0:
        status, score = "WARN", 40
    else:
        status, score = "FAIL", 0

    fix = ""
    if status != "PASS":
        fix = (
            "G4 下巴接触距离修复:\n"
            f"1. 当前最小距离 {min_dist:.2f}, 目标 < 2.0\n"
            "2. 在 gen_v9e.py hold 阶段, 直接设定 IK 目标为下巴尖位置 [0, 18.87, -1.41]\n"
            "3. 增大 push 偏移: target_wrist_r += mul(front_pmx, 1.2) (当前 0.95)\n"
            "4. 检查 IK 求解器是否因臂展不足无法到达 (PMX 臂展 5.587, 目标距离可能超出)\n"
            "   - 如超出: 启用 Stage 6 躯干前倾补偿增加可达范围\n"
            "5. 下巴尖在头部网格内 (Z=-1.41, 头部前表面 Z=-1.97), 允许手腕穿入头部 0.5-0.8"
        )
    return GateResult("G4", "下巴接触距离", "P1", status, {
        "min_distance": round(min_dist, 3),
        "avg_distance": round(avg_dist, 3),
        "worst_frame": worst_frame,
        "chin_source": "per_frame" if any("chin" in frame.get("joints", {}) for frame in frames) else "default",
        "score": score,
    }, fix)


def g5_joint_angles(frames: list[dict]) -> GateResult:
    """G5: 关节角度限制。"""
    violations = []

    for fi, frame in enumerate(frames):
        joints = frame.get("joints", {})

        # 右肘
        if all(k in joints for k in ("right_shoulder", "right_elbow", "right_wrist")):
            upper = sub(joints["right_shoulder"], joints["right_elbow"])
            lower = sub(joints["right_wrist"], joints["right_elbow"])
            angle = angle_between(upper, lower)
            lo, hi = JOINT_LIMITS["elbow"]
            if angle < lo or angle > hi:
                violations.append({"frame": fi, "joint": "right_elbow", "angle": round(angle, 1), "limits": [lo, hi]})

        # 左肘
        if all(k in joints for k in ("left_shoulder", "left_elbow", "left_wrist")):
            upper = sub(joints["left_shoulder"], joints["left_elbow"])
            lower = sub(joints["left_wrist"], joints["left_elbow"])
            angle = angle_between(upper, lower)
            lo, hi = JOINT_LIMITS["elbow"]
            if angle < lo or angle > hi:
                violations.append({"frame": fi, "joint": "left_elbow", "angle": round(angle, 1), "limits": [lo, hi]})

        # 右膝
        if all(k in joints for k in ("right_hip", "right_knee", "right_ankle")):
            upper = sub(joints["right_hip"], joints["right_knee"])
            lower = sub(joints["right_ankle"], joints["right_knee"])
            angle = angle_between(upper, lower)
            lo, hi = JOINT_LIMITS["knee"]
            if angle < lo or angle > hi:
                violations.append({"frame": fi, "joint": "right_knee", "angle": round(angle, 1), "limits": [lo, hi]})

    status = "FAIL" if violations else "PASS"
    fix = ""
    if violations:
        # 分析违规类型
        elbow_violations = [v for v in violations if "elbow" in v.get("joint", "")]
        knee_violations = [v for v in violations if "knee" in v.get("joint", "")]
        too_small = [v for v in violations if v.get("angle", 180) < v.get("limits", [0,0])[0]]
        too_large = [v for v in violations if v.get("angle", 0) > v.get("limits", [0,0])[1]]
        fix = (
            "G5 关节角度限制修复:\n"
            f"1. 总违规 {len(violations)} 次, 肘 {len(elbow_violations)} / 膝 {len(knee_violations)}\n"
            f"   角度过小 {len(too_small)} 次 / 角度过大 {len(too_large)} 次\n"
        )
        if too_small:
            fix += (
                "2. 关节角度过小 (过度弯曲):\n"
                "   - 在 fk_world_model.py 的 clamp_elbow_angle() 中提高最小角限制\n"
                "   - 肘最小角当前 20°, 思考动作建议提高到 60°\n"
                "   - 检查 IK 求解器是否把目标设得太近导致手臂折叠\n"
            )
        if too_large:
            fix += (
                "3. 关节角度过大 (过度伸直):\n"
                "   - 在 clamp_elbow_angle() 中降低最大角限制 (当前 175°)\n"
                "   - 思考动作肘角应在 90°-130°, 限制 max_elbow=140°\n"
                "   - 检查 IK 目标距离是否过远导致手臂伸直\n"
            )
        fix += (
            "4. 角度计算: 肘角 = arccos(dot(上臂向量, 下臂向量) / (|上臂|*|下臂|))\n"
            "5. 在 apply_priority_constraints() 中, 关节限制优先级高于 IK 目标"
        )
    return GateResult("G5", "关节角度限制", "P0", status,
                      {"violations": violations[:20], "total_violations": len(violations)}, fix)


def g6_smoothness(frames: list[dict]) -> GateResult:
    """G6: 运动平滑度。

    Prefer exported local bone quaternions. Older position-only reports fall
    back to wrist/elbow world-space speed so historical evidence remains usable.
    """
    violations = []
    rotation_groups = {
        "right_upper_arm": "upper_arm",
        "left_upper_arm": "upper_arm",
        "right_elbow": "forearm",
        "left_elbow": "forearm",
        "right_forearm_twist": "forearm",
        "left_forearm_twist": "forearm",
        "right_wrist": "wrist",
        "left_wrist": "wrist",
    }
    position_groups = {
        "right_wrist": "upper_arm",
        "left_wrist": "upper_arm",
        "right_elbow": "forearm",
        "left_elbow": "forearm",
    }
    has_rotations = any(frame.get("rotations") for frame in frames)
    groups = rotation_groups if has_rotations else position_groups
    max_velocities = {name: 0.0 for name in groups}
    max_accels = {name: 0.0 for name in groups}
    max_jerks = {name: 0.0 for name in groups}
    prev_velocities: dict[str, float | None] = {name: None for name in groups}
    prev_accels: dict[str, float | None] = {name: None for name in groups}

    for fi in range(1, len(frames)):
        previous = frames[fi - 1]
        current = frames[fi]
        dt = max(1.0, float(current.get("index", fi) - previous.get("index", fi - 1)))
        previous_values = previous.get("rotations" if has_rotations else "joints", {})
        current_values = current.get("rotations" if has_rotations else "joints", {})

        for name, group in groups.items():
            if name not in previous_values or name not in current_values:
                continue
            if has_rotations:
                velocity = quaternion_angle(previous_values[name], current_values[name]) / dt
                velocity_limit = MAX_ANGULAR_VELOCITY[group]
                acceleration_limit = MAX_ANGULAR_ACCELERATION[group]
                jerk_limit = MAX_ANGULAR_JERK[group]
            else:
                velocity = dist(previous_values[name], current_values[name]) / dt
                velocity_limit = 0.18 if group == "upper_arm" else 0.22
                acceleration_limit = 0.010 if group == "upper_arm" else 0.014
                jerk_limit = 0.004 if group == "upper_arm" else 0.006

            max_velocities[name] = max(max_velocities[name], velocity)
            if velocity > velocity_limit:
                violations.append({
                    "frame": current.get("index", fi),
                    "joint": name,
                    "velocity": round(velocity, 5),
                    "limit": velocity_limit,
                    "type": "velocity",
                })

            previous_velocity = prev_velocities[name]
            if previous_velocity is not None:
                acceleration = abs(velocity - previous_velocity) / dt
                max_accels[name] = max(max_accels[name], acceleration)
                if acceleration > acceleration_limit:
                    violations.append({
                        "frame": current.get("index", fi),
                        "joint": name,
                        "acceleration": round(acceleration, 5),
                        "limit": acceleration_limit,
                        "type": "acceleration",
                    })

                previous_acceleration = prev_accels[name]
                if previous_acceleration is not None:
                    jerk = abs(acceleration - previous_acceleration) / dt
                    max_jerks[name] = max(max_jerks[name], jerk)
                    if jerk > jerk_limit:
                        violations.append({
                            "frame": current.get("index", fi),
                            "joint": name,
                            "jerk": round(jerk, 5),
                            "limit": jerk_limit,
                            "type": "jerk",
                        })
                prev_accels[name] = acceleration
            prev_velocities[name] = velocity

    status = "WARN" if violations else "PASS"
    fix = ""
    if violations:
        worst_vel = max(v.get("velocity", 0) for v in violations if v.get("type") == "velocity") if any(v.get("type") == "velocity" for v in violations) else 0
        fix = (
            "G6 运动平滑度修复:\n"
            f"1. 最大每帧速度 {worst_vel:.3f}，检查 velocity/acceleration/jerk 明细。\n"
            "2. 在 fk_world_model.py 的 apply_motion_smoothing() 中:\n"
            "   - 降低 max_angular_velocity: 上臂 0.25→0.15, 前臂 0.35→0.25\n"
            "   - 增加平滑次数: 从 2 次提高到 3 次\n"
            "3. 检查 VMD 帧间距是否不均匀 (BVH 20fps → VMD 30fps 可能跳帧)\n"
            "4. 在非均匀帧间距处使用自适应限速: dt = frame_times[i] - frame_times[i-1]\n"
            "5. 加速度违规: 在 apply_motion_smoothing() 第二阶段增加 jerk 限制\n"
            "6. 如果是 raise→hold 转折处抖动: 在阶段切换帧附近添加 3-5 帧缓动"
        )
    return GateResult("G6", "运动平滑度", "P1", status, {
        "mode": "quaternion" if has_rotations else "position_fallback",
        "max_velocities": {k: round(v, 4) for k, v in max_velocities.items()},
        "max_accelerations": {k: round(v, 4) for k, v in max_accels.items()},
        "max_jerks": {k: round(v, 4) for k, v in max_jerks.items()},
        "violations": violations[:20],
        "total_violations": len(violations),
    }, fix)


def g7_left_arm(frames: list[dict], left_arm_policy: str = "down") -> GateResult:
    """G7: 左臂约束。

    Policies:
    - down: single-hand thinking action, left arm hangs naturally.
    - support: elegant/reference thinking action, left arm supports in front of waist/chest.
    - akimbo: thinking action with the left hand placed on the left waist/hip side.
    - skip: skip left-arm semantic checks.
    """
    if left_arm_policy == "skip":
        return GateResult("G7", "左臂约束", "P1", "PASS",
                          {"policy": left_arm_policy, "reason": "skipped_by_policy"})

    violations = []
    akimbo_modes = []

    for fi, frame in enumerate(frames):
        joints = frame.get("joints", {})
        if "left_wrist" not in joints or "left_shoulder" not in joints:
            continue
        if "left_elbow" not in joints:
            continue

        lw = joints["left_wrist"]
        ls = joints["left_shoulder"]
        le = joints["left_elbow"]

        # 左手腕不应高于左肩
        if lw[1] > ls[1]:
            violations.append({"frame": fi, "issue": "left_wrist_above_shoulder", "wrist_y": round(lw[1], 2), "shoulder_y": round(ls[1], 2)})

        upper = sub(ls, le)
        lower = sub(lw, le)
        angle = angle_between(upper, lower)

        if left_arm_policy == "support":
            # 支撑/抱臂式思考动作允许左手越过中线，但必须在腰胸前方，
            # 且保持弯肘支撑，而不是举高、后插或完全折叠。
            if not (11.0 <= lw[1] <= 16.0):
                violations.append({"frame": fi, "issue": "left_support_y_out_of_range", "wrist_y": round(lw[1], 2), "limits": [11.0, 16.0]})
            fd = front_depth(lw)
            if fd < 0.0:
                violations.append({"frame": fi, "issue": "left_support_behind_torso", "front_depth": round(fd, 3), "limit": 0.0})
            if angle < 55.0 or angle > 150.0:
                violations.append({"frame": fi, "issue": "left_support_elbow_angle", "angle": round(angle, 1), "limits": [55.0, 150.0]})
        elif left_arm_policy == "akimbo":
            # 叉腰只要求 hold 阶段稳定进入左腰/髋侧。抬手过渡阶段仍允许从自然下垂过渡。
            frame_index = frame.get("index", fi)
            if isinstance(frame_index, (int, float)):
                is_akimbo_stable = 150 <= frame_index <= 210
            else:
                is_akimbo_stable = len(frames) * 0.62 <= fi <= len(frames) * 0.90
            report_frame = frame_index if isinstance(frame_index, (int, float)) else fi
            if not is_akimbo_stable:
                continue
            if not (13.0 <= lw[1] <= 13.95):
                violations.append({"frame": report_frame, "issue": "left_akimbo_y_out_of_range", "wrist_y": round(lw[1], 2), "limits": [13.0, 13.95]})
            if not (2.0 <= lw[0] <= 2.65):
                violations.append({"frame": report_frame, "issue": "left_akimbo_x_not_on_waist_side", "wrist_x": round(lw[0], 2), "limits": [2.0, 2.65]})
            if not (-1.25 <= lw[2] <= -0.55):
                violations.append({"frame": report_frame, "issue": "left_akimbo_z_not_side_waist", "wrist_z": round(lw[2], 2), "limits": [-1.25, -0.55]})
            if le[0] < lw[0] + 1.0:
                violations.append({"frame": report_frame, "issue": "left_akimbo_elbow_not_outward", "elbow_x": round(le[0], 2), "wrist_x": round(lw[0], 2), "min_delta": 1.0})
            if angle < 70.0 or angle > 120.0:
                violations.append({"frame": report_frame, "issue": "left_akimbo_elbow_angle", "angle": round(angle, 1), "limits": [70.0, 120.0]})

            hand_samples = [joints[bone] for bone in LEFT_HAND_CONTOUR_BONES if bone in joints]
            if len(hand_samples) < 6:
                violations.append({"frame": report_frame, "issue": "left_akimbo_missing_hand_contour", "available_bones": len(hand_samples), "required_min": 6})
            else:
                contour = evaluate_left_akimbo_hand_contour(lw, hand_samples)
                if contour["valid"]:
                    akimbo_modes.append({"frame": report_frame, **{key: value for key, value in contour.items() if key != "valid"}})
                else:
                    violations.append({
                        "frame": report_frame,
                        "issue": "left_akimbo_hand_contour_not_mesh_safe",
                        "wrist_y": round(lw[1], 3),
                        **{key: value for key, value in contour.items() if key not in {"valid", "mode"}},
                        "required_mode": "side_down",
                        "limits": {
                            "min_y": [11.40, 12.20],
                            "max_y": [13.00, 13.95],
                            "finger_drop": [1.20, 2.20],
                            "min_x": [1.45, 2.05],
                            "max_x": [2.00, 2.70],
                            "x_span_max": 1.00,
                            "z": [-1.80, -0.55],
                        },
                    })
        else:
            # 左手腕应在身体左侧
            if lw[0] < 0:
                violations.append({"frame": fi, "issue": "left_wrist_right_of_center", "x": round(lw[0], 2)})

            # 左肘角度 (应接近伸直)
            if angle < 150.0:
                violations.append({"frame": fi, "issue": "left_elbow_bent", "angle": round(angle, 1)})

    if left_arm_policy == "akimbo" and violations:
        status = "FAIL"
    else:
        status = "WARN" if len(violations) > 3 else "PASS"
    fix = ""
    if violations:
        raised = [v for v in violations if v.get("issue") == "left_wrist_above_shoulder"]
        cross = [v for v in violations if v.get("issue") == "left_wrist_right_of_center"]
        bent = [v for v in violations if v.get("issue") == "left_elbow_bent"]
        fix = "G7 左臂约束修复:\n"
        if left_arm_policy == "support":
            fix += (
                "1. 当前策略为 left_arm_policy=support，左臂允许腰前支撑/抱臂，但必须满足:\n"
                "   - 左手腕 Y 在 11.0-16.0 PMX 单位\n"
                "   - 左手腕 front_depth >= 0.0\n"
                "   - 左肘角 55°-150°\n"
                "2. 如果这是单手下垂动作，改用 --left-arm-policy down 并修正左臂目标。\n"
            )
            support_bad = [v for v in violations if v.get("issue", "").startswith("left_support")]
            if support_bad:
                fix += f"3. 支撑姿态违规 {len(support_bad)} 帧: 检查左手腕是否离开腰胸前支撑区。\n"
        if left_arm_policy == "akimbo":
            fix += (
                "1. 当前策略为 left_arm_policy=akimbo，左手必须在 hold 阶段形成叉腰:\n"
                "   - 左手腕 X 在 2.0-2.65，位于左腰外侧接触点\n"
                "   - 左手腕 Y 在 13.0-13.95，压在腰线而不是髋/大腿侧\n"
                "   - 左手腕 Z 在 -1.25--0.55，贴腰侧前缘\n"
                "   - 左肘 X 至少比左手腕更外侧 1.0，形成外张肘\n"
                "   - 左肘角 70°-120°，接近 reference 叉腰肘角\n"
                "   - 手指采用 side_down 模式沿髋部向下，不能横向插入腰身\n"
                "   - 手部 Y: min 11.40-12.20, max 13.00-13.95, 指尖下垂量 1.20-2.20\n"
                "   - 手部 X: min 1.45-2.05, max 2.00-2.70, 横向跨度 <= 1.00\n"
                "   - 手部 Z 全部位于 -1.80--0.55；Blender PMX 网格逐帧 overlap 必须为 0\n"
                "2. 修复方式: 先调 left_hold_wrist/left_hold_elbow，再调左手首 Z 旋转；不要把手指横向压进腰部。\n"
            )
        if raised:
            fix += (
                f"1. 左手腕举过肩 {len(raised)} 帧:\n"
                "   - 在 gen_v9e.py 中检查左臂是否被错误地镜像了右臂 IK 目标\n"
                "   - 左臂不应应用下巴 IK 目标, 左臂应保持 T-pose 或自然下垂\n"
                "   - 修复: fabrik_two_bone_ik() 调用时 arm_side='left' 不传入 chin target\n"
            )
        if cross:
            fix += (
                f"2. 左手腕越过身体中线 {len(cross)} 帧:\n"
                "   - 左手腕 X 应 > 0 (身体左侧)\n"
                "   - 在 retargeter 中检查左臂 X 坐标是否被错误取反\n"
            )
        if bent:
            fix += (
                f"3. 左肘弯曲 {len(bent)} 帧:\n"
                "   - 思考动作左手应自然下垂, 肘角 150°-180°\n"
                "   - 在 gen_v9e.py 中对左臂不施加 IK, 保留 BVH 原始旋转\n"
            )
        fix += "4. 如果 BVH 源动作本身左手有动作 (如双手动作), 可用 --left-arm-policy support、akimbo 或 skip"
    priority = "P0" if left_arm_policy == "akimbo" else "P1"
    return GateResult("G7", "左臂约束", priority, status, {
        "policy": left_arm_policy,
        "accepted_modes": ["side_down"] if left_arm_policy == "akimbo" else [],
        "observed_modes": akimbo_modes,
        "violations": violations[:20],
        "total_violations": len(violations),
    }, fix)


def g8_front_depth(frames: list[dict]) -> GateResult:
    """G8: 前深度保持。"""
    violations = []

    for fi, frame in enumerate(frames):
        joints = frame.get("joints", {})
        if "right_wrist" not in joints:
            continue
        wrist = joints["right_wrist"]
        fd = front_depth(wrist)

        # 判断阶段 (阈值用 front_depth 正值=前方)
        total = len(frames)
        if fi < total * 0.45:  # raise: 手腕须在躯干前方
            threshold = 0.0
            phase = "raise"
        elif fi < total * 0.80:  # hold: 手腕须明显在前方
            threshold = 0.5
            phase = "hold"
        else:  # release: 手腕须在躯干前方
            threshold = 0.0
            phase = "release"

        if fd < threshold:
            violations.append({
                "frame": fi, "phase": phase, "front_depth": round(fd, 3),
                "threshold": threshold, "wrist_pos": [round(v, 2) for v in wrist]
            })

    status = "FAIL" if violations else "PASS"
    fix = ""
    if violations:
        worst = min(v["front_depth"] for v in violations) if violations else 0
        fix = (
            "G8 前深度保持修复:\n"
            f"1. 最差前深度 {worst:.3f}, 须 > 0.0 (raise/release) 或 > 0.5 (hold)\n"
            "2. 前深度 = dot(wrist - torso_center, (0, 0.14, -0.99)), 正值=前方\n"
            "3. 在 gen_v9e.py 的 correct_arm_front_depth() 中:\n"
            "   - raise 阶段: 手腕 Z 须 < -0.5 (front_depth > 0)\n"
            "   - hold 阶段: 手腕 Z 须 < -1.0 (front_depth > 0.5)\n"
            "   - 修正方式: wrist_z = min(wrist_z, phase_threshold)\n"
            "4. 检查 front_axis 是否被错误地用了渲染空间值 (0, 0.14, 0.99)\n"
            "   PMX 空间应为 (0, 0.14, -0.99), Z- = 前方\n"
            "5. 如果 IK 求解后手腕向后偏: 检查 shoulder→elbow→wrist 运动链\n"
            "   上臂向→前臂向的点积是否为正 (正=向前)"
        )
    return GateResult("G8", "前深度保持", "P0", status,
                      {"violations": violations[:20], "total_violations": len(violations)}, fix)


def g9_stance_stability(frames: list[dict]) -> GateResult:
    """G9: 站姿稳定性。"""
    violations = []

    if len(frames) < 2:
        return GateResult("G9", "站姿稳定性", "P1", "PASS", {"reason": "insufficient_frames"})

    first = frames[0].get("joints", {})
    last = frames[-1].get("joints", {})

    for side in ("right", "left"):
        ankle_key = f"{side}_ankle"
        if ankle_key not in first or ankle_key not in last:
            continue
        d = dist(first[ankle_key], last[ankle_key])
        if d > 0.3:
            violations.append({"joint": ankle_key, "drift": round(d, 3), "limit": 0.3})

        dy = abs(first[ankle_key][1] - last[ankle_key][1])
        if dy > 0.2:
            violations.append({"joint": ankle_key, "y_change": round(dy, 3), "limit": 0.2, "issue": "heel_lift"})

    status = "WARN" if violations else "PASS"
    fix = ""
    if violations:
        fix = (
            "G9 站姿稳定性修复:\n"
            "1. 脚踝位移超 0.3: 检查下半身 IK 是否锁定脚踝\n"
            "2. 在 gen_v9e.py 中确保右足首/左足首骨骼旋转帧为全零 (不动脚)\n"
            "3. 脚踝 Y 变化 (踮脚): 检查右足首D/左足首D 是否有错误旋转\n"
            "4. T-pose 基准: 右踝 [-0.757, 1.780, 0.118], 左踝 [0.757, 1.788, 0.118]\n"
            "5. 如果是全身平移漂移: 检查全ての親 (骨1) 是否有不需要的位移帧"
        )
    return GateResult("G9", "站姿稳定性", "P1", status,
                      {"violations": violations, "tpose_ankles": TPOSE_ANKLES}, fix)


def g10_fk_ik_consistency(frames: list[dict], fk_frames: list[dict] | None = None) -> GateResult:
    """G10: FK/IK 一致性。"""
    if not fk_frames:
        return GateResult("G10", "FK/IK一致性", "P1", "PASS",
                          {"reason": "no_fk_data_skipped"})

    violations = []
    min_len = min(len(frames), len(fk_frames))

    for fi in range(min_len):
        ik_j = frames[fi].get("joints", {})
        fk_j = fk_frames[fi].get("joints", {})

        if "right_wrist" in ik_j and "right_wrist" in fk_j:
            d = dist(ik_j["right_wrist"], fk_j["right_wrist"])
            if d > 1.0:
                violations.append({"frame": fi, "joint": "right_wrist", "fk_ik_diff": round(d, 3), "limit": 1.0})

    status = "WARN" if violations else "PASS"
    fix = ""
    if violations:
        worst = max(v.get("fk_ik_diff", 0) for v in violations) if violations else 0
        fix = (
            "G10 FK/IK一致性修复:\n"
            f"1. FK 与 IK 最大偏差 {worst:.3f}, 须 < 1.0\n"
            "2. 在 fk_world_model.py 中检查 FABRIK 求解器收敛条件:\n"
            "   - max_iterations 是否足够 (当前 10, 提高到 20)\n"
            "   - tolerance 是否太松 (当前 0.01, 收紧到 0.001)\n"
            "3. 检查 FK 模型是否使用了与 IK 相同的骨骼长度 (上臂 3.009, 前臂 2.578)\n"
            "4. 如果 FK 手腕在 IK 目标后方: 检查 fk_arm_chain() 的旋转矩阵\n"
            "   - 确认 arm_side 参数正确传递 (左/右臂偏移不同)\n"
            "5. 在 gen_v9e.py 中, IK 求解后用 FK 验证, 如果偏差 > 1.0 则回退到上一帧"
        )
    return GateResult("G10", "FK/IK一致性", "P1", status,
                      {"violations": violations[:20], "total_violations": len(violations)}, fix)


def _is_thinking_hold_frame(fi: int, frame: dict, total: int) -> bool:
    """Detect the semantic hold phase for generated thinking motions."""
    frame_index = frame.get("index", fi)
    if isinstance(frame_index, (int, float)) and frame_index >= 100:
        return 110 <= frame_index <= 210
    return total * 0.45 <= fi <= total * 0.90


def g11_hand_contour_height(frames: list[dict]) -> GateResult:
    """G11: 右手视觉轮廓高度。

    只检查思考动作 hold 阶段。G4 只看右手腕到下巴距离，不能覆盖手掌、
    指节、手套等视觉轮廓；G11 用手腕 + 右手所有指骨/指尖的最高 Y 做代理。
    """
    violations = []
    hold_frames = 0
    missing_frames = []
    target_max_y = CHIN_SURFACE[1] - HAND_CONTOUR_CHIN_CLEARANCE
    worst = None

    for fi, frame in enumerate(frames):
        if not _is_thinking_hold_frame(fi, frame, len(frames)):
            continue
        hold_frames += 1
        joints = frame.get("joints", {})
        samples = []
        for bone_name in RIGHT_HAND_CONTOUR_BONES:
            pos = joints.get(bone_name)
            if pos and len(pos) >= 3:
                samples.append((bone_name, pos))

        # rendered_bone_frames.json 应包含完整手指骨。缺失时不能证明轮廓安全。
        if len(samples) < 6:
            missing_frames.append({
                "frame": frame.get("index", fi),
                "available_bones": len(samples),
                "required_min": 6,
            })
            continue

        max_bone, max_pos = max(samples, key=lambda item: item[1][1])
        excess = max_pos[1] - target_max_y
        record = {
            "frame": frame.get("index", fi),
            "bone": max_bone,
            "max_y": round(max_pos[1], 3),
            "limit_y": round(target_max_y, 3),
            "excess": round(excess, 3),
            "wrist_y": round(joints.get("right_wrist", [0, 0, 0])[1], 3),
        }
        if worst is None or record["excess"] > worst["excess"]:
            worst = record
        if excess > 1e-6:
            violations.append(record)

    if hold_frames == 0:
        return GateResult("G11", "手部轮廓高度", "P0", "FAIL",
                          {"reason": "no_hold_phase_detected"},
                          "G11 手部轮廓高度修复:\n"
                          "1. 未检测到思考动作 hold 阶段，无法证明手部轮廓安全。\n"
                          "2. 确认渲染导出的 rendered_bone_frames.json 覆盖 f110-f210。\n"
                          "3. 如果动作时长不同，先扩展 _is_thinking_hold_frame() 的阶段判定。")

    if missing_frames:
        return GateResult("G11", "手部轮廓高度", "P0", "FAIL", {
            "reason": "insufficient_hand_contour_bones",
            "missing_frames": missing_frames[:20],
            "total_missing_frames": len(missing_frames),
            "required_bones": list(RIGHT_HAND_CONTOUR_BONES),
        }, "G11 手部轮廓高度修复:\n"
           "1. 重新使用 render_action_4view.mjs 导出骨骼帧，必须包含右手腕和右手指骨/指尖。\n"
           "2. 不要只用主骨骼 JSON 跑最终验收，否则无法检测手掌/手指轮廓。\n"
           "3. 确认 BONE_NAME_MAP 包含右手指骨日文名到标准名的映射。")

    status = "FAIL" if violations else "PASS"
    fix = ""
    if violations:
        worst_excess = max(v["excess"] for v in violations)
        fix = (
            "G11 手部轮廓高度修复:\n"
            f"1. hold 阶段最高右手代理点超出下巴安全线，最严重超出 {worst_excess:.3f} PMX。\n"
            f"2. 目标: max(右手腕+右手指骨/指尖 Y) <= 下巴表面Y {CHIN_SURFACE[1]:.2f} - {HAND_CONTOUR_CHIN_CLEARANCE:.2f} = {target_max_y:.2f}。\n"
            "3. 优先降低右手 hold IK 目标 Y，降低量至少为 worst_excess + 0.10 PMX。\n"
            "4. 同时调整右手腕旋转，避免掌背/指节上翻；不要把手腕向头部后方推来换取通过。\n"
            "5. 修复后重渲染 rendered_bone_frames.json，并重新运行 motion_acceptance_gate.py。"
        )

    return GateResult("G11", "手部轮廓高度", "P0", status, {
        "chin_surface_y": CHIN_SURFACE[1],
        "required_clearance": HAND_CONTOUR_CHIN_CLEARANCE,
        "limit_y": round(target_max_y, 3),
        "hold_frames": hold_frames,
        "worst": worst,
        "violations": violations[:20],
        "total_violations": len(violations),
    }, fix)


def g12_right_thinking_semantics(frames: list[dict]) -> GateResult:
    """G12: 右手托下巴语义。

    G3/G11 can prove the hand is safe, but not that the pose reads as a natural
    thinking gesture. This gate checks the stable hold phase for an opened right
    elbow arc and a real hand-contour contact near the chin.
    """
    violations = []
    stable_frames = 0
    best_contact = None
    worst_angle = None

    for fi, frame in enumerate(frames):
        frame_index = frame.get("index", fi)
        if isinstance(frame_index, (int, float)):
            is_stable = 150 <= frame_index <= 210
            report_frame = frame_index
        else:
            is_stable = len(frames) * 0.62 <= fi <= len(frames) * 0.90
            report_frame = fi
        if not is_stable:
            continue

        joints = frame.get("joints", {})
        required = ("right_shoulder", "right_elbow", "right_wrist")
        if not all(key in joints for key in required):
            violations.append({"frame": report_frame, "issue": "missing_right_arm_chain"})
            continue

        stable_frames += 1
        shoulder = joints["right_shoulder"]
        elbow = joints["right_elbow"]
        wrist = joints["right_wrist"]
        chin = joints.get("chin", CHIN_TIP)
        elbow_angle = angle_between(sub(shoulder, elbow), sub(wrist, elbow))
        wrist_chin = dist(wrist, chin)
        samples = [(bone, joints[bone]) for bone in RIGHT_HAND_CONTOUR_BONES if bone in joints]
        if len(samples) < 6:
            violations.append({
                "frame": report_frame,
                "issue": "missing_right_hand_contour",
                "available_bones": len(samples),
                "required_min": 6,
            })
            continue

        nearest_bone, nearest_pos = min(samples, key=lambda item: dist(item[1], chin))
        hand_chin = dist(nearest_pos, chin)
        record = {
            "frame": report_frame,
            "elbow_angle": round(elbow_angle, 1),
            "wrist_chin_distance": round(wrist_chin, 3),
            "nearest_hand_bone": nearest_bone,
            "nearest_hand_chin_distance": round(hand_chin, 3),
            "right_elbow_x": round(elbow[0], 3),
        }
        if best_contact is None or hand_chin < best_contact["nearest_hand_chin_distance"]:
            best_contact = record
        if worst_angle is None or elbow_angle < worst_angle["elbow_angle"]:
            worst_angle = record

        lo_angle, hi_angle = RIGHT_THINKING_ELBOW_ANGLE
        if not (lo_angle <= elbow_angle <= hi_angle):
            violations.append({**record, "issue": "right_elbow_folded_or_too_open", "limits": [lo_angle, hi_angle]})

        lo_wrist, hi_wrist = RIGHT_THINKING_WRIST_CHIN_DISTANCE
        if not (lo_wrist <= wrist_chin <= hi_wrist):
            violations.append({**record, "issue": "right_wrist_chin_distance_unstable", "limits": [lo_wrist, hi_wrist]})

        if hand_chin > RIGHT_THINKING_HAND_CHIN_DISTANCE_MAX:
            violations.append({**record, "issue": "right_hand_not_reading_as_chin_contact", "limit": RIGHT_THINKING_HAND_CHIN_DISTANCE_MAX})

        lo_x, hi_x = RIGHT_THINKING_ELBOW_X_RANGE
        if not (lo_x <= elbow[0] <= hi_x):
            violations.append({**record, "issue": "right_elbow_too_far_out_or_in", "limits": [lo_x, hi_x]})

    if stable_frames == 0:
        return GateResult("G12", "右手托下巴语义", "P0", "FAIL",
                          {"reason": "no_stable_thinking_hold_frames"},
                          "G12 右手托下巴语义修复:\n"
                          "1. rendered_bone_frames.json 必须覆盖稳定 hold 段 f150-f210。\n"
                          "2. 如果动作时长不是 0-240，先扩展 G12 的稳定段识别。")

    status = "FAIL" if violations else "PASS"
    fix = ""
    if violations:
        fix = (
            "G12 右手托下巴语义修复:\n"
            f"1. 稳定段右肘角应在 {RIGHT_THINKING_ELBOW_ANGLE[0]:.0f}°-{RIGHT_THINKING_ELBOW_ANGLE[1]:.0f}°，"
            "低于下限会读成右臂硬折叠。\n"
            f"2. 右腕到下巴距离应在 {RIGHT_THINKING_WRIST_CHIN_DISTANCE[0]:.1f}-{RIGHT_THINKING_WRIST_CHIN_DISTANCE[1]:.1f} PMX；"
            "腕点贴得太近会迫使前臂折叠，太远则失去托下巴语义。\n"
            f"3. 至少一个右手轮廓代理点到下巴距离 <= {RIGHT_THINKING_HAND_CHIN_DISTANCE_MAX:.2f} PMX；"
            "如果失败，优先调整手首旋转和手指 profile，而不是把整个腕点推到脸里。\n"
            f"4. 右肘 X 应在 {RIGHT_THINKING_ELBOW_X_RANGE[0]:.1f}-{RIGHT_THINKING_ELBOW_X_RANGE[1]:.1f}，"
            "防止肘部外翻到身体侧面造成硬折。"
        )

    return GateResult("G12", "右手托下巴语义", "P0", status, {
        "stable_frames": stable_frames,
        "elbow_angle_limits": list(RIGHT_THINKING_ELBOW_ANGLE),
        "wrist_chin_distance_limits": list(RIGHT_THINKING_WRIST_CHIN_DISTANCE),
        "hand_chin_distance_limit": RIGHT_THINKING_HAND_CHIN_DISTANCE_MAX,
        "right_elbow_x_limits": list(RIGHT_THINKING_ELBOW_X_RANGE),
        "best_contact": best_contact,
        "worst_angle": worst_angle,
        "violations": violations[:20],
        "total_violations": len(violations),
    }, fix)


def g13_right_arm_anatomy(frames: list[dict]) -> GateResult:
    """G13: 右臂解剖学自然度。

    G12 proves the gesture reads as chin support. G13 proves the stable arm
    chain is not solving that gesture by collapsing the elbow into a hard fold.
    """
    violations = []
    stable_frames = 0
    worst_angle = None
    shortest_reach = None

    for fi, frame in enumerate(frames):
        frame_index = frame.get("index", fi)
        if isinstance(frame_index, (int, float)):
            is_stable = 150 <= frame_index <= 210
            report_frame = frame_index
        else:
            is_stable = len(frames) * 0.62 <= fi <= len(frames) * 0.90
            report_frame = fi
        if not is_stable:
            continue

        joints = frame.get("joints", {})
        required = ("right_shoulder", "right_elbow", "right_wrist")
        if not all(key in joints for key in required):
            violations.append({"frame": report_frame, "issue": "missing_right_arm_chain"})
            continue

        stable_frames += 1
        shoulder = joints["right_shoulder"]
        elbow = joints["right_elbow"]
        wrist = joints["right_wrist"]
        elbow_angle = angle_between(sub(shoulder, elbow), sub(wrist, elbow))
        shoulder_wrist = dist(shoulder, wrist)
        record = {
            "frame": report_frame,
            "elbow_angle": round(elbow_angle, 1),
            "shoulder_wrist_distance": round(shoulder_wrist, 3),
            "right_elbow": [round(v, 3) for v in elbow],
            "right_wrist": [round(v, 3) for v in wrist],
        }
        if worst_angle is None or elbow_angle < worst_angle["elbow_angle"]:
            worst_angle = record
        if shortest_reach is None or shoulder_wrist < shortest_reach["shoulder_wrist_distance"]:
            shortest_reach = record

        lo_angle, hi_angle = RIGHT_ARM_ANATOMY_ELBOW_ANGLE
        if not (lo_angle <= elbow_angle <= hi_angle):
            violations.append({**record, "issue": "right_elbow_not_anatomical_for_hold", "limits": [lo_angle, hi_angle]})

        lo_reach, hi_reach = RIGHT_ARM_ANATOMY_SHOULDER_WRIST_DISTANCE
        if not (lo_reach <= shoulder_wrist <= hi_reach):
            violations.append({**record, "issue": "right_shoulder_wrist_distance_causes_fold", "limits": [lo_reach, hi_reach]})

    if stable_frames == 0:
        return GateResult("G13", "右臂解剖学自然度", "P0", "FAIL",
                          {"reason": "no_stable_thinking_hold_frames"},
                          "G13 右臂解剖学自然度修复:\n"
                          "1. rendered_bone_frames.json 必须覆盖稳定 hold 段 f150-f210。\n"
                          "2. 如果动作时长不是 0-240，先扩展 G13 的稳定段识别。")

    status = "FAIL" if violations else "PASS"
    fix = ""
    if violations:
        fix = (
            "G13 右臂解剖学自然度修复:\n"
            f"1. 稳定段右肘角必须在 {RIGHT_ARM_ANATOMY_ELBOW_ANGLE[0]:.0f}°-{RIGHT_ARM_ANATOMY_ELBOW_ANGLE[1]:.0f}°，"
            "低于下限说明腕点离肩太近，手臂被硬折叠。\n"
            f"2. 稳定段肩-腕距离必须在 {RIGHT_ARM_ANATOMY_SHOULDER_WRIST_DISTANCE[0]:.1f}-{RIGHT_ARM_ANATOMY_SHOULDER_WRIST_DISTANCE[1]:.1f} PMX，"
            "距离过短会物理上迫使肘角掉到约45°。\n"
            "3. 修复优先级: 先把右腕放到肩-腕距离约3.1-3.4的两球交集区域，再用手腕 Euler/手指 profile 让手部轮廓接近下巴。\n"
            "4. 不要通过把腕点塞进脸部或只大幅扭手腕来通过 G11/G12。"
        )

    return GateResult("G13", "右臂解剖学自然度", "P0", status, {
        "stable_frames": stable_frames,
        "elbow_angle_limits": list(RIGHT_ARM_ANATOMY_ELBOW_ANGLE),
        "shoulder_wrist_distance_limits": list(RIGHT_ARM_ANATOMY_SHOULDER_WRIST_DISTANCE),
        "worst_angle": worst_angle,
        "shortest_reach": shortest_reach,
        "violations": violations[:20],
        "total_violations": len(violations),
    }, fix)


def g14_right_hand_shape_semantics(frames: list[dict]) -> GateResult:
    """G14: 右手手型语义。

    G11/G12/G13 can still be fooled by a vertically opened palm: one fingertip
    touches the chin, while the other fingers read as a claw or a blocking hand.
    For the thinking hold pose, fingertips should remain compact and below the
    upper face contour.
    """
    violations = []
    stable_frames = 0
    worst_tip_spread = None
    worst_y_extent = None
    worst_top_clearance = None
    target_max_y = CHIN_SURFACE[1] - HAND_CONTOUR_CHIN_CLEARANCE
    fingertip_bones = (
        "right_thumb_tip",
        "right_index_tip",
        "right_middle_tip",
        "right_ring_tip",
        "right_pinky_tip",
    )

    for fi, frame in enumerate(frames):
        frame_index = frame.get("index", fi)
        if isinstance(frame_index, (int, float)):
            is_stable = 150 <= frame_index <= 210
            report_frame = frame_index
        else:
            is_stable = len(frames) * 0.62 <= fi <= len(frames) * 0.90
            report_frame = fi
        if not is_stable:
            continue

        joints = frame.get("joints", {})
        samples = [(bone, joints[bone]) for bone in RIGHT_HAND_CONTOUR_BONES if bone in joints]
        tips = [(bone, joints[bone]) for bone in fingertip_bones if bone in joints]
        if len(samples) < 6 or len(tips) < 4:
            violations.append({
                "frame": report_frame,
                "issue": "missing_right_hand_shape_bones",
                "available_contour_bones": len(samples),
                "available_fingertips": len(tips),
            })
            continue

        stable_frames += 1
        ys = [pos[1] for _, pos in samples]
        tip_ys = [pos[1] for _, pos in tips]
        max_bone, max_pos = max(samples, key=lambda item: item[1][1])
        fingertip_y_spread = max(tip_ys) - min(tip_ys)
        hand_y_extent = max(ys) - min(ys)
        top_clearance = target_max_y - max_pos[1]
        record = {
            "frame": report_frame,
            "fingertip_y_spread": round(fingertip_y_spread, 3),
            "hand_y_extent": round(hand_y_extent, 3),
            "top_clearance": round(top_clearance, 3),
            "highest_bone": max_bone,
            "highest_y": round(max_pos[1], 3),
        }

        if worst_tip_spread is None or fingertip_y_spread > worst_tip_spread["fingertip_y_spread"]:
            worst_tip_spread = record
        if worst_y_extent is None or hand_y_extent > worst_y_extent["hand_y_extent"]:
            worst_y_extent = record
        if worst_top_clearance is None or top_clearance < worst_top_clearance["top_clearance"]:
            worst_top_clearance = record

        if fingertip_y_spread > RIGHT_HAND_SHAPE_FINGERTIP_Y_SPREAD_MAX:
            violations.append({
                **record,
                "issue": "right_fingers_too_open_vertically",
                "limit": RIGHT_HAND_SHAPE_FINGERTIP_Y_SPREAD_MAX,
            })
        if hand_y_extent > RIGHT_HAND_SHAPE_Y_EXTENT_MAX:
            violations.append({
                **record,
                "issue": "right_hand_contour_too_tall",
                "limit": RIGHT_HAND_SHAPE_Y_EXTENT_MAX,
            })
        if top_clearance < RIGHT_HAND_SHAPE_TOP_CLEARANCE_MIN:
            violations.append({
                **record,
                "issue": "right_hand_top_too_close_to_upper_face",
                "limit": RIGHT_HAND_SHAPE_TOP_CLEARANCE_MIN,
            })

    if stable_frames == 0:
        return GateResult("G14", "右手手型语义", "P0", "FAIL",
                          {"reason": "no_stable_thinking_hold_frames"},
                          "G14 右手手型语义修复:\n"
                          "1. rendered_bone_frames.json 必须覆盖稳定 hold 段 f150-f210。\n"
                          "2. 如果动作时长不是 0-240，先扩展 G14 的稳定段识别。")

    status = "FAIL" if violations else "PASS"
    fix = ""
    if violations:
        fix = (
            "G14 右手手型语义修复:\n"
            f"1. 稳定段五指指尖 Y 展开必须 <= {RIGHT_HAND_SHAPE_FINGERTIP_Y_SPREAD_MAX:.2f} PMX；"
            "超限表示手指张开成竖掌/爪形。\n"
            f"2. 稳定段整手轮廓 Y 高度必须 <= {RIGHT_HAND_SHAPE_Y_EXTENT_MAX:.2f} PMX；"
            "超限表示手掌或指节竖起挡脸。\n"
            f"3. 最高右手代理点到下巴安全线的余量必须 >= {RIGHT_HAND_SHAPE_TOP_CLEARANCE_MIN:.2f} PMX。\n"
            "4. 修复优先级: 先收拢 finger profile，再微调右手首 Euler；不要通过重新张开食指/中指来换取 G12 接触距离。"
        )

    return GateResult("G14", "右手手型语义", "P0", status, {
        "stable_frames": stable_frames,
        "fingertip_y_spread_limit": RIGHT_HAND_SHAPE_FINGERTIP_Y_SPREAD_MAX,
        "hand_y_extent_limit": RIGHT_HAND_SHAPE_Y_EXTENT_MAX,
        "top_clearance_min": RIGHT_HAND_SHAPE_TOP_CLEARANCE_MIN,
        "worst_tip_spread": worst_tip_spread,
        "worst_y_extent": worst_y_extent,
        "worst_top_clearance": worst_top_clearance,
        "violations": violations[:20],
        "total_violations": len(violations),
    }, fix)


def g15_right_hand_approach(frames: list[dict]) -> GateResult:
    """G15: 抬手接近阶段手型与脸部安全。"""
    violations = []
    checked_frames = 0
    worst = None
    fingertip_bones = (
        "right_thumb_tip", "right_index_tip", "right_middle_tip",
        "right_ring_tip", "right_pinky_tip",
    )

    for fi, frame in enumerate(frames):
        frame_index = frame.get("index", fi)
        if not isinstance(frame_index, (int, float)) or not (70 <= frame_index <= 130):
            continue
        joints = frame.get("joints", {})
        required = ("right_wrist", "chin")
        if not all(name in joints for name in required):
            violations.append({"frame": frame_index, "issue": "missing_approach_anchor"})
            continue
        samples = [(bone, joints[bone]) for bone in RIGHT_HAND_CONTOUR_BONES if bone in joints]
        tips = [(bone, joints[bone]) for bone in fingertip_bones if bone in joints]
        if len(samples) < 6 or len(tips) < 4:
            violations.append({
                "frame": frame_index,
                "issue": "missing_approach_hand_bones",
                "available_contour_bones": len(samples),
                "available_fingertips": len(tips),
            })
            continue

        wrist = joints["right_wrist"]
        chin = joints["chin"]
        wrist_chin = dist(wrist, chin)
        if wrist_chin > RIGHT_APPROACH_WRIST_CHIN_DISTANCE:
            continue
        checked_frames += 1
        tip_reaches = [dist(pos, wrist) for _, pos in tips]
        tip_ys = [pos[1] for _, pos in tips]
        hand_ys = [pos[1] for _, pos in samples]
        close = wrist_chin <= RIGHT_APPROACH_CLOSE_WRIST_CHIN_DISTANCE
        spread_limit = (
            RIGHT_APPROACH_CLOSE_FINGERTIP_Y_SPREAD_MAX if close
            else RIGHT_APPROACH_FINGERTIP_Y_SPREAD_MAX
        )
        extent_limit = (
            RIGHT_APPROACH_CLOSE_HAND_Y_EXTENT_MAX if close
            else RIGHT_APPROACH_HAND_Y_EXTENT_MAX
        )
        reach_limit = (
            RIGHT_APPROACH_CLOSE_AVG_TIP_REACH_MAX if close
            else RIGHT_APPROACH_AVG_TIP_REACH_MAX
        )
        fingertip_y_spread = max(tip_ys) - min(tip_ys)
        hand_y_extent = max(hand_ys) - min(hand_ys)
        avg_tip_reach = sum(tip_reaches) / len(tip_reaches)
        head_inside = [bone for bone, pos in samples if in_aabb(pos, COLLISION_BODIES["head"])]
        record = {
            "frame": frame_index,
            "wrist_chin_distance": round(wrist_chin, 3),
            "fingertip_y_spread": round(fingertip_y_spread, 3),
            "hand_y_extent": round(hand_y_extent, 3),
            "avg_tip_reach": round(avg_tip_reach, 3),
            "close_phase": close,
            "head_inside_bones": head_inside,
        }
        score = max(
            fingertip_y_spread / spread_limit,
            hand_y_extent / extent_limit,
            avg_tip_reach / reach_limit,
        )
        if worst is None or score > worst[0]:
            worst = (score, record)
        if fingertip_y_spread > spread_limit:
            violations.append({**record, "issue": "approach_fingers_too_open", "limit": spread_limit})
        if hand_y_extent > extent_limit:
            violations.append({**record, "issue": "approach_hand_contour_too_tall", "limit": extent_limit})
        if avg_tip_reach > reach_limit:
            violations.append({**record, "issue": "approach_fingertips_not_precurled", "limit": reach_limit})
        if frame_index < 115 and head_inside:
            violations.append({**record, "issue": "approach_hand_entered_head_before_contact"})

    if checked_frames == 0:
        return GateResult("G15", "右手接近阶段安全", "P0", "FAIL",
                          {"reason": "no_near_approach_frames"},
                          "G15 修复: 渲染数据必须覆盖 f70-f130，并包含完整右手指骨。")
    status = "FAIL" if violations else "PASS"
    fix = ""
    if violations:
        fix = (
            "G15 右手接近阶段安全修复:\n"
            "1. 在右腕到下巴距离小于 4.6 PMX 前开始收指。\n"
            "2. 距离小于 3.6 PMX 时必须接近最终半握手型。\n"
            "3. 手指应在进入脸部轮廓前完成预弯，不允许张掌扫过脸部。\n"
            "4. 修复后按 5 帧间隔渲染 f70-f130 重新验收。"
        )
    return GateResult("G15", "右手接近阶段安全", "P0", status, {
        "checked_frames": checked_frames,
        "worst": worst[1] if worst else None,
        "violations": violations[:20],
        "total_violations": len(violations),
    }, fix)


def g16_chin_contact_topology(frames: list[dict]) -> GateResult:
    """G16: 拇指 + 食指双点托下巴接触拓扑。"""
    violations = []
    stable_frames = 0
    worst = None
    thumb_bones = ("right_thumb_2", "right_thumb_tip")
    index_bones = ("right_index_2", "right_index_3", "right_index_tip")

    for fi, frame in enumerate(frames):
        frame_index = frame.get("index", fi)
        if not isinstance(frame_index, (int, float)) or not (150 <= frame_index <= 210):
            continue
        joints = frame.get("joints", {})
        if "chin" not in joints:
            violations.append({"frame": frame_index, "issue": "missing_chin"})
            continue
        thumb_samples = [(bone, joints[bone]) for bone in thumb_bones if bone in joints]
        index_samples = [(bone, joints[bone]) for bone in index_bones if bone in joints]
        if not thumb_samples or not index_samples:
            violations.append({"frame": frame_index, "issue": "missing_thumb_or_index_contact_bones"})
            continue
        stable_frames += 1
        chin = joints["chin"]
        thumb_bone, thumb_pos = min(thumb_samples, key=lambda item: dist(item[1], chin))
        index_bone, index_pos = min(index_samples, key=lambda item: dist(item[1], chin))
        thumb_distance = dist(thumb_pos, chin)
        index_distance = dist(index_pos, chin)
        separation = dist(thumb_pos, index_pos)
        record = {
            "frame": frame_index,
            "thumb_bone": thumb_bone,
            "thumb_chin_distance": round(thumb_distance, 3),
            "index_bone": index_bone,
            "index_chin_distance": round(index_distance, 3),
            "contact_separation": round(separation, 3),
        }
        score = max(
            thumb_distance / RIGHT_CONTACT_THUMB_CHIN_DISTANCE_MAX,
            index_distance / RIGHT_CONTACT_INDEX_CHIN_DISTANCE_MAX,
        )
        if worst is None or score > worst[0]:
            worst = (score, record)
        if thumb_distance > RIGHT_CONTACT_THUMB_CHIN_DISTANCE_MAX:
            violations.append({**record, "issue": "thumb_not_supporting_chin", "limit": RIGHT_CONTACT_THUMB_CHIN_DISTANCE_MAX})
        if index_distance > RIGHT_CONTACT_INDEX_CHIN_DISTANCE_MAX:
            violations.append({**record, "issue": "index_not_contacting_chin_side", "limit": RIGHT_CONTACT_INDEX_CHIN_DISTANCE_MAX})
        if separation < RIGHT_CONTACT_POINTS_SEPARATION_MIN:
            violations.append({**record, "issue": "contact_points_collapsed", "limit": RIGHT_CONTACT_POINTS_SEPARATION_MIN})

    if stable_frames == 0:
        return GateResult("G16", "下巴双点接触拓扑", "P0", "FAIL",
                          {"reason": "no_stable_contact_frames"},
                          "G16 修复: rendered_bone_frames.json 必须覆盖 f150-f210。")
    status = "FAIL" if violations else "PASS"
    fix = ""
    if violations:
        fix = (
            "G16 下巴双点接触拓扑修复:\n"
            "1. 拇指末节必须进入下巴下方支撑区。\n"
            "2. 食指中末节必须靠近下巴侧面，不能由无名指单点代替。\n"
            "3. 先优化腕点和掌面朝向，再微调拇指/食指 profile。"
        )
    return GateResult("G16", "下巴双点接触拓扑", "P0", status, {
        "stable_frames": stable_frames,
        "thumb_distance_limit": RIGHT_CONTACT_THUMB_CHIN_DISTANCE_MAX,
        "index_distance_limit": RIGHT_CONTACT_INDEX_CHIN_DISTANCE_MAX,
        "worst": worst[1] if worst else None,
        "violations": violations[:20],
        "total_violations": len(violations),
    }, fix)


def g17_wrist_palm_anatomy(frames: list[dict]) -> GateResult:
    """G17: 腕部弯折与掌面朝向。"""
    violations = []
    stable_frames = 0
    worst = None
    required = (
        "right_elbow", "right_wrist", "right_index_1",
        "right_middle_1", "right_pinky_1", "chin",
    )

    for fi, frame in enumerate(frames):
        frame_index = frame.get("index", fi)
        if not isinstance(frame_index, (int, float)) or not (150 <= frame_index <= 210):
            continue
        joints = frame.get("joints", {})
        if not all(name in joints for name in required):
            violations.append({"frame": frame_index, "issue": "missing_wrist_palm_bones"})
            continue
        stable_frames += 1
        elbow = joints["right_elbow"]
        wrist = joints["right_wrist"]
        index_base = joints["right_index_1"]
        middle_base = joints["right_middle_1"]
        pinky_base = joints["right_pinky_1"]
        chin = joints["chin"]
        forearm_axis = sub(wrist, elbow)
        hand_axis = sub(middle_base, wrist)
        wrist_bend = angle_between(forearm_axis, hand_axis)
        palm_normal = normalize(cross(sub(index_base, wrist), sub(pinky_base, wrist)))
        chin_vector = sub(chin, wrist)
        if dot(palm_normal, chin_vector) < 0:
            palm_normal = mul(palm_normal, -1.0)
        palm_chin_angle = angle_between(palm_normal, chin_vector)
        record = {
            "frame": frame_index,
            "wrist_bend": round(wrist_bend, 1),
            "palm_normal_chin_angle": round(palm_chin_angle, 1),
            "palm_normal": [round(value, 3) for value in palm_normal],
        }
        score = max(
            wrist_bend / RIGHT_WRIST_BEND_MAX,
            palm_chin_angle / RIGHT_PALM_NORMAL_CHIN_ANGLE_MAX,
        )
        if worst is None or score > worst[0]:
            worst = (score, record)
        if wrist_bend > RIGHT_WRIST_BEND_MAX:
            violations.append({**record, "issue": "wrist_overbent", "limit": RIGHT_WRIST_BEND_MAX})
        if palm_chin_angle > RIGHT_PALM_NORMAL_CHIN_ANGLE_MAX:
            violations.append({**record, "issue": "palm_edge_on_to_chin", "limit": RIGHT_PALM_NORMAL_CHIN_ANGLE_MAX})

    if stable_frames == 0:
        return GateResult("G17", "腕部与掌面解剖", "P0", "FAIL",
                          {"reason": "no_stable_wrist_frames"},
                          "G17 修复: rendered_bone_frames.json 必须覆盖 f150-f210。")
    status = "FAIL" if violations else "PASS"
    fix = ""
    if violations:
        fix = (
            "G17 腕部与掌面解剖修复:\n"
            "1. 将前臂旋前/旋后分配给右手捩骨，不要全部压在右手首。\n"
            "2. 右手首只保留小角度屈伸和尺桡偏。\n"
            "3. 调整掌面法线，使掌侧斜向下巴而不是竖掌边缘对着下巴。"
        )
    return GateResult("G17", "腕部与掌面解剖", "P0", status, {
        "stable_frames": stable_frames,
        "wrist_bend_limit": RIGHT_WRIST_BEND_MAX,
        "palm_normal_chin_angle_limit": RIGHT_PALM_NORMAL_CHIN_ANGLE_MAX,
        "worst": worst[1] if worst else None,
        "violations": violations[:20],
        "total_violations": len(violations),
    }, fix)


def g18_contact_lock(frames: list[dict]) -> GateResult:
    """G18: hold 阶段手指相对下巴的接触锁定。"""
    samples = []
    required = ("chin", "right_thumb_tip", "right_index_tip")
    for fi, frame in enumerate(frames):
        frame_index = frame.get("index", fi)
        if not isinstance(frame_index, (int, float)) or not (150 <= frame_index <= 210):
            continue
        joints = frame.get("joints", {})
        if not all(name in joints for name in required):
            continue
        samples.append({
            "frame": frame_index,
            "thumb": sub(joints["right_thumb_tip"], joints["chin"]),
            "index": sub(joints["right_index_tip"], joints["chin"]),
        })
    if not samples:
        return GateResult("G18", "下巴接触锁定", "P0", "FAIL",
                          {"reason": "no_contact_lock_frames"},
                          "G18 修复: rendered_bone_frames.json 必须覆盖 f150-f210。")

    baseline = samples[0]
    violations = []
    max_thumb_drift = 0.0
    max_index_drift = 0.0
    for sample in samples:
        thumb_drift = dist(sample["thumb"], baseline["thumb"])
        index_drift = dist(sample["index"], baseline["index"])
        max_thumb_drift = max(max_thumb_drift, thumb_drift)
        max_index_drift = max(max_index_drift, index_drift)
        record = {
            "frame": sample["frame"],
            "thumb_relative_drift": round(thumb_drift, 3),
            "index_relative_drift": round(index_drift, 3),
        }
        if thumb_drift > RIGHT_CONTACT_RELATIVE_DRIFT_MAX:
            violations.append({**record, "issue": "thumb_contact_sliding", "limit": RIGHT_CONTACT_RELATIVE_DRIFT_MAX})
        if index_drift > RIGHT_CONTACT_RELATIVE_DRIFT_MAX:
            violations.append({**record, "issue": "index_contact_sliding", "limit": RIGHT_CONTACT_RELATIVE_DRIFT_MAX})

    status = "FAIL" if violations else "PASS"
    fix = ""
    if violations:
        fix = (
            "G18 下巴接触锁定修复:\n"
            "1. hold 阶段用下巴局部坐标驱动腕点，不要让头部和手臂独立做正弦微动。\n"
            "2. 每帧重建拇指/食指目标，再求腕点与两骨 IK。\n"
            "3. 接触建立后相对漂移必须 <= 0.12 PMX。"
        )
    return GateResult("G18", "下巴接触锁定", "P0", status, {
        "stable_frames": len(samples),
        "relative_drift_limit": RIGHT_CONTACT_RELATIVE_DRIFT_MAX,
        "max_thumb_drift": round(max_thumb_drift, 3),
        "max_index_drift": round(max_index_drift, 3),
        "violations": violations[:20],
        "total_violations": len(violations),
    }, fix)


# ─── 主函数 ───

def run_acceptance_gate(frames: list[dict], fk_frames: list[dict] | None = None,
                        vmd_file: str = "unknown",
                        left_arm_policy: str = "down") -> AcceptanceReport:
    """运行全部验收 gate。"""
    report = AcceptanceReport(vmd_file=vmd_file)

    report.gates.append(g1_coordinate_integrity(frames))
    report.gates.append(g2_bone_position(frames))
    report.gates.append(g3_collision(frames))
    report.gates.append(g4_chin_distance(frames))
    report.gates.append(g5_joint_angles(frames))
    report.gates.append(g6_smoothness(frames))
    report.gates.append(g7_left_arm(frames, left_arm_policy=left_arm_policy))
    report.gates.append(g8_front_depth(frames))
    report.gates.append(g9_stance_stability(frames))
    report.gates.append(g10_fk_ik_consistency(frames, fk_frames))
    report.gates.append(g11_hand_contour_height(frames))
    report.gates.append(g12_right_thinking_semantics(frames))
    report.gates.append(g13_right_arm_anatomy(frames))
    report.gates.append(g14_right_hand_shape_semantics(frames))
    report.gates.append(g15_right_hand_approach(frames))
    report.gates.append(g16_chin_contact_topology(frames))
    report.gates.append(g17_wrist_palm_anatomy(frames))
    report.gates.append(g18_contact_lock(frames))

    return report


# 渲染空间 → PMX 空间转换
# render_x = 0.9 * pmx_x + 0
# render_y = 0.9 * pmx_y - 9.738
# render_z = -0.9 * pmx_z + 0.697
# 逆变换:
# pmx_x = (render_x - 0) / 0.9
# pmx_y = (render_y + 9.738) / 0.9
# pmx_z = -(render_z - 0.697) / 0.9
def render_to_pmx(p):
    """Convert render space coordinates to PMX model space."""
    return [
        (p[0]) / 0.9,
        (p[1] + 9.738) / 0.9,
        -(p[2] - 0.697) / 0.9,
    ]


# 骨骼名映射: 渲染脚本输出的骨骼名 → gate 使用的标准名
BONE_NAME_MAP = {
    "右手首": "right_wrist",
    "左手首": "left_wrist",
    "右親指０": "right_thumb_0",
    "右親指１": "right_thumb_1",
    "右親指２": "right_thumb_2",
    "右親指先": "right_thumb_tip",
    "右人指１": "right_index_1",
    "右人指２": "right_index_2",
    "右人指３": "right_index_3",
    "右人指先": "right_index_tip",
    "右中指１": "right_middle_1",
    "右中指２": "right_middle_2",
    "右中指３": "right_middle_3",
    "右中指先": "right_middle_tip",
    "右薬指１": "right_ring_1",
    "右薬指２": "right_ring_2",
    "右薬指３": "right_ring_3",
    "右薬指先": "right_ring_tip",
    "右小指１": "right_pinky_1",
    "右小指２": "right_pinky_2",
    "右小指３": "right_pinky_3",
    "右小指先": "right_pinky_tip",
    "左親指０": "left_thumb_0",
    "左親指１": "left_thumb_1",
    "左親指２": "left_thumb_2",
    "左親指先": "left_thumb_tip",
    "左人指１": "left_index_1",
    "左人指２": "left_index_2",
    "左人指３": "left_index_3",
    "左人指先": "left_index_tip",
    "左中指１": "left_middle_1",
    "左中指２": "left_middle_2",
    "左中指３": "left_middle_3",
    "左中指先": "left_middle_tip",
    "左薬指１": "left_ring_1",
    "左薬指２": "left_ring_2",
    "左薬指３": "left_ring_3",
    "左薬指先": "left_ring_tip",
    "左小指１": "left_pinky_1",
    "左小指２": "left_pinky_2",
    "左小指３": "left_pinky_3",
    "左小指先": "left_pinky_tip",
    "右ひじ": "right_elbow",
    "左ひじ": "left_elbow",
    "右手捩": "right_forearm_twist",
    "左手捩": "left_forearm_twist",
    "右肩": "right_shoulder",
    "左肩": "left_shoulder",
    "右腕": "right_upper_arm",
    "左腕": "left_upper_arm",
    "右足": "right_hip",
    "左足": "left_hip",
    "右ひざ": "right_knee",
    "左ひざ": "left_knee",
    "右足首": "right_ankle",
    "左足首": "left_ankle",
    "下半身": "lower_body",
    "上半身": "upper_body",
    "上半身2": "upper_chest",
    "首": "neck",
    "頭": "head",
    "下齿": "chin",
}


def normalize_frames(frames, source="pmx"):
    """Normalize frame data to PMX space with standard joint names.

    Args:
        frames: List of {index, joints: {bone_name: [x,y,z]}}
        source: "pmx" (already PMX) or "render" (render space, needs conversion)

    Returns:
        List of {index, joints: {standard_name: [pmx_x, pmx_y, pmx_z]}}
    """
    result = []
    for frame in frames:
        joints = frame.get("joints", {})
        rotations = frame.get("rotations", {})
        normalized = {}
        normalized_rotations = {}
        for bone_name, pos in joints.items():
            standard = BONE_NAME_MAP.get(bone_name, bone_name)
            if pos and len(pos) >= 3:
                if source == "render":
                    pmx_pos = render_to_pmx(pos)
                else:
                    pmx_pos = list(pos[:3])
                normalized[standard] = [round(v, 4) for v in pmx_pos]
        for bone_name, quat in rotations.items():
            standard = BONE_NAME_MAP.get(bone_name, bone_name)
            if quat and len(quat) >= 4:
                normalized_rotations[standard] = [float(value) for value in quat[:4]]
        result.append({
            "index": frame.get("index", 0),
            "joints": normalized,
            "rotations": normalized_rotations,
        })
    return result


def main():
    if len(sys.argv) < 2:
        print(f"用法: python {sys.argv[0]} <joints_json> [--source pmx|render] [--left-arm-policy down|support|akimbo|skip] [--output <report.json>]")
        print(f"  joints_json: 帧关节数据 JSON")
        print(f"  --source pmx: 输入为 PMX 空间坐标 (默认)")
        print(f"  --source render: 输入为渲染空间坐标 (自动转换到 PMX)")
        sys.exit(1)

    joints_file = sys.argv[1]
    fk_file = None
    output_file = None
    source = "pmx"
    left_arm_policy = "down"

    for i, arg in enumerate(sys.argv[2:], 2):
        if arg == "--fk" and i + 1 < len(sys.argv):
            fk_file = sys.argv[i + 1]
        elif arg == "--output" and i + 1 < len(sys.argv):
            output_file = sys.argv[i + 1]
        elif arg == "--source" and i + 1 < len(sys.argv):
            source = sys.argv[i + 1]
        elif arg == "--left-arm-policy" and i + 1 < len(sys.argv):
            left_arm_policy = sys.argv[i + 1]

    if left_arm_policy not in {"down", "support", "akimbo", "skip"}:
        raise SystemExit("--left-arm-policy must be one of: down, support, akimbo, skip")

    with open(joints_file) as f:
        raw_frames = json.load(f)

    frames = normalize_frames(raw_frames, source=source)

    fk_frames = None
    if fk_file:
        with open(fk_file) as f:
            fk_frames = json.load(f)

    report = run_acceptance_gate(
        frames, fk_frames, vmd_file=Path(joints_file).name,
        left_arm_policy=left_arm_policy,
    )
    result = report.to_dict()

    # 打印汇总
    print(f"\n{'='*60}")
    print(f"VMD 验收报告: {result['vmd_file']}")
    print(f"总评: {result['overall']}  通过: {result['passed']}  警告: {result['warned']}  失败: {result['failed']}")
    print(f"{'='*60}")

    for gid, g in result["gates"].items():
        icon = "PASS" if g["status"] == "PASS" else ("WARN" if g["status"] == "WARN" else "FAIL")
        print(f"  [{icon:4s}] {gid} {g['name']} ({g['priority']})")

    # 打印失败 gate 的修复指引
    failed_gates = {k: v for k, v in result["gates"].items() if v["status"] == "FAIL"}
    warned_gates = {k: v for k, v in result["gates"].items() if v["status"] == "WARN"}

    if failed_gates:
        print(f"\n{'─'*60}")
        print("修复指引 (FAIL):")
        print(f"{'─'*60}")
        for gid, g in failed_gates.items():
            print(f"\n  {gid} {g['name']}:")
            for line in g.get("fix_guide", "").split("\n"):
                print(f"    {line}")
            details = g.get("details", {})
            if details.get("violations"):
                print(f"    违规明细 ({details.get('total_violations', len(details['violations']))} 次):")
                for v in details["violations"][:5]:
                    print(f"      - {v}")
                if details.get('total_violations', 0) > 5:
                    print(f"      ... 共 {details['total_violations']} 次")

    if warned_gates:
        print(f"\n{'─'*60}")
        print("修复建议 (WARN):")
        print(f"{'─'*60}")
        for gid, g in warned_gates.items():
            print(f"\n  {gid} {g['name']}:")
            for line in g.get("fix_guide", "").split("\n"):
                print(f"    {line}")

    # JSON 完整报告
    print(f"\n{'='*60}")
    print("完整 JSON 报告:")
    print(f"{'='*60}")
    print(json.dumps(result, indent=2, ensure_ascii=False))

    if output_file:
        with open(output_file, "w") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print(f"\n报告已保存: {output_file}")

    sys.exit(0 if result["overall"] != "FAIL" else 1)


if __name__ == "__main__":
    main()
