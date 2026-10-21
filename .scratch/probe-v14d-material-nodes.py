import bpy, json

BLEND = r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)

TARGETS = ["PROTO_GF2_HairA", "PROTO_GF2_HairB", "PROTO_V14D_GF2_Face", "PROTO_GF2_Cth1-Top"]

def trace_socket(socket, depth=0, max_depth=12):
    """Recursively trace what feeds a shader input socket."""
    out = []
    if depth > max_depth:
        out.append({"depth": depth, "note": "max-depth-reached"})
        return out
    for link in socket.links:
        node = link.from_node
        entry = {
            "depth": depth,
            "node": node.name,
            "type": node.bl_idname,
            "fromSocket": link.from_socket.name,
        }
        if node.bl_idname == "ShaderNodeTexImage":
            img = node.image
            entry["image"] = img.name if img else None
            entry["imageFilepath"] = (img.filepath if img else None)
            entry["imageColorspace"] = (img.colorspace_settings.name if img else None)
            entry["imageSize"] = (list(img.size) if img else None)
            entry["alphaMode"] = node.alpha_mode if hasattr(node, "alpha_mode") else None
            entry["interpolation"] = node.interpolation
        elif node.bl_idname == "ShaderNodeMixRGB":
            entry["blendType"] = node.blend_type
            entry["facDefault"] = node.inputs["Fac"].default_value
            entry["color1Default"] = list(node.inputs["Color1"].default_value)
            entry["color2Default"] = list(node.inputs["Color2"].default_value)
            entry["color1Linked"] = node.inputs["Color1"].is_linked
            entry["color2Linked"] = node.inputs["Color2"].is_linked
        elif node.bl_idname == "ShaderNodeMath":
            entry["operation"] = node.operation
            entry["inputDefaults"] = [list(inp.default_value) if hasattr(inp.default_value, "__len__") else inp.default_value for inp in node.inputs]
        elif node.bl_idname == "ShaderNodeValToRGB":
            entry["colorRamp"] = [{"pos": e.position, "color": list(e.color)} for e in node.color_ramp.elements]
        elif node.bl_idname == "ShaderNodeRGB":
            entry["value"] = list(node.outputs[0].default_value)
        elif node.bl_idname == "ShaderNodeVertexColor":
            entry["layerName"] = node.layer_name
        elif node.bl_idname == "ShaderNodeHueSaturation":
            entry["hue"] = node.inputs["Hue"].default_value
            entry["sat"] = node.inputs["Saturation"].default_value
            entry["val"] = node.inputs["Value"].default_value
        entry["children"] = []
        # Recurse into all inputs of this node
        for inp in node.inputs:
            if inp.is_linked:
                entry["children"].append({"input": inp.name, "trace": trace_socket(inp, depth + 1, max_depth)})
        out.append(entry)
    return out

result = {}
for mat_name in TARGETS:
    mat = bpy.data.materials.get(mat_name)
    if mat is None:
        result[mat_name] = {"error": "material not found", "available": [m.name for m in bpy.data.materials][:40]}
        continue
    info = {"useNodes": mat.use_nodes, "diffuseColor": list(mat.diffuse_color)}
    if mat.use_nodes:
        principled = next((n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled"), None)
        if principled is None:
            info["error"] = "no principled"
            # list all nodes
            info["nodes"] = [{"name": n.name, "type": n.bl_idname} for n in mat.node_tree.nodes]
        else:
            base = principled.inputs.get("Base Color")
            info["baseColorLinked"] = base.is_linked
            info["baseColorDefault"] = list(base.default_value)
            info["baseColorTrace"] = trace_socket(base)
            # also record all node names/types for context
            info["allNodes"] = [{"name": n.name, "type": n.bl_idname} for n in mat.node_tree.nodes]
    result[mat_name] = info

print("===PROBE-JSON-BEGIN===")
print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
print("===PROBE-JSON-END===")
