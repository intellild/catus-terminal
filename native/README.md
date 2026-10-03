# @catus/native

Catus Terminal 专属的 Rust/napi-rs workspace，统一导出 Rust 能力和 Lynx native
组件。包名为 `@catus/native`，所有组件链接进同一个 `catus-native.node`。
当前实现 `<native-input>`（macOS `NSTextField`）和 `<native-terminal>`
（Lynx IOSurface + Rust wgpu / Metal 三角形和 glyph atlas 原型）。

```text
native/
  Cargo.toml / Cargo.lock       Rust crate 和依赖
  build.rs                     cxx 桥、C++ 静态库构建及链接
  src/lib.rs                   napi-rs 导出和共享 Rust 状态
  src/terminal.rs               wgpu renderer 和 Metal texture 导入
  src/triangle.wgsl             三角形 shader
  src/atlas.rs                  Alacritty atlas 分配、分页和 staging buffer 上传
  src/font.rs                  crossfont 字体、metrics 和 GlyphKey 缓存
  src/atlas_demo.rs / atlas.wgsl 真实字形、instance buffer 和采样验证
  src/tests/                   counter / atlas / font 独立单元测试模块
  licenses/ALACRITTY-MIT.txt     atlas 来源的 MIT 文本
  cxx/
    CMakeLists.txt             项目 C++ 静态库的源文件清单
    NativeInputElement*.cc/h   输入组件及宏注册
    NativeInputRust.cc         C++ → Rust 调用
    NativeInputMacOS.mm        AppKit 输入框实现
    NativeTerminalMacOS.mm     IOSurface/Metal 桥接和 terminal 组件注册
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

## 构建与加载

`native-terminal` 使用 `CatusNativeTerminalElement` 注册，启用
`IsSurfaceEnabled()`。`AcquireSurface` 的尺寸是物理像素，macOS 返回借用的
`IOSurfaceRef`。C++ 用 Rust renderer 的 `MTLDevice` 创建对应的 BGRA8Unorm
texture，通过 cxx 交给 Rust wgpu 导入并绘制；GPU 完成后才 `SwapBack` 和
`MarkDirty`。没有独立的 NSView 或 CAMetalLayer。

调用 `renderTriangle({})` 返回 `{ backend, adapter, width, height, pixelRatio,
frames, gpuFrames, centerRGB, cornerRGB, pixelVerified, error, transport }`；
`getRendererInfo({})` 只读取相同状态。尺寸无效、纹理导入或 GPU 绘制失败时，
`renderTriangle` 返回状态 7。未知方法返回 3。renderer 生命周期由 view 管理。
本原型同步等待 GPU，并读取 IOSurface 像素进行验证，尚未实现持续帧调度。

`renderAtlas({})` 使用字形 atlas 绘制；`clearAtlas({})` 清空字形缓存、
复用 atlas texture 并重新上传。返回值增加 `mode`、`atlasPages`、
`atlasUploads` 和上次 atlas 绘制的 `atlasInstances`。
`AtlasSet` 接受 Gray/RGB/RGBA `RasterizedGlyph`，经 256 字节行对齐的
`COPY_SRC` staging buffer 上传。普通字形使用 R8Unorm coverage 页；彩色字形
使用 RGBA8Unorm 页，分别分配与复用。RGB coverage 保留原演示的均值策略，
不修改 crossfont 的平台抗锯齿设置。
`Glyph` 保存页索引、generation、UV 和 metrics，clear 后旧句柄失效。

`font.rs` 引入官方 crossfont 0.9.0，macOS 使用 CoreText。缓存 key 包含字体、
字符和字号；Menlo 普通体/粗体与系统 fallback 绘制 ASCII、中文和彩色 emoji。
空格缓存 metrics 但不上传、不绘制。字体按 22 logical px × backing scale
栅格化，使用 glyph 的 top/left 和 font metrics 定位，而非缩放固定位图。
backing scale 改变时重建 rasterizer、清空缓存并复用 atlas texture；普通 resize
复用字形。bind group 和 instance buffer 也会复用。

状态额外返回 `fontFamily`、`fontPixels`、`cachedGlyphs`、`rasterizations`、
`missingGlyphs`，便于验证重复绘制不再栅格化/上传。测试覆盖真实字体、中文
fallback、RGBA emoji、字号失效、缓存复用，以及 Metal 上传/回读和双格式分页。
本阶段按字符绘制，未实现 ligature、复杂文本 shaping 和 PTY。

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
