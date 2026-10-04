# @catus/native

Catus Terminal 专属的 Rust/napi-rs workspace，统一导出 Rust 能力和 Lynx native
组件。包名为 `@catus/native`，所有组件链接进同一个 `catus-native.node`。
当前实现 `<native-input>`（macOS `NSTextField`）和 `<native-terminal>`
（Lynx IOSurface + Rust wgpu / Metal + Alacritty 默认 shell 终端）。

```text
native/
  Cargo.toml / Cargo.lock       Rust crate 和依赖
  build.rs                     cxx 桥、C++ 静态库构建及链接
  src/lib.rs                   napi-rs 导出和共享 Rust 状态
  src/terminal_core/           portable-pty 会话、Alacritty parser 和 owned grid
  src/terminal_session.rs      u32 session 注册表、PTY 和 session renderer 生命周期
  src/terminal_view.rs         cxx 桥、layout resize / revision 与 view 适配
  src/renderer.rs              独立 wgpu renderer 和 Metal texture 导入
  src/frame.rs                 Rust IOSurface FrameBuffer / cxx Viewport
  src/frame_callbacks.rs       UI 线程同步回调注册与过期帧丢弃
  src/atlas.rs                  Alacritty atlas 分配、分页和 staging buffer 上传
  src/font.rs                  crossfont 字体、metrics 和 GlyphKey 缓存
  src/glyph_renderer.rs / atlas.wgsl 真实字形、instance buffer 和采样验证
  src/tests/                   counter / atlas / font 独立单元测试模块
  licenses/ALACRITTY-MIT.txt     atlas 来源的 MIT 文本
  cxx/
    CMakeLists.txt             项目 C++ 静态库的源文件清单
    NativeInputElement*.cc/h   输入组件及宏注册
    NativeInputRust.cc         C++ → Rust 调用
    NativeInputMacOS.mm        AppKit 输入框实现
    NativeTerminalMacOS.mm     IOSurface/Metal 桥接和 terminal view
    NativeTerminalRegistration.mm  extension 生命周期和 display link
    NativeFrameCallbacks.h/mm  Rust 注册对象与 native render callback
    NativeVSyncMonitorMacOS.h/mm  UI main run loop 上的 macOS display link
  package.json / build.mjs      napi-rs 构建入口
  lynx.lib.json / index.cjs     AutoLink 产物描述与加载
  index.d.ts                   napi-rs 自动生成的 Rust API 类型
  elements.d.ts                Lynx 组件类型
  index.d.cts                  公共类型入口
```

新增组件时把 C++ 文件加入 `cxx/CMakeLists.txt` 的 `catus_native` target，
在源码中调用 `LYNX_REGISTER_ELEMENT`，并在 `elements.d.ts` 声明标签类型。
每个组件使用唯一的 extension module 名称和标签；如当前组件使用
`CatusNativeInputElement` / `native-input`。宏为各组件生成独立注册构造函数，
同一 `.node` 可以包含多个这样的注册，无需为每个组件创建 npm 包或 Rust crate。

## API

| 类型 | 名称 | 说明 |
| --- | --- | --- |
| 属性 | `value: string` | 更新 NSTextField 的文本 |
| 属性 | `placeholder: string` | 输入框占位文字 |
| 事件 | `bindinput` | 用户编辑时回传 `{ detail: { value: string } }` |
| 方法 | `setValue({ value: string })` | 设置文本，不发出用户输入事件 |
| 方法 | `getValue({})` | 返回当前文本字符串 |
| 方法 | `focus({})` | 获取输入焦点 |
| 方法 | `inspectRustObject({ rustObject })` | 返回收到的 LynxValue 类型、nativeId、add 属性信息 |
| 方法 | `bindRustCounter({ rustObject })` | 接受 RustCounter 或 `{ nativeId }`，取得共享 Rust 句柄 |
| 方法 | `addRustCounter({ delta: number })` | C++ 通过 cxx 调用 Rust；返回 `{ nativeId, value, cppCalls }` |

