# 居住舱美术套件 · 第二版

本轮聚焦模型、材质与模块组合。主参考为 [用户选定的温暖科幻场景](../../concepts/selected-warm-sci-fi.png)。采用暖白涂装、赭橙结构条、深灰密封胶、裸露金属与轻微青色玻璃，保留圆润但可信的建筑比例。

这是一套待评审的实际 3D 资产，不是概念图。当前是干净涂装版本；尚未制作污渍、磨损贴花、LOD、碰撞体或门动画，也未替换原 Web 样区。玻璃以标准 glTF transmission 扩展交付，接入目标渲染器时需单独验收透射效果。

## 文件与展示

- [可编辑 Blender](habitat-v2.blend)：`LIBRARY` 保留按模型拆分的原始零件，`ASSEMBLY` 使用共享网格实例；模型没有合成一整座不可拆建筑。`REVIEW` 是隐藏的模块展示布局。
- [22 个独立 GLB](../../models/habitat-v2/)：每个模型有安装原点，按材质合并绘制网格；法线、UV、粗糙度和微表面法线贴图包含在文件内。新增独立梁、柱和梁端连接件用于大房间美术拼装。
- [组装渲染](../../reviews/habitat-v2/01-assembled.png)、[窗户近景](../../reviews/habitat-v2/02-window-detail.png)、[九种主要模块](../../reviews/habitat-v2/03-module-sheet.png)、[导出文件重新组装的渲染](../../reviews/habitat-v2/04-export-roundtrip.png)。所有图片均由实际模型在 Blender 后台渲染。
- [资产清单](asset-catalog.json) 包含每个部件的实际包围盒、三角面数、材质网格数、安装点；[装配清单](assembly.json) 保留 65 个实例的来源与变换。

## 模块清单

| 类别 | 独立模型 | 组合用途 |
| --- | --- | --- |
| 基础，3 件 | floor-2m、foundation-edge-2m、foundation-corner-r050 | 中央地板、外围补边与圆角基座 |
| 墙体，5 件 | wall-solid-2m、wall-window-2m、wall-panorama-4m、wall-doorway-2m、wall-corner-r050 | 实墙、标准窗、双格全景窗、门洞与圆角 |
| 门与入口，2 件 | door-leaf-110、entry-step-2m | 门扇可独立替换；入口台阶单独安装 |
| 屋顶，3 件 | roof-center-2m、roof-edge-2m、roof-corner-r050 | 平顶中心、卷边屋檐与复合圆角 |
| 设备，2 件 | roof-vent、wall-utility | 屋顶散热器、墙挂设备箱 |
| 室内，4 件 | interior-bench-2m、interior-console、ceiling-light-2m、interior-planter | 长椅、工作台、灯条和盆栽 |
| 大房间支撑，3 件 | support-column-2p8、ceiling-beam-2m、ceiling-beam-end-050 | 独立立柱、顶梁与 0.5 米檐口补跨；不代表已进行结构承载模拟 |

## 尺寸与安装

- 单位为米。Blender 源文件 Z 向上，墙的外侧朝 −Y；GLB 按标准 Y 向上，墙的外侧朝 +Z。
- 2 米为基本跨度，4 米全景窗替代相邻两格墙。墙高 2.8 米，中心层厚度约 0.22 米；窗台、框、设备会突出名义边界。
- 地板上表面 0.21 米，墙根安装在该高度；屋顶根位于 3.01 米，顶面为 3.51 米。微小紧固件略高于名义表面。
- 圆角半径 0.5 米，原点是圆心。原始圆角从 `(0, −0.5, 0)` 连到 `(0.5, 0, 0)`。通过 90° 旋转复用四个角；墙体、基座和屋顶使用对应圆角件。
- 组合示例中央地板为 6×4 米，外轮廓约 7×5 米，四周各加 0.5 米补边。墙位于外侧边界。**这一套圆角并非首版 2 米平顶试作的直接替换件**，需按本套边、角配合使用。
- 墙与门洞原点为底边中点；门扇和门洞共用原点。屋顶边原点为墙顶中点；设备、家具原点为安装底部。灯条原点靠近底壳，顶部安装点在局部 Z=0.07 米。
- 源文件与清单的坐标为 Z-up。GLB 根对象同时记录 `source_sockets_z_up` 与 `glb_sockets_y_up`，避免导入时混用坐标。
- 门洞扣除内侧门框后净宽约 1.20 米、净高约 2.26 米。门扇同步加宽，沿用原 `door-leaf-110` 资产标识以保留引用，该历史编号不再表示门扇宽度。门框、键盘与下沿也一起调整，墙体仍占 2 米一格。

## 扩建与人物尺度

[小房间与大房间对照](../../reviews/habitat-v2/05-room-expansion.png) 使用同一套网格，所有实例保持 1:1 比例。小房间中心地板为 6×4 米，外轮廓约 7×5 米；大房间中心地板为 12×8 米，外轮廓约 13×9 米。中央地板面积从 24 平方米变为 96 平方米。扩建通过增加 2 米地板/屋顶、外移外墙与圆角实现；没有整体拉伸窗、门或房间。

[大房间剖视](../../reviews/habitat-v2/06-expanded-cutaway.png) 暂时隐藏近侧部分屋顶，展示独立地板、顶梁与立柱。梁端各用 0.5 米连接件跨过外围补边并接入墙体。[可编辑对照场景](habitat-expansion.blend) 和 [198 个模块实例布局](expansion-layout.json) 可复用。当前支持矩形平面的扩建；L 形、内院、不同高度和多层需要继续补内凹角、连接口、楼梯等美术部件，不作为本轮已完成项。

[门洞尺度图](../../reviews/habitat-v2/07-doorway-scale.png) 将未变形的 1.78 米比例人偶放在门槛上，并隐藏独立门扇。当前姿态宽约 1.0605 米，门洞提供约 0.1395 米总横向余量和 0.48 米高度余量。它只证明几何尺度，尚无动画、衣服、背包或动态通行验收。人偶来自项目原有 CC0 MakeHuman 参照，见 [来源说明](../third-party/README.md)，并非新制作的正式角色。[尺度记录](../../reviews/habitat-v2/scale-review.json)。

## 材质与表面

暖白、橙漆、裸金属、橡胶、玻璃、织物分别使用共享材质。两张 512×512 的微表面贴图为可平铺资源；粗糙度与法线使用非颜色数据。UV 使用一致尺度的立方投影，适合此轮的微表面材质，并非后续手绘磨损用的唯一无重叠 UV 展开。

螺钉、接缝、窗框、百叶、门把手和标识均为可编辑几何；文字转为网格，不依赖额外字体。当前资产侧重美术确认，尚未做移动端绘制预算或 LOD 优化。展示灯光和背景不包含在独立 GLB 中。

## 后台复现与检查

从仓库根目录运行，不启动可见应用：

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python-exit-code 1 --python games/star-neighbors/art/source/habitat-v2/build_habitat.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python-exit-code 1 --python games/star-neighbors/art/source/habitat-v2/check_exports.py
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python-exit-code 1 --python games/star-neighbors/art/source/habitat-v2/render_expansion.py
```

[检查结果](../../reviews/habitat-v2/asset-check.json) 记录实际 GLB 的文件哈希、重新导入后的尺寸、网格/三角面、UV 和嵌入图片。检查脚本使用独立导出文件重新装配后渲染，不能代替引擎显示或用户美术验收。此前的玩法代码和其他首版模型沿用原状态。
