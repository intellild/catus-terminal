# Catus Terminal

使用 Lynx UI 实现的桌面终端界面，参考 Opera 的 workspace 与 tab 布局。
左侧 dock 放置可配置的终端类型，每个 workspace 保留自己的 terminal tabs；
内容区当前是占位符，尚未启动进程或接入 PTY。

状态管理使用 `effect@4.0.0` 和官方 `@effect/atom-react@4.0.0`。
构建与测试将 React hooks 映射到 ReactLynx。完整 workspace UI 使用
`<background-only>`：主线程显示启动占位，Effect 只在 BTS 运行。
`runtime.ts` 在 Effect 加载前通过 preload 工厂安装 Node.js 原生
`TextEncoder` / `TextDecoder`，不需要第三方编码 polyfill。

项目由官方 `@lynx-js/create-lynxtron@0.0.28` 初始化。项目专属的 `@catus/native`
workspace 使用 Rust/napi-rs 导出原生能力，通过 AutoLink 加载 `<native-input>`
和 `<native-terminal>`。macOS 输入框使用 AppKit `NSTextField`；原有 Rust wgpu /
Metal 三角形与 crossfont 字形 atlas 演示保留在 `src/app/NativeDemo.tsx`。

## Workspaces 与配置

- 启动应用时自动打开配置中的第一个 workspace，并创建第一个 tab。
- 首次点击未启动的 workspace 创建 tab；再次点击恢复它上次选中的 tab。
- 顶部 `+` 为当前 workspace 创建独立 tab；关闭最后一个 tab 后圆点消失。
- 圆点表示该 workspace 有打开的 tab，当前不表示真实进程存活。
- 左下角设置或 `Configure workspace` 可新增、编辑和移除终端类型。
- 修改配置只影响新 tab，已有 tab 保留创建时的启动参数；tab 状态不跨应用重启保存。

默认配置模板为 `config/workspaces.json`，包含 Shell、Node.js 和 Python。
首次运行复制到 `~/.config/catus-terminal/workspaces.json`；也可通过
`CATUS_WORKSPACES_FILE=/absolute/path/workspaces.json pnpm start` 指定配置位置。
设置面板显示实际路径。保存前通过 Effect Schema 校验，以临时文件和 rename
写入 JSON；已有配置损坏时显示错误，不会覆盖。

```json
{
  "version": 1,
  "workspaces": [
    {
      "id": "shell",
      "name": "Shell",
      "icon": ">_",
      "color": "#a8e6cf",
      "command": "$SHELL",
      "args": ["-l"],
      "cwd": "~"
    }
  ]
}
```

`$SHELL` 使用用户账户默认 shell，`~` / `~/...` 展开为用户主目录。
其他命令与参数原样保存，例如 `command: "ssh"`、`args: ["devbox"]`。
编辑 JSON 后重启应用加载。真实界面截图见 [Shell](docs/workspaces-shell.jpeg)、
[多个 tabs](docs/workspaces-tabs.jpeg)，实测结果见 [验证报告](docs/workspaces-verification.json)。

## 环境与运行

- Node.js：`^22.18.0 || ^24.0.0 || ^26.0.0`
- pnpm 10.34.4（`packageManager` 固定版本，可通过 Corepack 使用）
- macOS + Xcode Command Line Tools（`xcode-select -p` 可检查）
- CMake ≥ 3.18.1
- Rust/Cargo（本项目使用 Rust 2024 edition；已验证 Rust 1.95.0）

```bash
pnpm install
pnpm run dev
```

CI 或复现安装使用 `pnpm install --frozen-lockfile`。
`pnpm-workspace.yaml` 声明 `native` workspace、必要的依赖安装脚本和
`predev`/`prebuild` 生命周期，并提升 Lynxtron builder 补丁所需的两个打包依赖。

`pnpm run dev` 和 `pnpm run build` 会先编译本地 native 库。
修改 TSX/CSS 会热更新；修改 C++/Objective-C++ 后需重启 `pnpm run dev`。

```bash
pnpm run build       # 原生库 + Lynx bundle + desktop 主进程
pnpm start           # 构建并运行
pnpm run typecheck   # UI、主进程及配置文件的 TypeScript 检查
pnpm test            # ReactLynx 交互、Effect 状态与 JSON 配置读写测试
pnpm run test:rust   # Rust 生命周期/异常/多线程测试、fmt、clippy
pnpm run test:napi   # 实际 Node-API 扩展的构造、方法、句柄、异常测试
pnpm run pack        # 本机 macOS 应用打包，不发布
```

