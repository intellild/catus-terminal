# Native terminal 直接嵌入：Windows DirectComposition / macOS NSView

状态：待实现。已检查 Lynx、Lynxtron 和 wgpu 源码。Windows DirectComposition 与 macOS NSView 直接呈现方案均未运行验证；现有 macOS IOSurface 渲染不属于此方案的验证结果。

## 目标

让 Windows 的 native terminal view 使用独立的 DirectComposition visual，由 Rust wgpu 直接渲染并呈现。先用三角形验证，再接入现有 terminal session、网格和 glyph atlas。

优先验证「子 HWND + 独立 DirectComposition target/visual」方案。后续若需要与 Lynx 内容共享裁剪和层级，再评估向 Clay 暴露 visual 挂接接口。

macOS 对应验证「子 NSView + CAMetalLayer」方案，让 wgpu 直接呈现到视图的 Metal drawable。两端共享 terminal 计算层、device/atlas 和绘制逻辑，平台侧分别管理窗口或视图的嵌入。

## 现有 CEF 实现

Lynxtron 的 CEF 包使用 Lynx 中的 native 实现。此次检查同时对照了 Lynxtron 锁定的 Lynx 提交 `6dc0784fde6135466c21f51262a81e42a547f6d9`。

Windows 默认模式通过 `SetAsChild` 嵌入 CEF 子 HWND；开启 `use-osr` 后采用 D3D11 共享纹理：

```text
CEF 产帧
  OnAcceleratedPaint：提供 D3D11 共享纹理 HANDLE
       ↓
Lynx AcquireSurface
  获取 Lynx back buffer 的共享 HANDLE
       ↓
OpenSharedResource / OpenSharedResource1
  打开源纹理和目标纹理
       ↓
目标纹理 AcquireSync
  CopyResource：GPU 复制
  Flush + ReleaseSync
       ↓
SwapBack
  通知 Clay 有新帧
       ↓
Clay 按自己的合成时序绘制纹理
```

参考源码，路径均相对于本地 Lynx 仓库：

- `platform/embedder/plugin/cef/src/win/cef_webview_client_win.cc`：共享纹理打开、GPU 复制和提交。
- `platform/embedder/plugin/cef/src/win/cef_webview_win.cc`：子窗口、OSR、布局和显示状态。
- `clay/lynx_adaptor/native_platform_view.cc`：native surface 与 shared image sink 的衔接。

现有 `AcquireSurface` / `PresentSurface` 接口处理系统共享图形 buffer，Windows 上对应 D3D 共享纹理 HANDLE，没有直接注册 `IDCompositionVisual` 的接口。D3D 共享纹理 HANDLE 与 DirectComposition surface handle 不可互换。

## 拟采用的接入方式

```text
NativeTerminalView（Windows）
  从 Lynx 获取宿主 HWND
  创建子 HWND、DirectComposition device / target / visual
       ↓
通过 cxx 将有效的 IDCompositionVisual 指针交给 Rust
       ↓
wgpu DX12
  SurfaceTargetUnsafe::CompositionVisual
  创建 composition swapchain，并设置 visual 的 content
       ↓
Native 侧提交 DirectComposition visual 树
  Commit：初次挂接、content 重建和布局变更
       ↓
Rust renderer
  获取 surface texture → 绘制 → present
       ↓
DWM 合成 terminal 与应用窗口
```

项目当前使用的 wgpu `30.0.1` 提供 `CompositionVisual` 和 `SurfaceHandle`，均需要 DX12 后端。当前 Cargo 配置只启用了 Metal，实施时需拆分平台依赖并增加 Windows `dx12` 支持。

```rust
// Windows + dx12 下的示意代码；visual_ptr 必须是有效的 COM 接口指针。
let surface = unsafe {
    instance.create_surface_unsafe(
        wgpu::SurfaceTargetUnsafe::CompositionVisual(visual_ptr),
    )?
};
```

wgpu 会保留 visual 的 COM 引用，并在配置 surface 时设置 swapchain content；外部 visual 所属的 device、target、窗口和 visual 树仍由 native 侧管理。该路径需要调用方完成 DirectComposition `Commit`。

职责分配：

