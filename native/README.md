# @catus/native

Catus Terminal 专属的 Rust/napi-rs workspace，统一导出 Rust 能力和 Lynx native
组件。包名为 `@catus/native`，所有组件链接进同一个 `catus-native.node`。
当前实现 `<native-terminal>`（嵌入 NSView / windowless OSR + Rust wgpu / Metal + Alacritty 终端）。

Rust 内部统一使用 `anyhow::Result`，通过 `?` 和 `Context` 保留底层错误。
N-API 边界转换为 `napi::Error` 并输出完整原因链；cxx 实现直接返回 anyhow 错误。
Atlas 的错误分类保留在 anyhow 中，翻页逻辑通过 downcast 判断页是否已满。

```text
native/
  Cargo.toml / Cargo.lock       Rust crate 和依赖
  build.rs                     cxx 桥、C++ 静态库构建及链接
  src/lib.rs                   napi-rs 导出和共享 Rust 状态
  src/sftp/                    russh-sftp 协议、SSH 管道和连接生命周期
  src/sftp_api.rs              N-API Promise / Uint8Array 文件 API
  src/terminal_core/           portable-pty 会话、Alacritty parser 和 owned grid
  src/terminal_session.rs      u32 session 注册表、PTY 和 session renderer 生命周期
  src/terminal_view.rs         layout resize、revision 和网格快照编排
  src/renderer.rs              共享 GPU、平台无关 wgpu 绘制与 deadline
  src/frame.rs                 平台无关的 cxx Viewport
  src/frame_driver.rs          napi-rs JS RAF 适配器
  src/frame_callbacks.rs       全局回调注册与 UI 分发 / 过期帧丢弃
  src/platform/
    mod.rs                     按目标平台选择适配器
    unix.rs                    Unix 默认 shell 和 PTY EOF 策略
    windows.rs                 portable-pty 默认进程和 EOF 策略
    macos/
      mod.rs                   Metal 后端选择
      surface.rs               IOSurface 校验与 wgpu texture 导入
      terminal.rs              macOS terminal cxx 桥和纹理渲染入口
      view.rs                  Rust NSView、CAMetalLayer、嵌入 / OSR 生命周期
      input_view.rs            objc2 NSResponder、NSTextInputClient 和组合文本
      frame.rs                 native 回调、时钟和 UI 调度桥
      font.rs                  Menlo / CoreText 字体策略
      build.rs                 macOS CMake 和 framework 链接
  src/text/
    mod.rs                     文字渲染模块入口
    atlas.rs                   Alacritty atlas 分配、分页和 staging buffer 上传
    font.rs                    crossfont 字体、metrics 和 GlyphKey 缓存
    glyph_renderer.rs          instance buffer 和文字绘制
    atlas.wgsl                 字形采样 shader
  src/tests/                   共享测试；macos/ 保存平台测试和 IOSurface 夹具
  licenses/ALACRITTY-MIT.txt     atlas 来源的 MIT 文本
  cxx/
    CMakeLists.txt             项目 C++ 静态库的源文件清单
    common/
      NativeFrameCallbacks.h/cc  Rust 回调对象与平台无关 callback target
      NativeTerminalView.h       session、layout、props、输入和帧生命周期
      NativeTerminalRegistration.cc  Lynx extension 注册与窗口生命周期
    platform/
      UiThread.h / RustBridge.h  按平台选择 UI 与 Rust 桥接适配
      macos/
        NativeTerminalView.cc   Lynx 回调、buffer 和宿主接口到 Rust 的薄桥接
        UiThread.h              主队列调度与 UI 线程检查
  package.json / build.mjs      napi-rs 构建入口
  lynx.lib.json / index.cjs     AutoLink 产物描述与加载
  index.d.ts                   napi-rs 自动生成的 Rust API 类型
  elements.d.ts                Lynx 组件类型
  index.d.cts                  公共类型入口
```