## Native 演示交互（NativeDemo.tsx）

- 在原生输入框键入文字，`bindinput` 将 `event.detail.value` 回传到 ReactLynx。
- **Update property**：通过 React 状态更新 `value` 属性。
- **Call setValue**：使用 SelectorQuery 调用 C++ `setValue` 方法。
- **Focus**：调用原生方法，将焦点移到 `NSTextField`。
- **Read value**：调用 `getValue`，显示原生组件内部的值。
- **Verify shared Rust object**：创建 napi-rs `RustCounter`，作为 `invoke.params.rustObject`
  传给 native view，C++ 通过 cxx 修改同一 Rust 实例，再从原始 JS 对象读取结果。
- **Triangle**：绘制三角形，读取实际共享纹理的中心和角落像素，显示 GPU、像素尺寸和帧计数。
- **Render / verify fonts**：通过 crossfont 与 atlas 绘制 Menlo 普通体/粗体、中文和彩色 emoji，显示字形缓存和上传计数。
- **Clear atlas**：丢弃字形句柄，复用 texture 并重新上传位图。
- **Resize / Recreate view**：切换 220px / 150px 高度，或销毁并重新创建 renderer。

## Native terminal / wgpu

`<native-terminal>` 是渲染原型，支持三角形和 crossfont 字体 atlas 验证，尚未接入
PTY 和终端解析。
组件与 input 一同注册到项目的 `.node`，最终构建仍由 napi-rs / Cargo 驱动。
参考了 Lynxtron CEF 包的宏注册与加载方式；共享 surface 的接口以安装的
`lynx_native_view.h` 为准。这里取得的是 **IOSurface**，再创建对应的 Metal texture。

```text
NativeDemo.tsx / <native-terminal>
  Lynx 创建 CatusNativeTerminalElement
       ↓
native/cxx/NativeTerminalMacOS.mm / OnLayoutChanged
  logical size × pixelRatio → AcquireSurface(pixel width, pixel height)
  借用 Lynx 双缓冲中的 IOSurfaceRef
       ↓
Rust TerminalRenderer::metal_device → 同一个 MTLDevice
  C++ 创建 IOSurface-backed BGRA8Unorm MTLTexture
       ↓
native/src/terminal.rs / cxx
  retain MTLTexture → wgpu-hal metal::texture_from_raw
  Device::create_texture_from_hal → wgpu Texture
       ↓
native/src/triangle.wgsl
  Rust 提交 RenderPass，清屏并绘制三角形
  等待 GPU 完成，C++ 读取 IOSurface 像素
       ↓
SwapBack → MarkDirty
  Lynx compositor 合成组件纹理到页面
```

wgpu 固定为 30.0.1，仅启用 Metal / WGSL。使用 wgpu 自己的 MTLDevice
创建纹理，满足 HAL 导入对设备一致性的要求。IOSurface 由 Lynx 管理；Rust
retain 导入的 MTLTexture，不接管 IOSurface 的所有权。view 持有 Rust renderer，
销毁 view 时释放，resize 时重新申请匹配物理像素尺寸的 surface。
shader 输出翻转 clip Y，适配 Metal render target 与当前 Lynxtron macOS
surface 的显示方向；已用合成截图确认。SDK 的 surface transform 参数在
当前版本的实测截图中没有改变方向，因此本例在 shader 内进行适配。

原型每次绘制同步等待 GPU（最长 10 秒），完成后才交换缓冲。持续刷新终端时
还需加入异步 GPU 完成通知、帧调度与缓冲复用；本例的像素读取只用于验证。
`renderTriangle({})` 返回绘制及校验结果，`getRendererInfo({})` 只读取状态。

实测数据见 [验证报告](docs/terminal-triangle-verification.json)，
实际 Lynx 合成画面见 [截图](docs/terminal-triangle.jpeg)。

## Alacritty atlas / wgpu buffer

