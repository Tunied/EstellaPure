# 温室美术套件 · 第一版

沿用居住舱的暖白涂装、橙色结构条、金属扣件和通透玻璃。温室由 12 个新模型组成，并直接复用居住舱的门洞与入口台阶。当前专注美术资产，未接入生长、供水或建造逻辑。

![温室实际模型渲染](../../reviews/greenhouse-v1/01-greenhouse.png)

## 交付

- [可编辑 Blender](greenhouse-v1.blend)：独立零件位于 `LIBRARY`，复用部件位于 `DEPENDENCY`，58 个共享网格实例位于 `ASSEMBLY`。展示布局单独保存且默认隐藏。
- [12 个独立 GLB](../../models/greenhouse-v1/)、[资产清单](asset-catalog.json)、[装配布局](assembly.json)。文件内嵌微表面贴图，单位为米，GLB 为 Y-up。
- [主要拆件图](../../reviews/greenhouse-v1/03-garden-modules.png)、[种植床/作物/灌溉设备](../../reviews/greenhouse-v1/02-growing-bed.png)、[导出后重新组装](../../reviews/greenhouse-v1/04-export-roundtrip.png)、[资产检查结果](../../reviews/greenhouse-v1/asset-check.json)。图均为实际模型离线渲染。

| 模块 | 用途 |
| --- | --- |
| garden-floor-2m | 2×2 米底板，带排水槽 |
| garden-wall-glass-2m | 2 米宽玻璃墙，密封条与竖向窗棂分层 |
| garden-door-glass-120 | 独立玻璃门扇，与净宽 1.20 米的居住舱门洞配合 |
| garden-corner-post | 2.8 米高端部角柱 |
| garden-roof-glass-half-2m | 半跨弧顶玻璃，每段纵向长 2 米 |
| garden-arch-half-2m | 可独立放置的半跨弧形骨架 |
| garden-roof-end-half-2m | 温室前后端的弧形玻璃封板 |
| garden-ridge-2m | 屋脊与下挂灯条 |
| garden-gutter-2m | 独立檐沟与支架 |
| growing-bed-2m | 可独立摆放的种植床，带滴灌管与设备面板 |
| crop-tray-leafy | 独立叶菜托盘，作物不合并到种植床 |
| garden-irrigation-unit | 独立泵柜与接口 |

复用依赖为 `art/models/habitat-v2/wall-doorway-2m.glb` 和 `entry-step-2m.glb`，在清单中记录为 `habitat/…`。复用门洞上的 HAB 01 是该门框的部件标识；温室门扇和墙面使用 GARDEN 标识。

## 安装和扩建

示例使用 4×6 米中心网格；角柱、檐沟和台阶会突出该网格边界。地板面为 0.21 米，墙高 2.8 米，弧顶安装基准为 3.01 米，屋脊最高处约 4.04 米。

当前弧顶固定跨宽 4 米，由两个 2 米半跨件组成。**沿温室纵向每增加 2 米，增加两块地板、两块侧墙、两片屋顶玻璃、一对骨架、两段檐沟和一段屋脊，再外移端墙。**半跨件通过 180° 旋转复用另一侧，尺寸不拉伸。前后封板与端部角柱保留在新的两端。横向联排还需要专用谷沟、接柱和跨间连接件，本版不宣称已支持任意加宽。

Blender 源文件以 Z 为上，地板中心为局部原点。墙外侧朝 −Y，底边中点安装；屋顶半跨原点位于屋脊正下方的墙顶标高，局部 X 从 0 延伸到 2 米，局部 Y 从 −1 到 1 米；最高玻璃边在 Z=0.9 米。清单和根对象同时保留源坐标与 GLB 坐标安装点。

种植床底面原点独立，作物托盘安装在床的局部 Z=0.677 米。床、作物、灌溉柜都能单独移动或替换。滴灌管与接口目前是外观细节，未实现流体或生长系统。

## 材质和当前边界

玻璃使用 `KHR_materials_transmission`，需要目标渲染器支持并再次验收。梁、门窗、灯带和底座与居住舱共用材质定义；粗糙度和微表面法线图随独立文件打包。叶菜使用独立叶片网格和两种绿色材质，目前没有风动、成熟阶段或收获动画。

当前是干净涂装美术稿，尚未完成磨损/水渍贴花、LOD、碰撞和目标设备性能验收。透明屋面、玻璃墙与植物同时出现时的实际绘制开销需要后续接入再测；离线渲染并不代表引擎表现。

## 后台复现

先生成居住舱，再生成温室。两者使用同一组建模辅助定义，运行期间只创建本套件资产，不启动可见窗口：

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python-exit-code 1 --python games/star-neighbors/art/source/habitat-v2/build_habitat.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python-exit-code 1 --python games/star-neighbors/art/source/greenhouse-v1/build_greenhouse.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python-exit-code 1 --python games/star-neighbors/art/source/habitat-v2/check_exports.py -- --kit greenhouse-v1
```

检查覆盖新部件及两个复用依赖的独立 GLB 导入、有限坐标/UV、尺寸、三角面、退化面和嵌入贴图，并用这些导出文件重新拼装和渲染。
