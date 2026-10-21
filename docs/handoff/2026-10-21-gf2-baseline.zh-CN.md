# GF2 通用化的来源版本

本次提交固定主工作区已经运行并验收的 GF2 mode，供隔离工作区继续开发。来源分支为 `codex/local-interactive-integration`，提交前 HEAD 为 `dbbeb67722891a29d0cab7cdae920a474373bbe2`。

## 固定内容

包括克莱妲捕获渲染器、正式舞台入口、资源包加载、透明输出、frontline 界面、全息入场、点击收藏动作、v14d 武器及其共用舞台依赖。舞台页面、资产接口和配置存储中已经存在的动作库与眼部设置随依赖文件保留；本次没有重新实现或重新认证这些既有功能。

API 主入口只纳入 GF2 资源公开路径这一处修改；Hermes、Electron、移动端等独立工作区改动保留在原目录，不属于本提交。没有修改运行服务、数据库、用户配置或原始模型。

## 版本证据

固定前核对 `.scratch/gf2-render-research-20261020/stage-integration/click/files.json` 的 33 个文件，摘要全部相符。沿用该目录的实际 Chrome 点击与舞台检查，以及同级 arrival 和 optimization 的未受影响结果，完整解释见 `2026-10-21-gf2-stage-mode.zh-CN.md`。本次不声称对全仓其他功能进行了新的测试。

整理范围与原始摘要保存在 `.scratch/gf2-render-research-20261020/baseline/selection.json`。该本地记录包含共享代码继承情况；工作区中的源文件保持不变。Git 的换行归一化不视为功能修改。

## 独立运行所需本地输入

- 游戏原始资源：`F:/GF2Exilium/GF2 Game`。
- 捕获资源与已打包文件：主工作区 `output/gf2-barrack-materials/`。它们是本地资源输入，不随源码提交自动复制。
- PMX：`D:/mmd/克莱妲原皮/Koleda_v1.1_动作兼容.pmx`，SHA256 为 `441edc6e3ce7f1e9545906d8ba2df4c6682659f1d066946d49b26c863c6bb4c4`。
- 武器：主工作区 `web/public/stage-assets/` 中现有克莱妲武器与动作资源。
- 入场、待机：主工作区 `ak-12/vmd/v1.1/查验_2026.10.12_09.59.39/`。
- 完整专属查看动作：主工作区 `.scratch/koleda-current-preview-20261018/assets/`。
- 浏览器与 Python 依赖：沿用锁文件及主工作区现有运行环境；隔离开发先核对应输入，不复制用户数据库，不占用正式 3100、8100、18748 服务。

隔离工作区取得源码不等于已经完成独立运行验收。复制资源或提供明确的只读输入入口后，才运行新版本检查。新导出资源必须写入隔离目录。