`native/src/atlas.rs` 从本地 Alacritty `d692748d` 的
`alacritty/src/renderer/text/atlas.rs` 迁移逐行分配、分页和清空复用逻辑。
使用 1024×1024 R8Unorm coverage 页和 RGBA8Unorm premultiplied 彩色字形页，
用 wgpu buffer 替换 GL 上传路径。来源说明和 MIT 文本保存在
`native/licenses/ALACRITTY-MIT.txt`，并随 native 包分发。

```text
font.rs / crossfont 0.9.0（macOS CoreText）
  Menlo 普通体/粗体 → 系统 fallback → GlyphKey 字形缓存
       ↓
RasterizedGlyph / Gray 或 premultiplied RGBA 位图
       ↓
AtlasSet::insert（native/src/atlas.rs）
  校验数据 → 分配位置 → 行数据补齐到 256 字节
       ↓
wgpu staging buffer / COPY_SRC
  encoder.copy_buffer_to_texture → atlas texture / COPY_DST | TEXTURE_BINDING
       ↓
Glyph handle
  page + generation + UV + 尺寸/偏移 + multicolor
       ↓
atlas_demo.rs / instance buffer（VERTEX | COPY_DST）
  位置、UV、颜色 → 按 atlas 页切换 bind group → instanced draw
       ↓
atlas.wgsl → Lynx IOSurface → SwapBack / MarkDirty
```

调用者传入自己的 command encoder，上传和采样可以安排在同一提交中。
完整高度的字形允许恰好占满一页；无效位图先拒绝，再分配空间。
`clear()` 复用已有 GPU texture，递增 generation，使旧字形句柄失效；
调用者同时清空字形缓存和待绘制批次。

演示使用 crossfont 的真实字体，绘制 `Crossfont + wgpu` 和 `Atlas 中文 😀`。
字形缓存 key 包含 font key、character 和 size，字体 metrics 决定基线和字形偏移，
`unicode-width` 决定终端字符占用的列数。普通 resize 和重复绘制不重复栅格化/上传；
backing scale 变化会按 22 logical px × scale 重建 rasterizer 与缓存，复用已有 texture。
bind group 与 instance buffer 也会复用。

crossfont 使用平台默认抗锯齿。本阶段保持原演示的 RGB coverage 均值混合策略，
上传前转成单通道 coverage；彩色 emoji 保留完整 premultiplied RGBA。
自定义 grayscale 栅格化、复杂文本 shaping、ligature 尚未实现。

`renderAtlas({})` 切换到字体绘制，`clearAtlas({})` 清空并重新绘制。
返回状态包含 `mode`、`atlasPages`、`atlasUploads`、`atlasInstances`、
`fontFamily`、`fontPixels`、`cachedGlyphs`、`rasterizations`、`missingGlyphs`。
原有 `renderTriangle` 和 `getRendererInfo` 保留。`pixelVerified` 扫描 IOSurface
是否有前景像素，文字不需要覆盖纹理中心。

`pnpm run test:rust` 包含真实 CoreText 字体测试和 Metal GPU 回读测试，覆盖
中文 fallback、彩色 emoji、字号/样式 key、空格、字形缓存、分页、clear 复用和失效。
字体实测结果见 [验证报告](docs/terminal-font-verification.json) 和
[截图](docs/terminal-font.jpeg)。之前的固定位图验证保留在
[atlas 验证报告](docs/terminal-atlas-verification.json)。

## Rust 对象与 native view

`native` 使用 napi-rs 导出 `RustCounter` 类，使用 cxx 导出
opaque Rust `CounterHandle` 及其方法。napi-rs 驱动 Cargo 构建 Rust `cdylib`，
将 C++ view 静态库链接进同一个 `catus-native.node`，保证进程内只有一个实例注册表。

```text
pnpm run build:native → native/build.mjs
  napi-rs CLI 调用 Cargo，生成 TypeScript 声明和 .node 文件
       ↓
native/build.rs
  napi_build::setup() 配置 Node-API 动态链接
  cxx_build 生成桥接头文件和 C++ 桥接静态库
       ↓
native/cxx/CMakeLists.txt
  编译 C++ / Objective-C++ view → libcatus_native.a
       ↓
Cargo / Rust 链接器
  Rust cdylib + cxx 桥 + C++ 静态库 + AppKit 等系统 framework
  -force_load 保留 C++ 元素注册构造函数
       ↓
napi-rs CLI
  输出 dist/darwin/<arch>/catus-native.node，生成 native/index.d.ts
```

