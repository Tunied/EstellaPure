# 微信 C++ HelloWorld 对照

- `examples/wechat_hello/` 是自有独立CMake宿主，直接编译上游核心和Yoga，通过EstellaContext / ImmediateDraw / GLDevice绘制文字、圆点和进度条。场景逻辑为C++20，无SDL、TS SDK、编辑器与CE_GUI依赖；不修改上游源码。
- 单指暂停/恢复圆点；三指显示可复制的启动记录。`boot-journal.js` 与CopyEngine诊断版本对齐，保留有限启动阶段、GL首批上传参数、宿主内存警告；异常或未完成启动可再次进入查看前次记录。
- `scripts/build-wechat-hello.cjs --sdk <emsdk目录> --template <微信模板>`：heavy / 1800秒 / 两线程，原子生成 `release/wechat/DevBuild`。默认读取相邻CopyEngineAI的已安装3.1.74和本机Template；编译缓存仅写本项目build。先初始化固定GLM子模块，不克隆可选编辑器。
- 独立源码清单来自上游 `cmake/ESEngineSources.cmake`；关闭可选字体、骨骼、物理、粒子、Tilemap、后处理和WebGPU。不运行绑定生成器、不调用TS SDK。此包只验证纯C++最小接入，不能代表官方全SDK、全部子系统或大型游戏内存。
- 为控制对照变量，工具链为3.1.74，初始32MiB/最大256MiB、1MiB栈，不使用SIMD/JS BigInt/GLX。上游默认选项不同。宿主按上游顺序创建屏幕Canvas、实例化WASM、获取WebGL2、隐藏三类WebGL1核心扩展，再注册上下文。
- `scripts/check-wechat-hello.cjs` 实例化真实WASM并检查ABI及内存；跨引擎的无窗口WebGL2检查位于相邻CopyEngineAI的 `scripts/check-wechat-headless.cjs`。这些都不证明微信/iOS画面和交互验收。
- 用户设备XS Max的CopyEngine大厅黑屏、大型游戏曾内存提示后退出；本对照的iOS结果待用户反馈。集中测试副本由CopyEngineAI `scripts/package-ios-diagnostics.cjs` 输出到其 `release/IOS闪退调试/03_EstellaPure_HelloWorld`。
