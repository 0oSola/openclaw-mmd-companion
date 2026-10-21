import bpy, json

BLEND = r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)

# inspect Cth1-Top chain details
mat = bpy.data.materials["PROTO_GF2_Cth1-Top"]
principled = next(n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
base = principled.inputs["Base Color"]
mix = base.links[0].from_node
info = {"mixNode": mix.name, "blendType": mix.blend_type, "fac": mix.inputs["Fac"].default_value}
c2 = mix.inputs["Color2"]
c2info = {"linked": c2.is_linked}
if c2.is_linked:
    add = c2.links[0].from_node
    c2info["addNode"] = add.name
    c2info["addDefaults"] = [add.inputs[0].default_value, add.inputs[1].default_value]
    c2info["addLinked"] = [add.inputs[0].is_linked, add.inputs[1].is_linked]
    # trace the multiply feeding it
    for i, inp in enumerate(add.inputs):
        if inp.is_linked:
            mul = inp.links[0].from_node
            c2info[f"addIn{i}"] = {
                "node": mul.name, "op": getattr(mul, "operation", None),
                "defaults": [mul.inputs[0].default_value, mul.inputs[1].default_value],
                "linked": [mul.inputs[0].is_linked, mul.inputs[1].is_linked],
            }
            for j, minp in enumerate(mul.inputs):
                if minp.is_linked:
                    src = minp.links[0].from_node
                    entry = {"node": src.name, "type": src.bl_idname}
                    if src.bl_idname == "ShaderNodeSeparateColor":
                        inner = src.inputs["Color"]
                        if inner.is_linked:
                            tex = inner.links[0].from_node
                            entry["texImage"] = tex.image.name if getattr(tex, "image", None) else None
                    c2info[f"addIn{i}_mulIn{j}"] = entry
info["color2"] = c2info

# face constant values
face = bpy.data.materials["PROTO_V14D_GF2_Face"]
fp = next(n for n in face.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
face_info = {}
for val_name in ["PROTO_V14D_BlendWeight", "PROTO_V14D_LayerA", "PROTO_V14D_LayerB"]:
    n = face.node_tree.nodes.get(val_name)
    if n is not None:
        face_info[val_name] = n.outputs[0].default_value
# narrow tint constants
for node_name in ["PROTO_V14D_NarrowShadowTint", "PROTO_FaceWarm"]:
    n = face.node_tree.nodes.get(node_name)
    if n is not None:
        face_info[node_name] = {
            "blendType": getattr(n, "blend_type", None),
            "fac": n.inputs["Fac"].default_value,
            "facLinked": n.inputs["Fac"].is_linked,
            "c1": list(n.inputs["Color1"].default_value)[:3],
            "c2": list(n.inputs["Color2"].default_value)[:3],
            "c1Linked": n.inputs["Color1"].is_linked,
            "c2Linked": n.inputs["Color2"].is_linked,
        }
# hair tint
for hair in ["PROTO_GF2_HairA", "PROTO_GF2_HairB"]:
    hm = bpy.data.materials[hair]
    tint = hm.node_tree.nodes.get("PROTO_HairTint")
    face_info[f"{hair}::PROTO_HairTint"] = {
        "blendType": tint.blend_type, "fac": tint.inputs["Fac"].default_value,
        "c2": list(tint.inputs["Color2"].default_value)[:3],
    }

result = {"Cth1-Top": info, "Face": face_info}
print("===PROBE2-BEGIN===")
print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
print("===PROBE2-END===")
