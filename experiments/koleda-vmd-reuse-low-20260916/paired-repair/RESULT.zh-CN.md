# 配套PMX／VMD修复交付（2026-09-16）

## 结论

完整无穿插修复未完成。披风约72mm转换残差已在新PMX＋VMD独立回读及真实网页链路降到亚毫米级。新增52根披风源骨，仅重绑6483点；原PMX、默认动作及生产配置不变。用户指定seasunCodex/gpt-6-astra/low保持，基线79057f4629fcf4afb195ae62dccdbf8f25fad085。

## 配套资产（本目录）

- Koleda_CapeRebind.pmx：453骨，SHA256 bee89427fa05ff92b61ef891545671079eb8b2efe247de0df5323265e15c0a01。
- Koleda_CapeRebind.vmd：SHA256 986c6d21e7c23d7beafe2ddf61566ae61472ed5e0a1344a9317ba6343c16e2d2。
- Koleda_CapeRebind_Export.blend：四权重输出基准；Koleda_Pair_Independent.blend：空场景独立导入结果。
- runtime-pair-anchor-noik-nogrant-snap/：新四视角全身截图、序列帧及10个时刻网页网格。front.gif、left.gif、right.gif、back.gif均800×800、20帧，由本轮截图生成。四方向第83帧已人工视觉复核，未复用旧图。

新PMX和VMD必须配套，不能把新VMD套给原PMX。游戏衍生二进制仅本地保存，不提交公开分发。纹理仍引用D:/mmd/克莱妲原皮，不是跨机便携包。原PMX哈希保持90268b4961c974344342affb360bab5699cec8a5d167a416fcbf6316bf5a3703。

## 已验证结果

| 检查 | 结果 |
|---|---|
| 原材质、面拓扑、UV／法线／位置、表情、刚体、关节、原401骨 | 新PMX独立解析逐项一致 |
| 新PMX＋VMD独立导入119帧相对输出基准 | 全网格最大0.002742mm |
| 独立导入披风相对源缓存 | 最大0.170576mm，主要为6影响裁剪为4影响的误差 |
| 新骨缩放偏差 | 最大4.17e-7，未靠不可表达缩放修复 |
| 真实网页加载／播放／暂停／定位 | 通过；播放0.114→0.4265秒，暂停稳定 |
| 新52根RC披风骨 | 播放和定位对照52/52均变化 |
| 网页10时刻相对独立导入 | 全网格最大0.3691mm |
| 网页10时刻披风相对源缓存 | 最大0.2912mm，第83帧0.1672mm |

证据：export-report.json、independent-report.json、delivery-summary.json。网页在本工作树独立3217端口运行真实MMDCompanionRuntime，只在测试实例关闭根骨固定、IK和Grant，未加载Ammo。不改变生产默认配置，classic截图不代表v14d-game材质等价。页面异常0，传输失败0；原spa目录型贴图仍404，1条控制台错误及156条材质属性警告完整保留，没有伪造补图。

## 穿插修正尝试与止损

对9个真实帧尝试52骨世界平移，保护上缘，分别8／16／24mm上限，每轮双向边—三角内部交叉复核。

| 帧 | 原交叉对数 | 8mm最好结果 | 16mm | 24mm |
|---|---|---|---|---|
| 0 | 7 | 7（中间曾恶化到20） | 7 | 7 |
| 15 | 56 | 48 | 48 | 48 |
| 45 | 8 | 1 | 1 | 1 |
| 75 | 417 | 401 | 401 | 401 |
| 83 | 12 | 0 | 0 | 0 |
| 105 | 368 | 308 | 285 | 281 |
| 118 | 385 | 285 | 211 | 211 |

三档均失败，不把局部帧归零当全动作完成，未把候选写入VMD。尚未做候选时间平滑、自交或视觉验收；完整迭代见contact-probe-report.json。

配套独立导入网格全119帧：披风119帧交叉、17624对、峰565；头发119帧交叉、75491对、峰829。含发根、脸、皮肤、袖口／手套，不豁免。计数不是面积、深度或完整内外判定；未检测自交与帧间连续碰撞。见full-contact-report.json。

## 门禁与时间

独立回读119帧真实关节适配到既定渲染坐标，运行motion_acceptance_gate.py，参数--source render --left-arm-policy skip。实际退出1，整体FAIL：4通过、2警告、12失败。G7显式跳过、G10缺FK参照跳过，不算真实通过；进场不是托下巴，相关语义未伪装通过，门禁未放宽。输出见motion-gate.json、motion-gate-output.txt。

原235/60秒与VMD末帧118/30秒仍差1/60秒；网页原余辉1.1秒使clipDuration为5.033333秒。完整子帧等价、Ammo、生产v14d-game尚未验收。

## 实际命令

工作目录E:/codexWorktree/a6ef/MMD project。使用C:/Program Files/Blender Foundation/Blender 5.2/blender.exe，加-b --python-exit-code 1 --python，依次执行本目录export_pair.py、verify_pair.py、contact_probe.py、full_contact.py，最终均退出0。探针退出0仅表示执行完毕，非碰撞通过。

verify_pair首次错误字段rigid_bodies、第二次工厂设置卸载插件，两次失败分别修为rigids及仅清除启动场景对象；随后真实空场景导入成功。

web目录设置NEXT_DIST_DIR=.next-codex-test，执行node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3217。运行父目录runtime-probe.mjs时设置KOLEDA_OUTPUT_DIR为本目录、KOLEDA_PMX／KOLEDA_VMD为新配套文件绝对路径、KOLEDA_PROBE_MODE=pair-anchor-noik-nogrant-snap。真实请求记录证明使用新资产。

PYTHONUTF8=1，使用本机依赖Python运行collect_evidence.py，生成GIF、分层误差并实际调用正式门禁；子进程退出码记录于delivery-summary.json。

## 下一步权限与边界

权重／辅助骨修改已解决转换残差，有界骨平移修穿插三次未通过。下一候选路线是调整模型副本局部静止几何、领口形状或发根贴合，可能改变外观；超出之前权重／骨骼修改范围，需要用户确认并指定保护区。也可另行讨论允许偏离原动作的程度。

这不是证明只能改网格；只是当前受限骨平移路线已失败，新路线未验证。未经决定不继续增大位移，不隐藏或删除内嵌面来通过检测。停止写入后保留工作树、报告和本地资产，向来源发送正式交付。
