from pathlib import Path
import struct, sys
p = Path(r"D:\mmd\克莱妲原皮\GirlsFrontline KoledaDefault.pmx")
data = p.read_bytes()
# 文本编码: header 第 9 字节区; 简化: 扫描可见 .png/.bmp/.tga 字符串 (PMX 纹理表为 Shift-JIS/UTF-16 文本)
# 直接用二进制查找 ASCII/Shift-JIS 纹理文件名
import re
names = set()
for m in re.finditer(rb"[A-Za-z0-9_\\\.\x80-\xff/ ]+\.(?:png|bmp|tga|spa|sph)", data):
    s = m.group().decode("shift_jis", errors="ignore")
    names.add(s)
for n in sorted(names):
    print(n)
