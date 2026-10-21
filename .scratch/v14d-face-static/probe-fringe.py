import bpy, json
bpy.ops.wm.open_mainfile(filepath=r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend")
mat = bpy.data.materials.get("PROTO_V14D_GF2_Face")
nodes = mat.node_tree.nodes
def sock(s):
    if s is None: return None
    d = {"linked": bool(s.is_linked)}
    if hasattr(s, "default_value"):
        dv = s.default_value
        d["default"] = list(dv) if hasattr(dv, "__len__") else float(dv)
    if s.is_linked:
        d["links"] = [{"node": l.from_node.name, "type": l.from_node.bl_idname, "socket": l.from_socket.name} for l in s.links]
    return d
def ninfo(name):
    n = nodes.get(name)
    if n is None: return {"error": "missing"}
    info = {"type": n.bl_idname, "inputs": {}}
    if n.bl_idname == "ShaderNodeMath": info["operation"] = n.operation
    for inp in n.inputs: info["inputs"][inp.name] = sock(inp)
    return info
out = {
    "FringeWeightFaceValid": ninfo("PROTO_V14D_NarrowFringeWeightFaceValid"),
    "FringeWeightProtect": ninfo("PROTO_V14D_NarrowFringeWeightProtect"),
    "ArtWeightFaceValid": ninfo("PROTO_V14D_NarrowArtWeightFaceValid"),
    "ArtWeightProtect": ninfo("PROTO_V14D_NarrowArtWeightProtect"),
    "ProtectInverse": ninfo("PROTO_V14D_NarrowProtectInverse"),
    "FinalMaskRGBSeparate": ninfo("PROTO_V14D_FinalMaskRGBSeparate"),
}
# who consumes FinalMaskRGBSeparate outputs
sep = nodes.get("PROTO_V14D_FinalMaskRGBSeparate")
consumers = {}
for o in sep.outputs:
    consumers[o.name] = [{"node": l.to_node.name, "socket": l.to_socket.name} for l in o.links]
out["FinalMaskRGBSeparate_consumers"] = consumers
# also check FinalMixAlphaFaceValid consumers + FinalMixedRGBA consumers
for nm in ["PROTO_V14D_FinalMixAlphaFaceValid", "PROTO_V14D_FinalMixedRGBA"]:
    nd = nodes.get(nm)
    if nd:
        out[nm + "_outputs"] = {o.name: [{"node": l.to_node.name, "socket": l.to_socket.name} for l in o.links] for o in nd.outputs}
print("===FRINGE-BEGIN===")
print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
print("===FRINGE-END===")