最终 Node-API 入口由 Rust 的 napi-rs 提供。
CMake 只负责 C++ 静态库，不负责最终 `.node` 链接；C++ 调用 Rust 仍通过 cxx。
`-force_load` 只用于 `cdylib`，Rust 测试可独立运行。`test:napi` 使用
`--no-default-features` 构建不含 Lynx view 的扩展，在 Node 中检查 napi-rs 导出；
组合扩展的组件注册和跨语言调用则在实际 Lynxtron 应用中验证。

```text
preload.ts
  new nativeBinding.RustCounter(10)，通过 contextBridge 导出工厂
       ↓
NativeDemo.tsx / rustInterop.ts（Lynx 后台线程）
  counter.add(2) → 12；invoke.params = { rustObject: counter }
       ↓
NativeInputRust.cc / OnMethodInvoked
  参数转成 LynxValue map，读取 nativeId
       ↓
cxx → acquire_counter(nativeId)
  从注册表取得同一 Rust 状态的 Box<CounterHandle>
       ↓
CounterHandle::add_from_cpp(5)
  Rust 原子计数器 → 17
       ↓
原始 N-API counter.value
  读到 17，cppCalls = 1
```

**已在 macOS arm64 / Lynxtron 0.0.28 的实际桌面应用中验证通过。**
原始 N-API 实例的 `nativeId` 可以随方法参数到达 C++；其参数类型是
`lynx_value_map`（11）。本例用 ID 查找实例后通过 cxx 调用 Rust，未在
native view 中对 JS wrapper 执行 `napi_unwrap`，也未通过数字传递内存地址。
`add` 属性虽然存在，其值被转换成 `lynx_value_null`（0），不能从该参数直接
调用 JS 方法。完整实测数据保存在 [验证报告](docs/rust-interop-verification.json)。
另有 `counter.toNativeHandle()` 返回普通 `{ nativeId }` 对象，这条传参路径
也会在按钮验证中检查。

Rust 状态用 `Arc` 管理，注册表只存 `Weak`，native view 用 `rust::Box` 持有
共享状态。JS wrapper 回收会删除 ID；已绑定的 view 仍可安全调用，销毁 view
会释放其引用。未知或已释放的 ID 返回参数错误，不替换原有绑定。

Cargo 输出位于 `/tmp/catus-native-<源码路径哈希>`，由
`scripts/rust-target.mjs` 统一计算；CMake 输出在 Cargo 的 `OUT_DIR/cxx` 中。
可用 `CATUS_RUST_TARGET_DIR` 环境变量覆盖为
项目外的绝对路径。cxx 在输出目录中创建指回源码的符号链接，因此 Rust 检查
通过 `pnpm run test:rust` 使用同一外部输出目录，避免 JS 构建/监听扫描目录循环。
修改 Rust/C++ 后重启 `pnpm run dev`。

## 代码位置

```text
config/workspaces.json                 内置终端类型与默认 shell 配置
src/shared/workspaces.ts               Effect Schema 校验、启动参数解析与 host 类型
src/app/App.tsx                         主线程启动占位与后台 UI 边界
src/app/TerminalApp.tsx                 workspace dock、tabs、内容占位符和配置面板
src/app/runtime.ts                     preload 的 Node 编码器构造函数适配
src/app/state/session.ts                Effect atoms、tab 生命周期和配置编辑状态
src/app/NativeDemo.tsx                  原有 native input / Rust / wgpu 字体演示
src/main/desktop/workspaceConfig.ts     Node.js JSON 配置读写与账户默认 shell
src/main/desktop/main.ts                创建 LynxWindow
rsbuild.config.ts                      pluginLynxtron 启用 AutoLink
native/
  Cargo.toml / Cargo.lock              项目 Rust crate 和依赖
  build.rs                            生成 cxx 桥，构建并链接 C++ 静态库
  src/lib.rs                          napi-rs 类、cxx 桥、共享状态和生命周期
  src/terminal.rs / triangle.wgsl       Rust wgpu renderer 和三角形 shader
  src/atlas.rs                         Alacritty atlas 分配与 wgpu staging buffer 上传
  src/font.rs                          crossfont 字体与字形缓存
  src/tests/                           counter、atlas、font 独立测试模块
  src/atlas_demo.rs / atlas.wgsl        真实字体验证、instance buffer 与采样 shader
  package.json                        @catus/native 本地 workspace
  lynx.lib.json                        声明 macOS arm64/x64 原生产物
  elements.d.ts                       自定义标签及事件的 TypeScript 类型
  index.d.ts / index.d.cts             Rust API 类型及公共类型入口
  index.cjs                           加载当前平台的 .node 文件
  build.mjs                           napi-rs 构建入口，输出扩展和 TypeScript 声明
  cxx/
    CMakeLists.txt                    仅生成项目 C++ 静态库
    NativeInputElementRegistration.cc  LYNX_REGISTER_ELEMENT 注册 native-input
    NativeInputElement.h               属性、事件、setValue/getValue/focus 方法
    NativeInputRust.cc                 检查参数、绑定实例、通过 cxx 调用 Rust
    NativeInputMacOS.mm                创建 NSTextField，布局与输入回调
    NativeTerminalMacOS.mm             借用 IOSurface，创建 Metal texture，注册 native-terminal
src/app/rustInterop.ts                 在实际 native view 上执行跨语言验证
```

