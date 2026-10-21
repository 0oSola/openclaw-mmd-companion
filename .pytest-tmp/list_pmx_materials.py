import struct, sys

p = sys.argv[1]
d = open(p, 'rb').read()
assert d[:4] == b'PMX '
n = d[8]
enc, auv, vis, tis, mis, bis, moris, ris = d[9:9 + n]
off = 9 + n

def rstr(o):
    l = struct.unpack_from('<i', d, o)[0]; o += 4
    s = d[o:o + l].decode('utf-16-le' if enc == 0 else 'utf-8', errors='replace'); o += l
    return s, o

def ridx(o, sz):
    if sz == 1: v = struct.unpack_from('<b', d, o)[0]
    elif sz == 2: v = struct.unpack_from('<h', d, o)[0]
    else: v = struct.unpack_from('<i', d, o)[0]
    return v, o + sz

for _ in range(4):
    _, off = rstr(off)

nv = struct.unpack_from('<i', d, off)[0]; off += 4
for _ in range(nv):
    off += 12 + 12 + 8 + auv * 16
    wtype = d[off]; off += 1
    if wtype == 0:      # BDEF1
        off += bis
    elif wtype == 1:    # BDEF2
        off += bis * 2 + 4
    elif wtype == 2:    # BDEF4
        off += bis * 4 + 16
    elif wtype == 3:    # SDEF
        off += bis * 2 + 4 + 36
    elif wtype == 4:    # QDEF
        off += bis * 4 + 16
    else:
        raise ValueError(f'unknown weight type {wtype}')
    off += 4  # edge scale
nf = struct.unpack_from('<i', d, off)[0]; off += 4
off += nf * vis
nt = struct.unpack_from('<i', d, off)[0]; off += 4
textures = []
for _ in range(nt):
    s, off = rstr(off); textures.append(s)
print("=== TEXTURES ===")
for t in textures:
    print(repr(t))
nm = struct.unpack_from('<i', d, off)[0]; off += 4
print("=== MATERIALS ===")
for i in range(nm):
    name, off = rstr(off); nameE, off = rstr(off)
    diff = struct.unpack_from('<4f', d, off)
    spec = struct.unpack_from('<3f', d, off + 16)
    specpow = struct.unpack_from('<f', d, off + 28)[0]
    amb = struct.unpack_from('<3f', d, off + 32)
    off += 16 + 12 + 4 + 12 + 1 + 16 + 4  # diffuse4, spec3, specpow, ambient3, flags, edge4, edgesize
    tid, off = ridx(off, tis)
    stid, off = ridx(off, tis)
    off += 1
    toonflag = d[off]; off += 1
    if toonflag == 0:
        ttid, off = ridx(off, tis)
    else:
        off += 1
    memo, off = rstr(off)
    fc = struct.unpack_from('<i', d, off)[0]; off += 4
    tex = textures[tid] if 0 <= tid < len(textures) else '?'
    spa = textures[stid] if 0 <= stid < len(textures) else ''
    print(f"{i:2d} {name!r} tex={tex!r} spa={spa!r} diff={[round(x,3) for x in diff]} spec={[round(x,3) for x in spec]} sp={round(specpow,1)} amb={[round(x,3) for x in amb]}")
