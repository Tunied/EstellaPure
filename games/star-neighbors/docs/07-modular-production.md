# 模块化制作约定与样区交付

日期：2026-10-22。用户明确要求“必须模块化”。本文件约束当前试作及后续扩展；已实现项和未来接口分别说明。

当前新版美术按套件存放：[habitat-v2](../art/source/habitat-v2/README.md) 含 22 个居住舱模型与 7×5 米、13×9 米房间拼装对照；[greenhouse-v1](../art/source/greenhouse-v1/README.md) 含 12 个温室模型；[connections-v1](../art/source/connections-v1/README.md) 含 20 个连接与室外平台模型；[living-v1](../art/source/living-v1/README.md) 含 27 个生活与社交道具；最新 [nature-v1](../art/source/nature-v1/README.md) 含 24 个地表、小路、岩石与植物模块，共 105 个新版独立模型。自然环境组合在 24×24 米地块上复用住宅、温室与露台，并提供树干／树冠拆分和成人尺度对照。安装细节以各目录说明为准；尚未替换下述首版 Web 样区。依用户最新要求，当前工作只负责美术资产，程序由用户负责。

## 1. 当前交付

23 个独立 GLB 与对应 Estella 预制体：16 种建筑/道具/植物部件、1 个比例人偶、4 个地表块、1 个远景、1 个天空。样区由 55 个布局实例组成。运行时有 19 个共享材质文件；同一部件的实例共用网格和材质引用。模型按材质合并绘制子网格，不将整座基地合成一个不可拆模型。

目前验证的是本地结构拼装、观察镜头、灯光和原生 2D 交互。样区的 4 个地表文件尚未接入动态流式加载；不存在服务器、账号、存档、物理角色移动或星球程序生成。星门是视觉部件，还不能传送。

## 2. 建模与资产接口

| 约定 | 当前值与用途 |
| --- | --- |
| 空间单位 | 3D 采用 1 单位 = 1 米；2D Canvas 独立采用设计像素 |
| 坐标 | GLB 与引擎 Y 向上；Blender 构建工具统一转换坐标 |
| 水平网格 | 2 米；墙端点和地板中心按同一坐标系装配 |
| 墙体 | 宽 2 米、高 2.8 米；底部中心为安装原点 |
| 地板 | 2×2 米；基础厚度 0.16 米，上层面板至 0.21 米，紧固件略突出 |
| 屋顶 | 名义跨度 2 米，外形 2.04 米，允许轻微檐口搭接；安装高度为地板面 + 墙高 |
| 道具原点 | 基座底部中心；植物为根部；机器人悬浮高度由实例指定 |
| 环境原点 | 当前地表、远景、天空使用样区世界原点；不能当成局部原点的可无限平铺地形 |
| 命名 | 文件为 `kebab-case`；子网格为 `部件__材质`；运行时实体前缀区分实例 |
| 外观 | 材质使用语义名称，如 ivory、steel、soil；色板集中在 kit-spec.json |
| 导入身份 | `.meta` UUID 随资产保留，重建工具不改已有身份；场景目前用项目相对路径引用 |

关键文件：[规格与色板](../art/source/kit-spec.json)、[实际尺寸与三角面清单](../art/source/asset-catalog.json)、[装配布局](../art/source/sample-layout.json)、[可编辑源文件](../art/source/star-neighbors-art-sample.blend)。源文件中 `KIT/` 保存独立部件，`SAMPLE/assembly` 使用共享网格副本；编辑公共网格会更新其所有副本。

墙、窗、门可互换，屋顶和地板按格扩展。种植箱与作物分离，后续生长只替换作物状态；星门、机器人、太阳能板和货箱各有独立资产。建筑接口的吸附点目前由网格和原点表达，尚无自动插槽/管线连接系统。

## 3. 运行时代码职责

| 文件 | 唯一职责 |
| --- | --- |
| `src/main.ts` | 注册资源与系统，不写具体玩法 |
| `src/state.ts` | 本地试作状态和初始值，每次启动重置 |
| `src/camera.ts` | 观察镜头的移动、转向与复位 |
| `src/construction/rules.ts` | 部件占地、网格、旋转、重叠和庭院边界，纯规则可独立测试 |
| `src/construction/system.ts` | 输入转为选择/放置/撤回，驱动共用预制体实例 |
| `src/lighting.ts` | 日夜灯光、天空与维修机器人浮动 |
| `src/hud.ts` | 状态文本和只读验收信息，不复制建造规则 |
| `src/scene-access.ts` | 场景实体定位与组件操作；缺少命名实体立即报错 |