通过 `lynx.createSelectorQuery().select('#id').invoke({...}).exec()` 调用方法。
返回状态码使用 `LynxNativeView` 常量：成功 0、未知方法 3、参数错误 4、
无法获取焦点 7。

原生侧用户输入只更新内部值并发出 `input` 事件。React 将相同文本写回时，
不会重设 NSTextField 的值，避免破坏当前选择和输入法标记文本。

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
PTY 读写线程。`terminal_session.rs` 管理生命周期，`terminal_view.rs` 提供 cxx 适配。
`OnLayoutChanged` 接收逻辑尺寸及 backing scale，更新 viewport，再用 crossfont
字体 advance、line height（含 CoreText leading）和 padding 计算行列，resize PTY。
属性晚于 layout 到达时，绑定 session 后应用缓存的 layout；UI 不传宽高或行列参数。
`renderFrame()` 只读取 session 的 renderer/viewport、检查 revision、生成快照并绘制。
`renderer.rs` 接收计算后的网格、`FrameBuffer { iosurface }` 和 session 的
viewport，完全不访问 PTY。C++ 不再独立持有或创建 renderer。

| native-terminal 接口 | 用途 |
| --- | --- |
| `terminal-id: number` | 正数绑定 u32 session ID，0 解绑 |
| `renderFrame()` | 使用 session 的 viewport 绘制最新网格，空闲时跳过 GPU；成功返回 true |
| `focus()` | 获得 Lynx 键盘焦点 |
| `write({ text })` | 写入 UTF-8 文本（诊断/未来粘贴入口） |
| `key({ key, control, alt })` | 编码普通键和基本终端控制键并写入 PTY |

`frame_callbacks.rs` 保存弱引用的回调注册，C++ view 调用 `register_frame_callback()`，
持有 registration；销毁 view 时清除 C++ render callback 并释放注册。
`NativeTerminalRegistration.mm` 在 UI 生命周期里启动、停止原生 display link。
macOS 14+ 的 `CADisplayLink` 在 UI main run loop 上持续触发；旧版 macOS 使用 60Hz UI timer。
VSync 同步调用 Rust，Rust 直接执行 C++ view 的渲染回调，整个调用链在同一 UI 线程上。
没有帧 ID、broadcast、BTS observer、在途帧队列或每帧跨线程投递。
每个回调都检查本次 VSync 的 monotonic deadline；view/session/grid/atlas 锁忙则直接丢帧。
提交前过期丢弃 encoder 并撤销未上传的 atlas handles；提交后过期先等待 GPU 完成，
再丢弃呈现，保持网格 dirty。不会把还在写入的借用 buffer 还给 Lynx，也不会重放旧帧。
PTY 读线程只更新自己的网格；attach/layout/props 只更新状态，不直接启动 GPU 绘制。
网格 revision、尺寸和 scale 均未变化时不获取 framebuffer、不生成快照、不绘制。
ID 0、零尺寸、detach、后台和销毁停止执行渲染回调。
Rust 测试在 `src/tests/frame_callbacks.rs`，覆盖同步执行、同线程、过期帧、注销和生命周期。
`src/tests/terminal_rendering.rs` 使用真实 portable-pty 启动
`../tests/fixtures/fake-pty.mjs`，通过 session 的 `render_surface` 导入真实 IOSurface 并回读
Metal 像素。覆盖网格更新、空闲跳帧、过期/资源忙丢帧后的最新网格恢复、坏 framebuffer、重新绑定、session 隔离和 DPI resize。
`src/tests/renderer_support.rs` 仅在测试中编译，保留 GPU 实现的私有可见性。
桌面自动化与截图对比通过根目录 `pnpm run test:e2e` 运行。
逐字符 atlas 支持普通/粗体、前景/背景色、下划线、删除线、光标及宽字符。
尚不支持 IME、选择、滚动历史 UI、完整键盘协议和复杂文本 shaping。

## 构建与加载

