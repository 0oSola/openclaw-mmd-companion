# 本机 OCIO 运行时再分发证据核查

## 结论

本轮确认了当前运行时的实际来源，但没有取得足以单独放行配置及两份 LUT 再分发的直接许可文本。保持原有 redistributionLicenseVerified=false，不改发布包，也不据此声称作者禁止使用。本文是工程证据核查，不是最终法律意见。

引用对话建议的“记录来源、固定版本、生成运行时、携带许可”是候选交付流程，不是已经取得许可的证明。重新导出运行时本身不能填补现有授权证据缺口。

## 本机对象与固定来源

当前web/.scratch/v14d-head-preview/ocio/processor.json记录OCIO 2.5.0、AgX - Medium High Contrast、sRGB显示及两个上游LUT的哈希。实际本机目录为C:/Program Files/Blender Foundation/Blender 5.2/5.2/datafiles/colormanagement。

| 对象 | 本机原始 SHA256 | 官方v5.2.1原始 SHA256 | 差异复核 |
| --- | --- | --- | --- |
| config.ocio | df5714c85d5afb5e9762281503a0c48a9f65dadb22d32a3aee50c454a0821f62 | 47a7d83e79c1d21f49ba6c505efe311da723471688c614b5c366e1da7eb8ea3a | CRLF统一为LF后文本完全相同 |
| AgX_Base_sRGB.cube | 02f4d185608daa67fda01a1a48529bbc1533c8afdc826cde5c78f2eb5bb1b839 | e707a36f3e90ee79bc342332febf91334c02ce3974cac700ece00ca9d4507491 | 同上 |
| luminance_compensation_bt2020.cube | 3ec0a2dbae1e48aa6889e2b17df4009b6aca430051dae1721c64fdc6699de884 | e3f5adcd8c08f77a96be141e8d504d58125cc80216a7a641abc970c85840cfd2 | 同上 |

主会话通过官方GitHub原始文件HTTP200响应字节独立复算。不是把不同的原始文件哈希声明为相同：二进制不同，换行规范化后的文本相同。

官方固定来源（每个表格对象对应其同名文件）：

- https://raw.githubusercontent.com/blender/blender/v5.2.1/release/datafiles/colormanagement/config.ocio
- https://raw.githubusercontent.com/blender/blender/v5.2.1/release/datafiles/colormanagement/luts/AgX_Base_sRGB.cube
- https://raw.githubusercontent.com/blender/blender/v5.2.1/release/datafiles/colormanagement/luts/luminance_compensation_bt2020.cube

## 运行时 LUT 的性质

只读审阅源预览export-local-head-ocio.py：脚本固定配置和依赖哈希，调用OCIO GPU处理器extractGpuShaderInfo，再取得get3DTextures的值，追加0作为第四通道后保存float32。不是独立重新设计的颜色变换。

实际对比当前两份运行时文件：37³表50653条目、810448字节；57³表185193条目、2963088字节。直接按磁盘顺序比较不相等；校正首尾两个坐标轴的存储顺序后，每个RGB值均等于上游cube对应数值的float32转换，差异数0、最大差0。该结果是数值来源证明，不是版权归属或授权判断。

## 许可文本实际检查

- 本机config.ocio首部列明AgX作者与仓库，并要求查看ocio-license.txt。
- 在本机Blender安装文件清单中未找到该文件。
- 固定地址 https://raw.githubusercontent.com/blender/blender/v5.2.1/release/datafiles/colormanagement/ocio-license.txt 返回404。
- https://raw.githubusercontent.com/EaryChow/AgX/main/LICENSE 返回404。此结果只覆盖该路径，不证明所有历史或其他渠道都不存在许可。
- OpenColorIO v2.5.0官方LICENSE返回200，正文包含源码/二进制再分发条件及署名、免责、不得借名背书等条款。该文件适用对象是OCIO软件项目，本轮不把它替代为两份Blender LUT的专属授权。
  来源：https://raw.githubusercontent.com/AcademySoftwareFoundation/OpenColorIO/v2.5.0/LICENSE
- 本机license/license.md包含OpenColorIO 2.5.0库条目；检索未发现对应这两个LUT的专属说明。

## 现阶段可做与不可据此宣称

可以继续维护本机已有资源的技术实现及可复现来源记录。当前Web运行时读取现成JSON、GLSL和LUT，不在每次渲染时执行Blender导出脚本。

本轮没有批准把这些数据加入Server ZIP、Git公开资产或跨机器发布包；也没有作出禁止使用、必须购买授权或整个项目必须更换许可证的结论。PMX、角色贴图等其他资源的权利不在本轮判定范围。

下一步最有效的证据是固定版本对应的许可文件历史副本，或Blender维护者/相关作者明确说明适用许可证、文件范围和通知义务的记录。未发送对外询问，也未替用户接受任何许可。

## 辅助记录与执行边界

只读研究代理记录保存在web/.scratch/ocio-license-audit/upstream.md；其中尚未完成的远端哈希核对已由主会话补齐，见本文。生产代码、渲染参数、LUT原文件、许可状态标记和服务没有修改。此前Web检索未返回可用正文，主会话通过官方原始URL的HTTP请求完成上述文件核对。