`@catus/native` 是整个项目的 native 包。新增组件只需将 C++ 源码加入
`native/cxx/CMakeLists.txt`，以唯一 module 名称和标签调用 `LYNX_REGISTER_ELEMENT`，
再补充 `native/elements.d.ts` 类型。多个组件共享一个 `.node`，不要求包名与标签同名。

```text
pnpm run dev / build
  napi-rs → Cargo → build.rs/CMake，生成 catus-native.node
       ↓
pluginLynxtron（rsbuild.config.ts）
  扫描 lynx.lib.json，复制原生库并注入加载代码
       ↓
native/index.cjs
  require(.node)，激活 LYNX_REGISTER_ELEMENT 静态注册
       ↓
App.tsx / NativeDemo.tsx 渲染 <native-input>
  C++ 创建 NSTextField 并挂到当前 LynxView 的 renderer host
       ↓
OnPropertiesChanged / OnLayoutChanged
  更新原生属性与布局
       ↓
NSTextField 输入 → TriggerEvent("input") → bindinput → React 状态
```

原生库输出：`native/dist/darwin/<arch>/catus-native.node`。
AutoLink 将它加载到桌面主进程并使标签可用于 Lynx runtime；UI 不应直接
import `@catus/native/lynxtron`。示例只使用该包的 TypeScript 类型。

Native UI 后端保留系统输入和 IME 行为。需要覆盖原生控件的 Lynx 内容时，
按官方文档使用 `<cover-view>`；普通 CSS `z-index` 无法可靠交错原生控件。
本例未实现 Windows、Linux 或 Web 后端。

## 官方文档

- [Lynxtron 入门](https://lynxjs.org/next/lynxtron/introduction.html)
- [Lynx Native Libraries](https://lynxjs.org/next/lynxtron/Native-Libraries/Lynx-Native-Libraries.html)
- [Custom Element — Desktop](https://lynxjs.org/next/guide/custom-native-component.html?platform=desktops)
- [Native Libraries and AutoLink](https://lynxjs.org/next/guide/autolink.html)
- [Node 与 Lynx 通信](https://lynxjs.org/next/lynxtron/learn/Communication-Between-Node-And-Lynx.html)
- [napi-rs classes](https://napi.rs/docs/concepts/class)
- [napi-rs CLI build](https://napi.rs/docs/cli/build)
- [napi-rs manual setup](https://napi.rs/docs/introduction/manual-setup)
- [cxx extern Rust](https://cxx.rs/extern-rust.html)
- [cxx Cargo build](https://cxx.rs/build/cargo.html)
- [Lynxtron CEF webview](https://lynxjs.org/next/lynxtron/Native-Libraries/Officially-Maintained-Libraries/cef-webview-getting-started.html)
- [wgpu HAL texture 导入](https://docs.rs/wgpu/30.0.1/wgpu/struct.Device.html#method.create_texture_from_hal)
- [wgpu buffer → texture](https://docs.rs/wgpu/30.0.1/wgpu/struct.CommandEncoder.html#method.copy_buffer_to_texture)
- [wgpu texture 上传布局与 256 字节行对齐](https://docs.rs/wgpu/30.0.1/wgpu/struct.TexelCopyBufferLayout.html)