当前展示对象池预载 8 组、每组 3 种候选模型，仅启用被选中的网格。它是简单、可验证的样区实现，并非海量建造的最终实例化或内存方案。新增可建造类型需要同时登记规则、对象池和 UI；目前没有通用内容插件系统。

## 4. 后续玩法边界

以下为设计接口，**尚未实现**：

| 模块 | 管理的数据 | 对外动作与边界 |
| --- | --- | --- |
| 星球目录 | planetId、种子、尺度档、所有者、公开信息 | 发现/查询/认领；不管理地表渲染 |
| 区块加载 | planetId + chunkId、加载状态、实体快照 | 加载/卸载；不决定归属和权限 |
| 建造服务 | moduleId、变换、占地、建筑状态版本 | 放置/移动/拆除；服务器检查权限、重叠和资源后确认 |
| 背包与生产 | 资源账目、配方、容量、结算进度 | 幂等扣料/产出；不依赖 UI 文本或模型名称 |
| 社交与访问 | 邀请、关系、共建权限、访问状态 | 授权/撤销/访问；不直接写建筑存档 |
| 跨区转移 | 来源、目标、转移标识、确认状态 | 请求/确认/恢复；星门外观只呈现状态 |
| 持久化 | 稳定实体 ID、领域版本、事件与快照 | 保存/恢复/迁移；不保存运行时临时实体编号 |

客户端建造预览与服务端最终校验应共享同一份部件定义，避免两边的尺寸与规则漂移。请求带唯一 commandId、星球与区块 ID、moduleId、变换及预期版本，成功结果再驱动界面和音效。素材重制不得改变既有 moduleId；场景实体名仅服务当前试作，不能成为未来存档键。

## 5. 可复现流程

在仓库根目录执行。Blender 只运行后台，不打开编辑器或可见窗口：

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python-exit-code 1 --python games/star-neighbors/tools/build-art-sample.py
node games/star-neighbors/tools/import-kit.mjs
node games/star-neighbors/tools/assemble-scene.mjs
node tools/asset-meta.js games/star-neighbors/assets
node --test games/star-neighbors/tools/construction.test.mjs
node games/star-neighbors/tools/check-kit.mjs
node sdk/node_modules/typescript/bin/tsc -p games/star-neighbors/tsconfig.json
node pipeline/bin/estella.mjs export games/star-neighbors --out output/star-neighbors/web
node games/star-neighbors/tools/verify.mjs
```

`build-art-sample.py` 固定随机种子，保留每个部件独立集合，并导出布局、尺寸与三角面数量。`import-kit.mjs` 将模型导入各自目录，统一材质引用，保留已有网格/预制体身份。`assemble-scene.mjs` 只装配场景，UI 布局在 `hud-layout.mjs`。验证截图位于仓库 `output/star-neighbors`，交付快照复制至 `art/reviews`。

## 6. 当前证据与下一道验收

- [实际日景](../art/reviews/engine-day.png)、[实际夜景](../art/reviews/engine-night.png)、[建造后](../art/reviews/engine-built.png)、[1280×720 布局](../art/reviews/engine-1280.png)。
- [无界面运行报告](../art/reviews/verification.json)：真实键鼠驱动网格移动、旋转、放置、重叠拒绝、取消、撤回、UI 选择、灯光切换和镜头复位。
- 纯规则用例覆盖旋转占地、合法贴边、静态/动态占用、完整占地越界、对象池限制与无效输入。
- 资产检查覆盖独立原点、布局引用、共享材质、父子关系、文件存在和 UUID 唯一性。TypeScript 检查与 Web 导出通过。

这不是最终视觉验收。当前建筑外轮廓仍偏方正，环境层次、草土边界、窗玻璃、温室、星门效果及服装材质都未达到选定参考图的完成度；需继续用同一主参考调整。现阶段保留成年比例的参考多视图，不以灰色比例模型代替正式人物。

正式角色需依次通过比例与多视图、身体、面部、服装、拓扑/UV、材质、绑定、引擎动作验收。当前只建立待评审参考，未越过后续步骤。角色参考依据选定主图制作，完整描述保存在 [settler-reference.txt](../art/prompts/settler-reference.txt)。

尚无用户受众研究、真实设备性能、多人承载或编辑器验收；编辑器验证按仓库要求只在 CI 做。不得将本样区状态写成 M1 全部完成。

## 7. 来源

比例人偶来自 MPFB 的 CC0 MakeHuman base，仅提取 body 并等比缩放。原始声明与来源见 [third-party/README](../art/source/third-party/README.md)。天空光照沿用本仓库 `examples/lighting-3d/assets/env` 的程序天空数据（仓库 Apache-2.0）；可见天空几何由样区工具构建。人物参考是美术讨论稿，未作为网格、贴图或人脸扫描导入运行时。
