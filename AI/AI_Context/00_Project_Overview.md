# EstellaPure

## 项目定位

- 本地仓库：`/Users/eran/WorkGround/OldKingStudio/EstellaPure`。
- origin：`https://github.com/Tunied/EstellaPure.git`，默认分支 `master`；GitHub 上游为 `esengine/estella`。
- 本地 `upstream` remote 指向 `https://github.com/esengine/estella.git`。研究基线见可行性资料；尚无纯 C++ 实现分支差异。
- 主要仍为源码研究；现已增加独立 C++ 微信 HelloWorld 对照宿主，用于与 CopyEngine 的 iOS 启动问题比较。CE_GUI 接入与完整纯 C++ 游戏运行时尚未实现。
- CE_GUI：`/Users/eran/WorkGround/OldKingStudio/CE_GUI`，现有工具继续使用；不要求将其 Electron / TypeScript 编辑器本身改写成 C++。

## 技术与关键目录

- C++20：`src/esengine/` 为 ECS、渲染、布局、动画等底层；`cmake/` 管理共享源码与构建选项。
- TypeScript：`sdk/` 为运行时 SDK；不能预先当作仅有语言桥接。
- `native/`：原生构建与宿主；现有完整游戏路径包含 QuickJS 与 SDK。
- `build-tools/`、`pipeline/`：构建、资源处理与打包工具。
- `desktop` 为可选私有编辑器子模块，本研究不依赖它。

## 工作约束

- 除 `examples/wechat_hello/` 的独立设备对照实验外，当前保持研究范围；不修改 CE_GUI 或上游引擎源码。
- 优先保留上游源码，将未来自有实现集中在独立目录；不删除 TS 或编辑器相关源码来制造纯 C++ fork。
- 持续命令通过 `/Users/eran/.local/bin/ai-queue`，遵守全机 POLICY；不修改用户队列设置。
- HelloWorld 允许 C++/WASM 构建及无窗口自动WebGL检查；GUI、iOS真机与功能验收仍由用户执行。研究结论不能借此视为全部实现。

## 资料导航

- 根目录 `AGENTS.md`：仓库交付规则。
- `README.md`、`native/README.md`：上游架构与现有宿主说明；产品宣传与本地验证证据须区分。
- CE_GUI `AI/AI_Context/00_Project_Overview.md`：编辑器数据、功能与专项文档入口。
- [纯 C++ 与 CE_GUI 接入可行性](../References/Estella_CPP_CE_GUI_Feasibility.md)：源码证据、缺口、自有目录建议、同步风险与平台边界。
- [微信 HelloWorld](WeChat_HelloWorld.md)：独立 C++ 核心对照、构建入口与诊断边界。

## 已确认的架构边界

- TS SDK 包含实际运行时逻辑，原生宿主默认使用 QuickJS + SDK，并非现成的无脚本宿主。
- C++ 底层存在上下文 / 设备注入、ECS 系统与渲染插件接入点；纯 C++ 方案需要自有宿主和按需运行时，不必预先重写底层。
- 上游 `VERSIONING.md` 明确不保证内部 C++ 头文件的兼容性；隔离自有目录减少 Git 冲突，但升级仍需适配。
- CE_GUI 当前仅有 TapTap / LayaAir 导出，地图仍仅用于编辑器。若严格不新增 TS，候选路径为自有 C++ 内容工具读取 CE 工程并产出独立版本化运行包；尚未实施。