`native-terminal` 使用 `CatusNativeTerminalElement` 注册，启用
`IsSurfaceEnabled()`。`AcquireSurface` 的尺寸是物理像素，macOS 返回借用的
`IOSurfaceRef`。C++ 用缓存的 layout 获取 buffer，直接调用 Rust 的
`render_surface(iosurface, deadline)`；Rust 内部检查锁忙、idle revision、尺寸和
像素布局，使用全局共享 MTLDevice 创建 BGRA8Unorm texture，再导入 wgpu 绘制。
Rust 等待已提交 GPU 工作完成；C++ 仅在返回已绘制且未过期时 `SwapBack` 和
`MarkDirty`。FrameInfo 已删除，device 和 viewport 不再每帧回传 C++。
没有独立的 NSView 或 CAMetalLayer。

`renderer.rs` 使用全局 `LazyLock<Result<GpuContext, String>>` 惰性创建一次 device、
queue、glyph pipeline、sampler 和 `Mutex<SharedGlyphs>`；所有 terminal view 共享。
每个 renderer 独立保存 instance buffer 与网格 revision/viewport/generation。
销毁或重新绑定 view 只释放其 session 句柄；renderer 保留至 session 释放，重挂载时使帧状态失效，不清空共享缓存。原有三角形/atlas 演示、
渲染统计和 IOSurface 像素扫描接口已移除；错误通过实际方法的失败回调返回。

`font.rs` 使用 crossfont 0.9.0 / macOS CoreText，按字体、字符和物理字号缓存字形，
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
导入 `./lynxtron`。preload 可以通过其默认导出访问 napi-rs 的 `RustCounter` 类。
库的 Node-API 入口由 Rust 提供，Lynx 元素使用
`LYNX_REGISTER_ELEMENT` 在 C++ 中静态注册。

源码编译依赖 `@lynx-js/lynx-library-headers`，CMake 直接读取已安装的 SDK 头文件。

Rust 扩展与 C++ 元素链接为同一个 `.node`，cxx 生成类型安全的 C++ 头文件。
`RustCounter` 的 N-API wrapper 与 `CounterHandle` 共享 `Arc<CounterState>`。
传入 native view 时使用 `nativeId` 定位状态，不把地址暴露到 JS。

构建入口是 `build.mjs`，通过官方 `@napi-rs/cli` 调用 Cargo，输出
`.node` 和自动生成的 `index.d.ts`。`build.rs` 先用 `cxx-build` 生成
桥接代码，再调用 CMake 构建 `libcatus_native.a`；Rust `cdylib` 最后链接
该静态库、cxx 桥和系统 framework。CMake 不再构建动态库，Node-API 入口由
Rust napi-rs 提供。

macOS 链接参数 `-force_load` 保留 C++ 的 `LYNX_REGISTER_ELEMENT` 注册构造函数，
仅应用于 Cargo 的 `cdylib` 目标。`native-view` 是默认 feature；关闭它可构建
不含 Lynx view 的 Rust 扩展，供独立 Node 进程执行 N-API 测试。实际组合扩展
通过 AutoLink 加载，组件注册及 C++ → Rust 调用在 Lynxtron 中验证。

release profile 显式使用 `strip = "none"`，避免当前 Rust 1.95 / LLVM 在 macOS 27
上 strip 产生无效 LINKEDIT 的问题（[Rust issue #157750](https://github.com/rust-lang/rust/issues/157750)）。

```ts
// preload
import nativeBinding from '@catus/native/lynxtron';
const counter = new nativeBinding.RustCounter(10);
// 在 Lynx 后台线程通过 SelectorQuery 调用：
// bindRustCounter({ rustObject: counter })
// 或 bindRustCounter({ rustObject: counter.toNativeHandle() })
// addRustCounter({ delta: 5 })
```

调用 `addRustCounter` 前需绑定实例；未绑定返回状态 7，非法 ID、非 int32 的
delta、Rust 整数溢出返回状态 4。绑定失败会保留前一个有效实例。
N-API JS 对象不是 native view 的 napi_value 参数；本例的调用桥梁是 ID + cxx。

详见项目根目录 [README](../README.md) 和
[官方 Desktop custom element 文档](https://lynxjs.org/next/guide/custom-native-component.html?platform=desktops)。
