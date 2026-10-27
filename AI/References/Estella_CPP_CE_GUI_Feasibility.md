# Estella 纯 C++ 与 CE_GUI 接入可行性

研究日期：2026-10-27。性质：源码研究与方案建议，未实现或编译原型。

## 结论

**可行，但准确定位应是：复用 Estella 的 C++ 底层，建立自己的 C++ 游戏运行时与 CE_GUI 内容管线。**

不需要为了替换编辑器而重写渲染器或 ECS；也不能通过删除 TypeScript 桥接就获得完整的纯 C++ 游戏框架。上游 SDK 包含大量运行时功能，原生宿主也依赖它。

自有代码集中放一个目录、上游源码尽量不改，是合理路线。它能够减少 Git 合并冲突；**不能保证升级无需适配**，因为上游明确将 `src/` 下内部 C++ 头文件排除在公共 API 兼容承诺之外。

建议先验证一个目标平台和少量 CE_GUI 功能，确认适配边界后再扩展。若目标同时包括完整 UI、地图、水体、字体与多平台交付，这是一项运行时开发工作，不能按“少量桥接代码”估算。

## 检出基线

- 本地：`/Users/eran/WorkGround/OldKingStudio/EstellaPure`。
- origin：`https://github.com/Tunied/EstellaPure.git`，`master`。
- 原上游：`https://github.com/esengine/estella.git`，本地 remote 名为 `upstream`。
- 研究基线：`ea25a635a381f99ee9d95f39f9127015505f40d5`。
- 本次查询时 fork 与原上游 `master` 均指向该提交。因此仓库名称和描述中的 Pure C++ 尚不代表已经完成去 TS 改造；检出的仍是上游完整工程。
- 保留完整 Git 历史；没有初始化子模块，没有下载 Dawn / QuickJS / SDL 构建依赖，没有安装 npm 包。
- `desktop` 是可选私有编辑器子模块，本方案不使用它。没有初始化它并不妨碍研究公开引擎源码；不能据此声称本机已具备所有编译依赖。

## 1. 原工程实际分层

| 层 | 主要位置 | 当前职责 | 纯 C++ 方案的处理 |
| --- | --- | --- | --- |
| 原版编辑器 | 可选私有 `desktop` 子模块 | 内容创作与编辑器产品 | 不使用，以 CE_GUI 承担其已有的创作范围 |
| TS SDK | `sdk/src/` | App、World、系统调度、场景、Prefab、资源生命周期、输入、UI 行为、物理同步、文本编排等 | 不在游戏中加载；按需要由自己的 C++ 运行时提供 |
| 语言桥接 | `src/esengine/bindings/`、`native/host/bindings/` | embind / QuickJS、布局反射、调用与数据传递 | 直接 C++ 调用通常无需 JS 注册层；部分可移植入口本身仍可复用 |
| C++ 核心 | `src/esengine/` | ECS 存储、变换、渲染、GPU 抽象、资源池、布局、动画、粒子、Tilemap 等 | 尽量直接链接与复用 |
| 平台宿主 | `native/host/`、Web / 微信加载环境 | 窗口、GPU surface、生命周期、平台服务及 SDK 启动 | 建立自己的 C++ 宿主；参考现有平台实现 |
| 构建与资源管线 | `cmake/`、`build-tools/`、`pipeline/` | 引擎编译、资源加工、SDK 打包与平台产物 | 复用可独立使用部分；替换依赖原 SDK 的启动和内容约定 |

关键证据：

- [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) 的 Overview 和分层图列明 TS 的运行时职责。
- [`native/host/Host.hpp`](../../native/host/Host.hpp) 开头列出宿主、SDK bundle、游戏导出三层。
- [`native/README.md`](../../native/README.md) 明确说明没有第二套 JS-free 宿主。
- [`native/host/Host.cpp`](../../native/host/Host.cpp) 的 `boot()` 调用 `initRuntime()` / `runPackagedGame()`；`frame()` 调用 JS `update`，默认 SDK 掌管帧。
- [`native/host/bootstrap.js`](../../native/host/bootstrap.js) 将 `update(dt)` 交给游戏的 `app.tick(dt)`。

所以“原生 C++ 编译”不等于“现成游戏路径没有 TS/JS”。原工程原生路径仍运行编译后的 SDK JavaScript。

## 2. 可以复用什么，还缺什么