- `native/cxx/`：Windows 窗口、DirectComposition 树、布局、焦点、输入和生命周期。
- Rust renderer：共享 GPU device/atlas、每个呈现目标的 surface，以及 session 网格的绘制。
- terminal 计算层：PTY 字符流、网格和 revision。PTY 线程只更新数据。
- 独立 frame driver：决定何时读取网格并绘制，处理隐藏、空闲和过期帧。DWM 负责最终合成，`present` 不会自动调用我们的 renderer，也不保证与 Lynx RAF 一一对应。

## 与 Clay 的关系

Clay 已有 `clay/shell/platform/windows/egl/direct_composition_surface.cc`，使用 `CreateSwapChainForComposition → SetContent → Present1 → Commit` 输出窗口画面。目前这条路径没有向 native component 暴露 visual 挂接接口；主视图与 overlay 视图还可能选择不同的输出后端。

独立子 HWND 可以先验证直接呈现，避免依赖 Clay 内部 visual。代价是必须自行同步位置、DPI、可见性、裁剪和窗口层级，并确认 Lynx 弹层能否正确覆盖 terminal。

如果需要统一的混合层级与裁剪，应评估扩展 Clay：提供组件 visual 的挂接/移除接口，并将布局、裁剪、变换和顺序同步到 DirectComposition 树。这是后续候选方向，尚未确定接口设计。

## 实施与验收

- [ ] 拆分 Cargo、cxx 和 CMake 的平台依赖，保留 macOS 构建，增加 Windows DX12 构建。
- [ ] 创建最小子 HWND + DirectComposition visual，使用 wgpu 渲染三角形；验证 attach/detach/destroy 和反复 resize。
- [ ] 验证 DPI 切换、最小化/恢复、隐藏/显示，以及 surface 丢失后的重建与 Commit。
- [ ] 验证 Lynx 弹层遮挡、滚动裁剪、透明区域、鼠标和键盘焦点；据结果决定是否需要 Clay visual 接口。
- [ ] 接入 terminal session 网格和现有 atlas；补齐 Windows 字体选择，验证 tab 切换和关闭后的资源释放。
- [ ] 独立验证帧调度：PTY 更新只改变数据，帧回调消费最新网格；空闲不重复绘制，过期帧跳过。
- [ ] 增加独立 Rust 渲染测试，以及 Rstest 驱动的 Windows E2E 和截图对比。优先使用 Lynx 的 DOM/Input 与 `view.takeScreenshot`，先确认截图是否包含独立 DComp 内容。
- [ ] 检查 windowless 模式：独立 HWND 方案依赖真实窗口，不能假定现有 windowless E2E 能覆盖它。若 Lynx 截图不包含该内容，记录覆盖限制并另行设计自动化捕获；不以 computer-use 截图作为验收基准。

## macOS：直接嵌入 NSView + CAMetalLayer

Lynx CEF 的非 OSR 实现已经直接嵌入 NSView：`lynx_view_get_native_window` 在这条 macOS 路径返回宿主 NSView，通过 `addSubview` 挂接 CEF 子视图，detach 时 `removeFromSuperview`，布局变化时更新子视图 frame。

参考源码，路径相对于本地 Lynx 仓库：

- `platform/embedder/plugin/cef/src/macos/CEFWebviewMac.mm`：`OnAttach`、`OnDetach`、`OnLayoutChanged` 和 `AddSubview`。
- `platform/embedder/plugin/cef/src/macos/CEFWebviewClientMac.mm`：`AttachToView` 获取并配置 CEF 子 NSView。

拟采用的流程：

```text
NativeTerminalView（macOS，AppKit 主线程）
  从 Lynx 获取宿主 NSView
  创建 terminal 子 NSView，使用 CAMetalLayer 作为 backing layer
  addSubview 挂接到宿主
       ↓
通过 cxx 把有效的 CAMetalLayer 指针交给 Rust
       ↓
wgpu Metal
  SurfaceTargetUnsafe::CoreAnimationLayer
  创建 surface，使用共享 GPU device 配置
       ↓
OnLayoutChanged / backing scale 变化
  更新 NSView frame、layer scale 和 surface 物理像素尺寸
  根据字号与行高更新 terminal 网格
       ↓
独立 frame driver
  读取 session 最新网格 → renderer 绘制 surface texture → present
       ↓
Core Animation 合成子视图与应用窗口
```