terminal 的 extension module 负责组件注册和窗口生命周期。新增原生组件时，
将 C++ 源码加入 `cxx/CMakeLists.txt`，并在 `elements.d.ts` 声明标签类型。

## 终端对象和帧接口

`createTerminalSession(id)` 接收 JS 分配的正整数 `u32` ID，创建默认 shell，成功返回 void。
Rust 不分配 ID，互斥保护注册表创建，拒绝重复 ID 和保留值 0；创建失败不占用 ID。
第二个可选参数 `{ program, args }` 用于启动测试进程；E2E preload 用 `CATUS_E2E_PTY`
和 `CATUS_E2E_NODE` 指向 JS fixture 与 Node，不读取用户的 shell 初始化脚本。
数字 tab ID 直接作为 session ID；JS 全局 `sessionRegistry` 的 `sessionAtom` 写入时同步 native session。
新 tab 创建 session、关闭 tab 或删除 workspace 时删除对应 session，registry 销毁时关闭剩余 session。
`TerminalView` 只展示 atom 派生的 ID 和错误；React unmount/remount 不影响 session 生命周期。
`TerminalView` 与 `NativeTerminalView` 持续挂载，切换 tab 只更新 `terminal-id`，无需 active 或 key。
没有选中 tab 时 ID 0 清除 native 绑定并隐藏 view，Rust 停止该 view 的帧监听；loading/配置错误也保持挂载。
注册表强引用 session；每个 session 拥有计算层和带锁的 renderer/viewport。
renderer 在首次有效 layout 时惰性创建，之后随 session 保留。
切换 tab 保留同一个 native element、shell 和 renderer，由 OnPropertiesChanged 更新 session 绑定。
C++ 的 `OnPropertiesChanged` 校验数字 ID，并取得共享 `TerminalHandle`。
诊断/主机 API 为 `writeTerminalSession(id, text)` 和 `getTerminalSessionInfo(id)`。

`terminal_core/grid.rs` 只计算 Alacritty 字符网格；`terminal_core/pty.rs` 管理阻塞
PTY 读写线程。`terminal_session.rs` 管理生命周期，`terminal_view.rs` 编排共享渲染流程，
`platform/macos/terminal.rs` 提供 macOS cxx 适配。
`OnLayoutChanged` 接收逻辑尺寸及 backing scale，更新 viewport，再用 crossfont
字体 advance、line height（含 CoreText leading）和 padding 计算行列，resize PTY。
属性晚于 layout 到达时，绑定 session 后应用缓存的 layout；UI 不传宽高或行列参数。
`renderFrame()` 只读取 session 的 renderer/viewport、检查 revision、生成快照并绘制。
`renderer.rs` 接收计算后的网格、session 的 viewport 和准备 wgpu texture 的回调，
不访问 PTY 或 OS 指针。macOS 回调在 `platform/macos/surface.rs` 导入 IOSurface。
C++ 不再独立持有或创建 renderer。

| native-terminal 接口 | 用途 |
| --- | --- |
| `terminal-id: number` | 正数绑定 u32 session ID，0 解绑 |
| `renderFrame()` | 使用 session 的 viewport 绘制最新网格，空闲时跳过 GPU；成功返回 true |
| `focus()` | 获得 Lynx 键盘焦点 |
| `write({ text })` | 写入 UTF-8 文本（诊断/未来粘贴入口） |
| `key({ key, control, alt })` | 编码普通键和基本终端控制键并写入 PTY |