| 模块 | 已确认可复用的基础 | 自有层仍须承担的工作 |
| --- | --- | --- |
| ECS / 游戏逻辑 | `ecs::Registry`、typed component、`ecs::System` / `SystemGroup` | 注册自己的组件、确定系统执行阶段、帧和固定步长策略 |
| 引擎初始化 | `EstellaContext::init(Unique<GfxDevice>)`，服务注册与查询 | 创建设备与窗口、拥有对象生命周期、异常与恢复策略 |
| 渲染 | `RenderFrame` 的 begin / collectAll / flush / end，`addPlugin`，`GfxDevice` | 驱动相机 / UI pass、提交时序、屏幕与世界域、Resize 与 present |
| 图片 / UI 图元 | Sprite、UIVisual；普通图、九切、重复、填充等基础 | CE 数据与资源句柄映射、坐标、层级、透明度、绘制顺序和填充语义 |
| 布局与命中 | C++ Yoga 布局与 `UISystem` 的 ray hit-test | CE RectTransform 方程、事件派发、多指 / 点击 / 拖拽 / 焦点策略 |
| 文字 | C++ BitmapText / SDF 基础，原生 `glyph_raster` | 动态图集编排、换行 / AutoSize / 回退 / 字距、CE 描边阴影与字体一致性 |
| 动画 | C++ TweenSystem 与缓动基础 | CE 多轨关键帧、Seek / 循环、图片锚点、层级变换、运行时换图 |
| 场景与资源 | C++ Registry / ResourceManager / 资源池 | 自有内容格式加载、Prefab 实例化、资源引用 / 释放、场景切换 |
| 物理 | Box2D / Jolt 及 C++ 模块实现 | 实体与物理对象同步、固定步长、碰撞事件、生命周期整合 |

上述是源码中的能力与接入点，不是本项目已经验证的完整功能。无需复制整个 TS SDK；仅实现自己的游戏实际需要的部分。上游新增 TS 层功能，也不会因合并 C++ 代码就自动出现在自有运行时中。

特别注意：

- [`src/esengine/ui/UISystem.hpp`](../../src/esengine/ui/UISystem.hpp) 明确把“命中后点击 / 悬停意味着什么”留给 TS 交互系统。
- [`sdk/src/ui/text/text-renderer.ts`](../../sdk/src/ui/text/text-renderer.ts) 管理动态 glyph atlas 与文字图元编排；不能把已有 C++ 光栅化理解成完整文本系统都已在 C++。
- [`sdk/src/scene/scene.ts`](../../sdk/src/scene/scene.ts)、[`sdk/src/prefab/`](../../sdk/src/prefab/)、[`sdk/src/physics/PhysicsSystem.ts`](../../sdk/src/physics/PhysicsSystem.ts) 是去 TS 后需要替代或放弃相应功能的具体位置。

## 3. CE_GUI 的接入边界

研究 CE_GUI 当前 Overview、LayaAir_Integration、Tween_Animation、Map_Editing，以及 `model.ts`、`project-store.cjs`、`project-export.cjs` 和现有导出类型后，确认：

1. CE_GUI 自身是 Electron / React / TypeScript 编辑器；本方案理解为保留它，**新游戏和自有运行时采用 C++**，不要求把现有编辑器改写。
2. 现有 Runtime 只有 none / TapTap / LayaAir；不能把 Estella 目录传给 LayaAir 导出就直接工作，目标目录与运行时均有专门约定。
3. 普通 UI 使用 Anchor Min/Max、Pivot、position、sizeDelta、XY Scale；源坐标左上原点、Y 向下。
4. Estella 当前 UINode 主模型是 CSS / Flex / Yoga；Sprite 的 pivot 文档采用左下原点。不能按字段同名直接复制，需要显式坐标与布局转换。
5. 图片、字体、嵌套 Prefab、独立补间、标记等需要各自的运行时实现。现有 Lua / Laya Runtime 不能在纯 C++ 游戏中直接运行。
6. CE 地图 / 双网格与液体当前仅编辑器使用，不参与现有 Runtime 导出。地图采样、遮罩、阴影、层合成和液体 Shader 必须另外定义内容与渲染契约。
7. CE 的 WebGL 液体 Shader 不等于 Estella 原生 Dawn 可直接使用的程序；需适配材质、资源绑定及 WGSL 等目标路径，并验证表现。
8. CE_GUI 是 GUI / 二维内容工具；它当前没有替代原版全部 3D 场景创作能力。若游戏需要 3D 创作，需另定资产和场景输入方式。

### 符合“不编写 TS”的优先方案

**由自有目录里的 C++ 离线内容工具读取 CE 工程，输出版本化运行包，再由 C++ 游戏加载。**

