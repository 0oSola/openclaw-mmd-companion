# MMD Companion 便携 Release 包

包名：mmd-portable-0.1.0-20260902-193631-682

这是 ZIP 便携包，不是安装器，也不包含 NSIS/注册表安装流程。包内已包含 Web production 产物、desktop-pet production renderer/Electron 产物和可直接运行的 Node 依赖目录；当前仍要求目标机已有 Python、Node.js/npm，以及 API 所需的 Python 依赖。

## 启动

在本目录执行：

`powershell
.\start-mmd.ps1 -Action start
.\start-mmd.ps1 -Action status
.\start-mmd.ps1 -Action stop
.\start-mmd.ps1 -Action kill
`

默认 API 端口为 8200，Web 端口为 3200。可用 -ApiPort、-WebPort、-ApiHost、-WebHost、-ApiBaseUrl、-ApiDataDir、-UserId、-WorkspacePath 和 -PetReadyTimeoutSeconds 覆盖。

-ApiDataDir 或环境变量 API_DATA_DIR 一旦显式设置就严格使用；路径或 SQLite 不可用时直接失败，不会静默改写。两者均未设置时，包内默认 pi/data 不可用会安全回退到 .runtime/release-stack/data。运行状态和批次日志分别保留在 .runtime/release-stack.json 与 .runtime/release-stack/<批次>/。

start 按 API、Web、Pet 分别复用当前包中健康且身份匹配的组件，只启动缺失或不健康的组件；状态文件缺失或不完整时，只要能通过当前包路径、命令身份、端口父进程树和 Pet ready marker 证明归属，就会恢复并写回状态。其它包或其它命令占用端口时会保留进程并报告冲突。kill 只清理能由状态记录或严格当前包身份证明确认的进程树和状态/ready 文件，不会按端口、进程名或 PID 泛杀。

## 运行前提

- Windows PowerShell 5.1 或 PowerShell 7。
- Python 3.11+，并在目标环境执行 python -m pip install -r api/requirements.txt。
- Node.js/npm；包内的 Web 依赖可直接运行，但 Node.js 运行时不随包提供。
- Electron 可执行文件随 desktop-pet/node_modules/electron 提供；启动仍需要 Node/npm 及 Windows 图形环境。

## MMD 资源

本包检测到并复制了源码 MMD/ 下的本地资源。模型、贴图、动作和音频可能属于第三方，未经授权不得再分发。

## 故障排查

先执行 -Action status 查看 API/Web/Pet 的进程身份、HTTP 健康状态、renderer 文件和 renderer ready marker。需要清理当前包残留时执行 -Action kill；详细 stdout/stderr、Pet ready marker 和 debug event 日志在 .runtime/release-stack/<批次>/，stop/kill 只处理本入口记录或严格证明属于当前包且命令身份仍匹配的进程。

如果启动提示 Python、npm、Electron 或产物缺失，请按错误中的中文命令补齐环境；源码根目录的 .\start-mmd.ps1 -Action package 会重新生成一个带时间戳的包。