`frame_callbacks.rs` 保存弱引用的回调注册，C++ view 调用 `register_frame_callback()`，
持有 registration；销毁 view 时清除 C++ render callback 并释放注册。
独立的 `src/app/frameDriver.ts` 由 App 挂载时启动 MTS RAF，卸载时取消。
外层 MTS 先创建 `runOnBackground` 调用函数，RAF 回调直接调用它；不等待 Promise 回执。
preload 暴露 napi-rs 的 `dispatchAnimationFrame()`；`frame_driver.rs` 接收 JS 帧信号，
用 native monotonic clock 生成约 16.7ms 的 deadline，再转发到 UI。
`frame_callbacks.rs` 的全局 `LazyLock` 保存弱引用的窗口回调注册对象，UI 每次接到信号
遍历有效注册并同步渲染；背景窗口、解绑和销毁的 view 不执行。
JS timestamp 与 native clock 起点不同，因此不将 JS timestamp 当成 native deadline。
该预算从 N-API 收到信号时开始，包含其后到 UI 的延迟；当前不是显示器的精确 target 时间。
后续 native 帧源可以直接调用 `dispatch_frame_callbacks(deadline)`，替换 JS 适配器。
项目自建的 CADisplayLink、timer 和单次 native RAF 探针已移除；`renderFrame` 保留为显式入口。
原 native RAF 调查见 [验证文档](../docs/terminal-native-raf-verification.md)。
每个回调都检查本次 VSync 的 monotonic deadline；view/session/grid/atlas 锁忙则直接丢帧。
提交前过期丢弃 encoder 并撤销未上传的 atlas handles；提交后过期先等待 GPU 完成，
再丢弃呈现，保持网格 dirty。不会把还在写入的借用 buffer 还给 Lynx，也不会重放旧帧。
PTY 读线程只更新自己的网格；attach/layout/props 只更新状态，不直接启动 GPU 绘制。
网格 revision、尺寸和 scale 均未变化时不获取 framebuffer、不生成快照、不绘制。
ID 0、零尺寸、detach、后台和销毁停止执行渲染回调。
Rust 测试在 `src/tests/frame_callbacks.rs`，覆盖同步执行、同线程、过期帧、注销和生命周期。
`src/tests/macos/terminal_rendering.rs` 使用真实 portable-pty 启动
`../tests/fixtures/fake-pty.mjs`，通过 session 的 `render_surface` 导入真实 IOSurface 并回读
Metal 像素。覆盖网格更新、空闲跳帧、过期/资源忙丢帧后的最新网格恢复、坏 framebuffer、重新绑定、session 隔离和 DPI resize。
`src/tests/renderer_support.rs` 只提供共享测试锁；
`src/tests/macos/surface_support.rs` 提供 IOSurface 创建与像素回读夹具。
桌面自动化与截图对比通过根目录 `pnpm run test:e2e` 运行。
逐字符 atlas 支持普通/粗体、前景/背景色、下划线、删除线、光标及宽字符。
macOS 输入通过 NSResponder / NSTextInputClient 处理，组合文本在提交前只作为显示叠加。
滚轮和触控板滚动 Alacritty 历史；拖动选择文本，双击选词、三击选行，Option 拖动矩形选择，Cmd+C 复制。
程序启用鼠标报告时，点击、拖动和滚轮转发给 PTY；Shift 强制本地选择/历史滚动。备用屏幕使用 Alacritty 的 alternate-scroll 模式发送方向键。
嵌入模式通过 NSView 接收事件，OSR 通过 Lynx `OnMotionEvent` 接收；逻辑坐标转换及触控板小数滚动累积位于 Rust macOS 适配器，高亮由现有 atlas 渲染。尚不支持拖出视口后的自动滚动、完整键盘协议和复杂文本 shaping。

## 构建与加载