可以创建 NSView 子类，在 `makeBackingLayer` 返回 CAMetalLayer，并启用 `wantsLayer`。具体 AppKit 创建、挂接、移除和布局操作在主线程完成。直接嵌入后端拟使用 `IsSurfaceEnabled() == false`，由自己管理子视图，不再经由 Lynx 的 texture surface 路径。

wgpu `30.0.1` 在 Metal 后端提供以下入口，项目已启用 Metal：

```rust
// layer_ptr 必须指向实际的 CAMetalLayer，不能传 NSView 或普通 CALayer。
let surface = unsafe {
    instance.create_surface_unsafe(
        wgpu::SurfaceTargetUnsafe::CoreAnimationLayer(layer_ptr),
    )?
};
```

native 侧负责子视图和 layer 的生命周期；销毁时先停用帧回调并释放 Rust surface，再移除和释放视图。`OnDetach` 只暂停绘制并移除视图，不销毁 tab session；重新 attach 或切换 `terminal-id` 时复用同一个 native view，重新绘制对应 session。

与当前 `native/cxx/NativeTerminalMacOS.mm` 的 IOSurface 路径相比，这个后端使用 CAMetalLayer drawable，不调用 `AcquireSurface` / `SwapBack`，也不需要把 Lynx 借出的 IOSurface 导入 Rust。renderer 应抽离目标纹理的获取与呈现，继续复用网格、glyph atlas 和实际绘制逻辑。

NSView frame 使用逻辑坐标，surface 配置使用物理像素；必须确认宿主是否 flipped，并正确转换 Lynx 的坐标。跨屏移动时同步 backing scale、字体物理尺寸和 drawable 尺寸；零尺寸或隐藏状态停止获取 drawable。

独立 NSView 由 AppKit / Core Animation 合成，需要自行验证与 Lynx 弹层的遮挡、裁剪和输入关系。layer 的呈现同步也不会自动产生 renderer 回调；帧源仍放在独立模块中，这条路径不能证明 Lynx native RAF 问题已经解决。

macOS 实施与验收：

- [ ] 用子 NSView + CAMetalLayer 渲染三角形，验证首次显示、反复 attach/detach 和销毁。
- [ ] 验证逻辑坐标、flipped 坐标、Retina/非 Retina 跨屏、resize、零尺寸、最小化和恢复。
- [ ] 接入共享 device/atlas 和 terminal session；验证切换 ID 不重建视图、关闭 session 后停止访问其资源。
- [ ] 验证 Lynx 弹层遮挡、滚动裁剪、透明区域、焦点、键盘、鼠标与后续 IME 接入。
- [ ] 检查 `view.takeScreenshot` 是否包含子 NSView / CAMetalLayer；确认 windowless 模式是否有可挂接、可呈现的宿主视图，不能直接沿用现有 IOSurface E2E 的覆盖结论。
- [ ] 添加独立 Rust 渲染测试，以及 Rstest + Lynx 截图对比；截图缺少 native layer 时记录限制并设计自动化覆盖，不使用 computer-use 作为验收基准。

## 参考

- [Microsoft：IDCompositionVisual::SetContent](https://learn.microsoft.com/en-us/windows/win32/api/dcomp/nf-dcomp-idcompositionvisual-setcontent)
- [Microsoft：CreateSwapChainForComposition](https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_2/nf-dxgi1_2-idxgifactory2-createswapchainforcomposition)
- [Microsoft：IDCompositionDevice::Commit](https://learn.microsoft.com/en-us/windows/win32/api/dcomp/nf-dcomp-idcompositiondevice-commit)
- [Apple：CAMetalLayer](https://developer.apple.com/documentation/quartzcore/cametallayer)
- [Apple：NSView.wantsLayer](https://developer.apple.com/documentation/appkit/nsview/wantslayer)
- [wgpu 30.0.1 surface 源码](https://docs.rs/crate/wgpu/30.0.1/source/src/api/surface.rs)：`CompositionVisual`、`SurfaceHandle`、`CoreAnimationLayer` 的定义和生命周期约束。
- [wgpu-hal 30.0.1 DX12 源码](https://docs.rs/crate/wgpu-hal/30.0.1/source/src/dx12/mod.rs)：创建 composition swapchain 和外部 visual 的 `SetContent` 路径。
- [wgpu-hal 30.0.1 Metal 源码](https://docs.rs/crate/wgpu-hal/30.0.1/source/src/metal/mod.rs)：`create_surface_from_layer` 和 Metal surface 实现。