```text
现有 CE_GUI 编辑并保存
    → project.tapui.json + assets + 独立动画文件
    → 自有 C++ 内容转换工具
    → 自有版本化 JSON / 二进制 + 发布资源
    → 自有 C++ Runtime
    → Estella C++ 核心
```

这条路线初期可以不修改 CE_GUI，也不新增 TS 代码。JSON 是内容数据，不意味着使用 JavaScript 执行逻辑。

C++ 转换工具须正确处理原始工程格式：动画在磁盘中是内容哈希文件索引，Prefab 有引用与覆盖，资源有永久 ID、导出排除 / 原样导出、占位图和编辑参考对象。不能仅复制 JSON 和全部 assets；要完成验证、引用收集、展开、过滤和资源打包。

源工程格式目前属于 CE_GUI 存储约定，不应当成永不变化的发布 API。把读取它的代码限制在 `CEReader`；发布包拥有自己的 schema 版本。编辑器存储变化由 CEReader 消化，引擎变化由 EngineAdapter 消化。

如果以后希望在 CE_GUI 中增加“一键导出 Estella”，可以单独增加导出目标并复用现有收集 / 同步逻辑；该方案通常涉及编辑器现有 JS/TS 代码调整，应在后续需求明确允许时采用。本次未修改 CE_GUI。

## 4. 推荐目录与依赖方向

以下仅为建议，不代表已经创建实现文件：

```text
EstellaPure/
├── src/、sdk/、native/、cmake/……  上游目录尽量原样保留
├── OldKing/                        自有实现的唯一主目录
│   ├── cmake/                     自有构建入口与上游目标接入
│   ├── EngineAdapter/             限制直接使用 Estella 内部接口的范围
│   ├── Runtime/                   C++ 帧调度、资源 / 场景、输入和 UI
│   ├── Content/                   CEReader、校验、转换与发布包 schema
│   ├── CEGUI/                     RectTransform、图像、文本、动画、地图适配
│   ├── Game/                      自有游戏组件与逻辑
│   ├── Platform/                  桌面 / 移动 / Web 宿主边界
│   └── Tests/                     内容契约与适配层测试
└── AI/                            当前事实与研究资料
```

业务依赖自有接口，EngineAdapter 才集中包含上游内部头文件；资源和持久化 ID 不直接使用 ECS entity ID。自有组件定义在自有目录，不为每个业务功能修改上游组件、反射生成器或生成文件。

布局建议先由自有 CE 布局器忠实计算 CE 的矩形，再通过一个受控出口写入引擎组件 / 图元。需要明确谁拥有最终位置与尺寸，避免 CE 布局和 Yoga 每帧互相覆盖。是否完全使用 UIVisual，或对特殊图元使用 RenderTypePlugin，留待原型验证。

## 5. 怎样尽量少改原代码

- 原版编辑器本来就是可选模块，无需为了不用它去删除相关源码。
- 自有入口链接 C++ `esengine`，不启动原 `estella_js_host`，不加载 TS SDK bundle / QuickJS 游戏路径。
- 原生 `native/CMakeLists.txt` 中 `esengine` 静态库位于 `if(ESTELLA_QUICKJS_DIR)` 宿主条件之外；说明库与 JS 宿主在构建结构上可分离。但该构建仍要求 Dawn、桌面 SDL 和其它原生依赖，不是开箱即用的纯 C++ 示例工程。
- [`cmake/ESEngineSources.cmake`](../../cmake/ESEngineSources.cmake) 是 Web 与 Native 共享的 C++ 源码列表。优先复用已有构建目标 / 列表，避免在自有目录复制并维护整个渲染器源码清单。
- 根 CMake 显式定义 `ES_PLATFORM_WEB`，并会通过 EHT 产生 Web / TS 绑定；不能把根构建简单理解成通用原生 SDK 安装入口。
- 优先让 `OldKing` 自有 CMake 作为外层入口；若必须修改上游，限制为可选构建开关或宿主回调等通用接入点，单独提交。不要在核心每个子系统插入 CE_GUI 特判。
- 现有可移植 binding 实现有部分被 native 核心复用；纯 C++ 路线不要求机械删除所有名叫 bindings 的代码，也不要求从仓库中抹去所有 TS 文件。

目前没有编译原型，不能承诺最终一定零补丁或准确需要改几个文件；从现有注入和扩展接口看，**尚未发现必须大规模修改渲染 / ECS 核心才能实现此方案的架构障碍**。

## 6. 上游同步会不会很麻烦

必须把两种成本分开：

