import bpy, json, hashlib
bpy.ops.wm.open_mainfile(filepath=r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend")
scene = bpy.context.scene
mat = bpy.data.materials.get("PROTO_V14D_GF2_Face")
nodes = mat.node_tree.nodes
def rgba(v): return [float(v[i]) for i in range(len(v))]
def sock(s):
    if s is None: return None
    d = {"linked": bool(s.is_linked)}
    if hasattr(s, "default_value"):
        dv = s.default_value
        d["default"] = rgba(dv) if hasattr(dv, "__len__") else float(dv)
    if s.is_linked:
        d["links"] = [{"node": l.from_node.name, "type": l.from_node.bl_idname, "socket": l.from_socket.name} for l in s.links]
    return d
def ninfo(name):
    n = nodes.get(name)
    if n is None: return {"error": "missing"}
    info = {"type": n.bl_idname, "inputs": {}}
    if n.bl_idname == "ShaderNodeMixRGB": info["blendType"] = n.blend_type
    if n.bl_idname == "ShaderNodeMath": info["operation"] = n.operation
    for inp in n.inputs: info["inputs"][inp.name] = sock(inp)
    return info
state = {n.name: float(n.outputs[0].default_value) for n in nodes if n.bl_idname == "ShaderNodeValue" and n.name.startswith("PROTO_V14D_")}
masks = {}
for n in nodes:
    if n.bl_idname == "ShaderNodeTexImage" and n.name.startswith("PROTO_V14D_MaskState"):
        img = n.image
        e = {"image": img.name if img else None, "filepath": img.filepath if img else None, "size": list(img.size) if img else None, "colorspace": img.colorspace_settings.name if img else None, "packed": bool(img.packed_file) if img else None, "channels": img.channels if img else None, "depth": img.depth if img else None, "interpolation": n.interpolation, "extension": n.extension, "vector": sock(n.inputs.get("Vector")), "color_to": [{"node": l.to_node.name, "socket": l.to_socket.name} for l in n.outputs["Color"].links], "alpha_to": [{"node": l.to_node.name, "socket": l.to_socket.name} for l in n.outputs["Alpha"].links]}
        if img and img.packed_file: e["packed_sha256"] = hashlib.sha256(bytes(img.packed_file.data)).hexdigest()
        masks[n.name] = e
base_tex = None
for n in nodes:
    if n.bl_idname == "ShaderNodeTexImage" and not n.name.startswith("PROTO_V14D_MaskState"):
        img = n.image
        if img and "face_d" in (img.name or ""):
            base_tex = {"node": n.name, "image": img.name, "filepath": img.filepath, "size": list(img.size), "colorspace": img.colorspace_settings.name, "packed": bool(img.packed_file), "interpolation": n.interpolation, "extension": n.extension, "color_to": [{"node": l.to_node.name, "socket": l.to_socket.name} for l in n.outputs["Color"].links]}
            if img.packed_file: base_tex["packed_sha256"] = hashlib.sha256(bytes(img.packed_file.data)).hexdigest()
key = {}
for name in ["PROTO_FaceWarm","PROTO_V14D_FinalMaskRGBBlend","PROTO_V14D_FinalMaskRGBSeparate","PROTO_V14D_NarrowProtectInverse","PROTO_V14D_NarrowArtWeightProtect","PROTO_V14D_NarrowArtWeightFaceValid","PROTO_V14D_NarrowShadowTint","PROTO_V14D_NarrowApplyArtShadow","PROTO_V14D_NarrowFringeWeightProtect","PROTO_V14D_NarrowFringeWeightFaceValid","PROTO_V14D_NarrowFringeTint","PROTO_V14D_NarrowFinalFaceColor","PROTO_V14D_FinalMixAlphaFaceValid","PROTO_V14D_FinalMixedRGBA"]:
    key[name] = ninfo(name)
out = {"scene": {"frame_current": scene.frame_current, "fps": scene.render.fps, "resolution": [scene.render.resolution_x, scene.render.resolution_y], "view_transform": scene.view_settings.view_transform, "look": scene.view_settings.look, "exposure": scene.view_settings.exposure, "gamma": scene.view_settings.gamma}, "state": state, "masks": masks, "baseFaceTexture": base_tex, "keyNodes": key}
print("===FACE-S2-BEGIN===")
print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
print("===FACE-S2-END===")
