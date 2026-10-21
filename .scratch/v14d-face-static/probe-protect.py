import bpy, json
bpy.ops.wm.open_mainfile(filepath=r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend")
mat = bpy.data.materials.get("PROTO_V14D_GF2_Face")
nodes = mat.node_tree.nodes
def dump(name):
    n = nodes.get(name)
    if n is None: return {"error": "missing"}
    ins = []
    for i, inp in enumerate(n.inputs):
        entry = {"index": i, "name": inp.name, "linked": bool(inp.is_linked)}
        if hasattr(inp, "default_value"):
            dv = inp.default_value
            entry["default"] = list(dv) if hasattr(dv, "__len__") else float(dv)
        if inp.is_linked:
            entry["from"] = [{"node": l.from_node.name, "socket": l.from_socket.name} for l in inp.links]
        ins.append(entry)
    outs = []
    for o in n.outputs:
        outs.append({"name": o.name, "to": [{"node": l.to_node.name, "socket": l.to_socket.name} for l in o.links]})
    return {"type": n.bl_idname, "op": getattr(n, "operation", None), "use_clamp": getattr(n, "use_clamp", None), "inputs": ins, "outputs": outs}
out = {nm: dump(nm) for nm in [
    "PROTO_V14D_NarrowProtectInverse",
    "PROTO_V14D_NarrowArtWeightProtect",
    "PROTO_V14D_NarrowArtWeightFaceValid",
    "PROTO_V14D_NarrowFringeWeightProtect",
    "PROTO_V14D_NarrowFringeWeightFaceValid",
    "PROTO_V14D_NarrowShadowTint",
    "PROTO_V14D_NarrowFringeTint",
]}
print("===PROTECT-BEGIN===")
print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
print("===PROTECT-END===")