`native-terminal` 使用 `CatusNativeTerminalElement` 注册。参考 Lynx CEF 的 macOS 适配：
默认将 NSView 加入 `lynx_view_get_native_window()` 返回的宿主，layout 更新其 frame。
NSView 的 CAMetalLayer 提供 drawable，Rust 用共享 wgpu device 导入纹理，GPU 完成后呈现。
网格使用左上角坐标；直接 Metal 目标按 wgpu Y-up NDC 转换，只有 Lynx OSR 做合成所需的 Y 轴补偿。
NSView frame 根据父 view 的 isFlipped 转换；自身 isFlipped 只决定内部坐标。
attach/detach/destroy 管理子 view、焦点、输入法和回调生命周期。
`use-osr` 可显式选择 OSR；没有宿主 NSView 或 NSWindow 的 windowless 环境自动使用 OSR。
OSR 才启用 `IsSurfaceEnabled()`。`AcquireSurface` 的尺寸是物理像素，macOS 返回借用的
`IOSurfaceRef`。C++ 用缓存的 layout 获取 buffer，直接调用 Rust 的
`render_osr(&IOSurface, deadline)`，不再将地址转换为整数。会话层检查锁忙和 idle revision，
准备网格快照后调用公共 `render_to_surface(renderer, viewport, grid, &IOSurfaceRef, deadline)`。
该函数只负责目标校验、纹理导入及绘制，不读取 PTY 或 session。Rust 检查尺寸和
像素布局，使用全局共享 MTLDevice 创建 BGRA8Unorm texture，再导入 wgpu 绘制。
Rust 等待已提交 GPU 工作完成；C++ 仅在返回已绘制且未过期时 `SwapBack` 和
`MarkDirty`。FrameInfo 已删除，device 和 viewport 不再每帧回传 C++。
嵌入模式直接呈现 CAMetalLayer drawable，不调用 Lynx SwapBack。
两种模式共享 NSTextInputClient：嵌入模式通过 NSView responder 接收事件；OSR 与 CEF 一样通过
`lynx_view_register_ime_handler` 和 NSTextInputContext 接收宿主事件。组合文本不会写入 PTY，
提交文本才调用 Rust write；两种模式的组合文本均由共享 atlas 绘制。
NSView、NSTextInputContext、CAMetalLayer 和输入会话绑定全部由 Rust 持有；
C++ 只传入宿主句柄及焦点 / IME 注册函数，转发 Lynx 生命周期回调。
候选框位置来自 Rust renderer 的字符尺寸及实际终端光标，并转换为屏幕坐标。
JS 不再转发 keydown，防止 native 输入与 JS 重复写入。
嵌入 NSView 与 CEF 子 view 一样，独立于 Lynx 合成树；Lynx surface 截图与覆盖层场景使用 OSR。
`pnpm test:native-input` 在 macOS 主线程运行 Rust 测试，验证原生文本输入协议；Rust 测试验证 CAMetalLayer drawable 和 OSR 组合文本。
真实系统输入法的候选窗交互仍需要 macOS 运行时验收。

`renderer.rs` 使用全局 `LazyLock<anyhow::Result<GpuContext>>` 惰性创建一次 device、
queue、glyph pipeline、sampler 和 `Mutex<SharedGlyphs>`；所有 terminal view 共享。
每个 renderer 独立保存 instance buffer 与网格 revision/viewport/generation。
销毁或重新绑定 view 只释放其 session 句柄；renderer 保留至 session 释放，重挂载时使帧状态失效，不清空共享缓存。原有三角形/atlas 演示、
渲染统计和 IOSurface 像素扫描接口已移除；错误通过实际方法的失败回调返回。

`text/font.rs` 使用 crossfont 0.9.0，按字体、字符和物理字号缓存字形。
`platform/macos/font.rs` 负责 Menlo 选择和 CoreText 像素字号策略；
同一 rasterizer 保留多个字号及其 metrics；14 logical px × backing scale 决定字号。
DPI 改变会查找/补充另一个字号，既有字号和 atlas 区域仍保留。Menlo 普通体/粗体
与系统 fallback 支持 ASCII、中文和彩色 emoji。空格保留 metrics，不上传位图。

普通字形使用 R8Unorm coverage 页；彩色字形使用 premultiplied RGBA8Unorm 页。
位图由 256 字节行对齐 staging buffer 上传。pipeline、sampler、页 bind group 共享；
instance buffer 每个 session 独立。保持 crossfont 平台默认 AA 和 RGB coverage 均值策略。