| 变化 | Git 合并冲突 | 自有层维护成本 |
| --- | --- | --- |
| 仅增加 `OldKing`，上游只改自己的文件 | 通常较低 | 内部 C++ 类型或行为变化仍可能导致编译 / 语义适配 |
| 少量独立 CMake / 宿主钩子补丁 | 低到中，取决于是否修改同一位置 | 逐个复核小补丁并运行契约验证 |
| 向 Registry / RenderFrame / UINode 大量加入 CE 特例 | 高 | 核心重构时需要反复人工合并，接近长期深度 fork |
| 上游新增 TS SDK 功能 | 可能无冲突 | 自有 C++ 运行时不会自动获得该功能；自行决定是否补充 |
| 上游调整原生宿主 / 依赖 | 自有宿主可能无文本冲突 | 设备恢复、surface、编译依赖和平台行为仍需跟进 |

[`VERSIONING.md`](../../VERSIONING.md) 第 34–36 行明确写明：`src/` 内部 C++ 头文件不属于公共 API，可以在任意版本变化。该承诺直接限制了“每次直接更新即可”的预期；SDK / WASM ABI 的兼容承诺不能自动套到直接 C++ 调用上。

建议的维护方式：

1. origin 保留自己的 fork；upstream 指向原引擎。
2. 研究基线、适配层与游戏代码保持可识别边界；尽量不移动 / 格式化上游文件。
3. 使用固定通过验证的上游提交，按需要升级；保留 Git 历史，通过正常 fetch / merge 同步，不用整目录覆盖。
4. 每次升级检查 EngineAdapter 依赖的接口、共享源码列表、原生依赖与实际调用语义。
5. 用有意义的小型契约用例保护创建 / 销毁、Resize、层级变换、CE 布局、资源释放、绘制顺序与动画 Seek；再由用户验收实际画面和设备行为。

这些措施降低冲突与定位成本，不消除升级工作。若以后项目独立增长，还可把自有层移为外层项目、将引擎作为固定提交依赖；当前单目录方案也足以开始，不必提前重排整个 fork。

## 7. 平台与“完全 C++”的边界

| 目标 | 判断 | 必须保留的现实边界 |
| --- | --- | --- |
| 桌面 Native | 可作为首个平台候选 | 自有窗口 / 帧循环与平台服务，链接 C++ 核心及 Dawn 等依赖 |
| Android / iOS Native | 可行，需要平台宿主与打包 | iOS 等平台可能需要少量 Objective-C++ / 原生启动壳；不等于游戏逻辑使用 TS |
| 浏览器 | C++ 逻辑编译为 WASM 可行 | 加载、Canvas、浏览器 API 等通常仍需 Emscripten / JavaScript glue，不能承诺发布物零 JS |
| 微信小游戏 | C++ / WASM 逻辑路线可研究 | 微信 JS 宿主、WASM 加载、Canvas 与平台接口 / 包体契约要另外接通；不能沿用原 TS 启动器后称为去 TS 完成 |

同样，构建工具已有 JavaScript / Python，着色器需要目标语言；“自己的游戏与运行时不用 TS”与“仓库、工具链、平台壳和发布物只允许 .cpp”是不同约束。后一种要求不能由现有工程直接满足，也与保留现有 CE_GUI 不一致。

本研究按前一种解释评估。尚未指定首发平台，因此不能确认哪套平台壳、包体和宿主适配是最终范围。

## 8. 后续原型的建议验收点（本次不执行）

1. 单个平台：自有 C++ 入口创建窗口 / 设备、初始化上下文、绘制一张图片并正确关闭；不加载 SDK JS 或 QuickJS。
2. C++ 内容工具读取一个 CE Prefab，覆盖嵌套 Container、拉伸 / Pivot、透明度、九切、动态文字 / 换图与 Resize。
3. 加载一段 CE 动画，验证层级、负缩放、锚点、Seek 和播放控制。
4. 若需要地图，单独验证双网格、Mask、阴影和液体；不要把现有编辑器预览视作已完成游戏支持。
5. 用这批有限功能做一次上游升级演练，实际测量需改动的适配面，再评估扩大范围。

## 研究验证边界

已完成仓库检出、fork / 上游提交核对，以及运行时、原生宿主、构建入口、C++ 扩展点和 CE_GUI 当前格式的源码交叉检查。

本次只新增研究 / Context 文档，未修改上游引擎、CE_GUI、游戏逻辑或任何队列设置；未初始化依赖、编译、运行引擎、执行测试、启动 GUI 或做设备验收。可行性是源码级架构判断，尚不是原型运行证据。