共享锁覆盖字形生成、上传编码、提交和 GPU 完成，避免另一个 view 使用尚未提交的
字形数据。失败时清空 atlas、递增 generation，所有 view 在下一帧重新绘制。
GPU texture 和 bind group 仍复用。当前没有 LRU/内存上限，atlas 按需增加页数。

Metal 测试覆盖：真实颜色和 Unicode 像素回读、多个 renderer 的同一 device、
跨 view 上传复用、多个 DPI 共存、销毁重建保留缓存、并发 view 的独立 buffer，
以及失败后的全局缓存失效。历史截图/统计报告对应清理前的原型 API。

在项目根目录运行：

```bash
pnpm install
pnpm run build:native
```

产物为 `dist/darwin/<arch>/catus-native.node`。`lynx.lib.json` 声明 macOS
arm64/x64，但每次构建只生成当前架构产物。当前已验证 macOS arm64。

主应用的 `pluginLynxtron()` 自动扫描、复制和加载本库；不要从 UI 运行时代码
导入 `./lynxtron`。preload 可以通过其默认导出访问 napi-rs 的终端 session API。
库的 Node-API 入口由 Rust 提供，terminal extension 在 C++ 中静态注册。

源码编译依赖 `@lynx-js/lynx-library-headers`，CMake 直接读取已安装的 SDK 头文件。

Rust 扩展与 C++ 元素链接为同一个 `.node`，cxx 生成类型安全的 C++ 头文件。
构建入口是 `build.mjs`，通过官方 `@napi-rs/cli` 调用 Cargo，输出
`.node` 和自动生成的 `index.d.ts`。`build.rs` 先用 `cxx-build` 生成
桥接代码，再调用 CMake 构建 `libcatus_native.a`；Rust `cdylib` 最后链接
该静态库、cxx 桥和系统 framework。CMake 不再构建动态库，Node-API 入口由
Rust napi-rs 提供。

macOS 链接参数 `-force_load` 保留 C++ 的 terminal extension 注册构造函数，
仅应用于 Cargo 的 `cdylib` 目标。`native-view` 是默认 feature；关闭它可构建
不含 Lynx view 的 Rust 扩展，供独立 Node 进程执行 N-API 测试。实际组合扩展
通过 AutoLink 加载，组件注册及 C++ → Rust 调用在 Lynxtron 中验证。

release profile 显式使用 `strip = "none"`，避免当前 Rust 1.95 / LLVM 在 macOS 27
上 strip 产生无效 LINKEDIT 的问题（[Rust issue #157750](https://github.com/rust-lang/rust/issues/157750)）。

详见项目根目录 [README](../README.md) 和
[官方 Desktop custom element 文档](https://lynxjs.org/next/guide/custom-native-component.html?platform=desktops)。

## SFTP

`connectSftp({ destination, port?, identityFile?, configFile? })` 返回 Promise。
Rust 使用 napi-rs async fn 在 Tokio 中执行，Node main 持有连接并接收 Promise 结果；
Lynx BTS 通过 `lynxBridge` 请求文件操作。
连接提供 `readDir`、`metadata`、`readFile`、`writeFile`、`createDir`、`rename`、
`removeFile`、`removeDir` 和 `close`，均返回 Promise。
`writeFile` 在 JS 调用线程复制输入，再通过 `Env::spawn_future` 执行异步写入。
目录项包含 `name`、POSIX `path` 和 metadata；size 是可选 bigint，modified 是
可选 Unix 秒时间，fileType 是 file/directory/symlink/other。

调用链、运行时选择及限制见 [SFTP 异步实现](../docs/sftp-async.md)。

当前普通 Node 的 Promise/文件操作测试通过；Lynxtron 0.0.28 BTS 中仍会在
TSFN 排队后、进入 JS callback 前触发 Node Environment 断言。改为 Node main
创建 native 对象并接收异步结果后，windowless SFTP E2E 已通过；上游 BTS 根因仍待确认。
