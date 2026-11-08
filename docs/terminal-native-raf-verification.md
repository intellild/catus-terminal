# Native RAF 最小验证

2026-10-04，macOS arm64，Lynxtron 0.0.28。

> 历史记录。Lynxtron 0.0.31 修复了 macOS RAF 回调；项目已移除 JS RAF 适配器和
> `delayFrames` 替换，改为 `native/src/binding/vsync.rs` 的安全封装使用 native VSync observer
> 驱动终端帧。下方 0.0.28 的探针与 JS 适配器内容保留用于追溯问题，不再是当前实现。

本文前半部分记录当时的单次 native RAF 探针；探针现已移除，当前采用文末的 native
VSync 帧源。

入口：`native/cxx/NativeTerminalRegistration.cc`。

```text
runtime_attach（BTS）
  获得 lynx_vsync_observer_t
       ↓
lynx_vsync_observer_request_animation_frame
  module 地址作为固定注册 key，userdata 为 nullptr
       ↓
callback（BTS）
  仅打印 start / target，不访问 extension 或 terminal view
```

一次请求对应一次回调。当前不循环请求、不转发 UI 任务、不调用 Rust 渲染，
没有新增调度类、帧 ID、待执行标记、广播或帧队列。
自建 CADisplayLink 和 timer 已删除；终端自动绘制暂时停用，显式 `renderFrame` 保留。

构建使用 `RUSTC_WRAPPER= pnpm run build`（绕过本机 kache 的旧 C++ 构建缓存）。
启动 `lynxtron dist/desktop`，分别以 `CATUS_E2E_WINDOWLESS=1` 和 `0` 运行；
使用独立临时 workspace 配置和现有 JS fake PTY，每个进程观察 8 秒后由测试主动关闭。

| 模式 | 请求日志 | 回调日志 |
| --- | --- | --- |
| windowless | 1 | 0 |
| 普通窗口 | 1 | 0 |

日志及结果保存在忽略目录 `.tmp/native-raf/`。
结果仅确认 native extension 已请求 RAF，尚未证明回调可用。
NSRunLoop 与后台 libuv 的兼容问题是待验证假设，未添加任何宿主修复或计时器兜底。
后续对照分析见下文；当前显示器睡眠，不能据此认定 native RAF 不可用。
构建、TypeScript、lint 和 format 检查通过。
原有自动呈现截图 E2E 依赖持续渲染，当前阶段不能通过；未更新截图基准。

## 使用方式与运行时对照

本地 Lynxtron 的 `src/dependencies/DEPS.lynx` 锁定 Lynx commit
`6dc0784fde6135466c21f51262a81e42a547f6d9`。对照该版本的实现：

- `SetRuntimeAttachedState` 先保存内部 observer，再调用 extension 的 attach 回调。
- `LynxShell` 先执行 monitor 的 `BindToCurrentThread/Init`，再初始化 BTS runtime。
- `RequestAnimationFrame` 要求 BTS 线程；当前在 runtime_attach 中调用满足要求。
- 注册 key 用于待执行集合去重；新 extension 的 module 地址可作为本次唯一 key。
- userdata 可为 nullptr，回调不访问 extension，因此没有探针上下文生命周期问题。
- 缺少 runtime_init 回调会影响 `post_task_to_runtime`，但直接请求 RAF 不使用该字段。

临时记录 Lynx 内部已有 CADisplayLink 的 `addToRunLoop` 和 `setPaused` 调用，
确认请求后 BTS 对应的 display link 执行了 `setPaused(false)`；请求已到达帧源。
临时在 BTS 运行 NSRunLoop，以及将已有 display link 加入 main run loop，
两组对照在 windowless/普通窗口均未收到回调。两组各观察 5 秒。
所有临时运行循环与方法替换都已撤销，项目只保留单次 RAF 探针。

随后在 sandbox 外查询 CoreGraphics，得到主显示器 ID 1、`CGDisplayIsAsleep(1) == true`、
`CGGetActiveDisplayList` 查询成功但活动显示器为空。没有唤醒或修改显示器状态。
该环境不能用于隔离 display link 与 BTS/libuv 的问题；应在显示器活跃时重测。
首轮当时只确认调用路径符合源码要求，不能确认未回调的唯一根因；
显示器唤醒后的重试结果见下文。

源码：
[extension observer 生命周期](https://github.com/lynx-family/lynx/blob/6dc0784fde6135466c21f51262a81e42a547f6d9/platform/embedder/module/lynx_extension_module.cc)、
[RAF 注册与分发](https://github.com/lynx-family/lynx/blob/6dc0784fde6135466c21f51262a81e42a547f6d9/core/shell/vsync_observer_impl.cc)、
[macOS 帧源](https://github.com/lynx-family/lynx/blob/6dc0784fde6135466c21f51262a81e42a547f6d9/platform/darwin/macos/common/vsync_monitor_macos.mm)。

## 显示器唤醒后的重试

2026-10-04 20:08–20:09（Asia/Shanghai）。CoreGraphics 查询：主显示器 ID 1，
`CGDisplayIsAsleep(1) == false`，活动显示器列表为 `[1]`。

每个模式观察 5 秒，进程由测试主动关闭。结果：

| 探针 | windowless 回调数 | 普通窗口回调数 |
| --- | --- | --- |
| 原始单次 native RAF 请求 | 0 | 0 |
| 相同请求后临时运行 BTS NSRunLoop 0.5 秒 | 1 | 1 |

真实回调时间（monotonic ns）：

- windowless：`start=286728858685417 target=286728867018750`
- 普通窗口：`start=286733758657750 target=286733766991083`

两组均只有一次 RAF 请求。对照结果与源码一致：native API 调用正确，
Lynx macOS DisplayLink 加入了 BTS 的 NSRunLoop，而 Lynxtron 的后台事件循环运行 libuv，
没有驱动该 NSRunLoop。临时驱动它后，请求正常得到帧回调。
首轮显示器睡眠也影响了对照实验，唤醒后才隔离出事件循环问题。

临时 NSRunLoop 调用已撤销，重新构建通过；当前源码和产物仍是原始最小探针，
并未将阻塞式 run loop pump 当作正式修复。终端自动绘制仍未接入。
重试日志保存在 `.tmp/native-raf/retry-*.log`。

## 官方文档与 issue / PR 核对

2026-10-04 检索官方文档及 `lynx-family/lynx`、`lynx-family/lynxtron` 的公开
issue / PR，关键词包括 `VSync`、`VSyncObserver`、`requestAnimationFrame`、
`CADisplayLink`、`NSRunLoop` 和 `libuv`。

[LynxExtensionModule 官方文档](https://lynxjs.org/next/api/lynx-native-api/lynx-extension-module.html)
明确 `OnRuntimeAttach` 在 BTS 执行，并向扩展提供 `VSyncObserver`；observer 提供
`RequestAnimationFrame`。文档没有要求等待 `OnRuntimeReady`、绑定 foreground 回调或
由扩展手动驱动 NSRunLoop。当前 C API 调用直接转发到同一 observer 实现，其
`RequestAnimationFrame` 源码断言调用线程为 BTS，当前 attach 探针满足这一约束。
JS Main Thread Script 的 RAF 是另一个入口，不能将其线程规则套到这个 native observer。

相关已合并 PR：

- [#6737：Fix deadlock of vsync for macos](https://github.com/lynx-family/lynx/pull/6737)
  将 DisplayLink 初始化、请求和销毁从 main queue 改为 monitor 绑定的 `runner_`。
  当前锁定源码已经包含该行为，并把 DisplayLink 加到该线程的 `NSRunLoop currentRunLoop`。
  这是与本次问题相关的线程调整，但 PR 本身没有确认 Lynxtron/libuv 的兼容问题。
- [#7055：Properly invalidate CADisplayLink and clear VSync callback on destroy](https://github.com/lynx-family/lynx/pull/7055)
  修复销毁时的 invalidate 和回调清理，当前版本已经包含；它没有处理初次请求不回调。

没有检索到公开 issue 直接确认“Lynxtron 的 libuv BTS 未驱动 macOS native RAF 的
NSRunLoop”这一具体问题。检索到的
[#1570](https://github.com/lynx-family/lynx/issues/1570) 是 Android JS RAF 卡顿，
[#3191](https://github.com/lynx-family/lynx/issues/3191) 是移动端 120 FPS 支持，
均不能作为本次问题的确认依据。

结论：当前接入符合官方接口约束，未发现遗漏步骤。事件循环兼容问题的判断来自
锁定版本源码与显示器唤醒后的对照实验；它尚不是由官方 issue 确认的已知缺陷。


## 当前 native VSync 帧源

Lynxtron 0.0.31 恢复 macOS RAF 后，终端不再依赖 JS RAF 或 main 进程桥。每个
native terminal view 按需 schedule 一帧：

```text
NativeTerminalView (UI)
  网格更新 / terminal-id 切换 / resize / attach / foreground
       → schedule_render → binding::VsyncObserver 安全封装
       ↓ 内部 post_task_to_runtime
BTS
  lynx_vsync_observer_request_animation_frame(observer, view_id, callback, request)
       ↓ callback（BTS，target deadline）
  post_task_to_ui(boxed render)
       ↓ UI
  view.frame(target) → session renderer → 自有 IOSurface → wgpu → PresentSurface
```

`binding/vsync.rs` 只在内部共享 module 和 observer；每个 view 在内容变化时
`schedule_render`，不会常驻请求 RAF。同一 view 最多只有一个 VSync 请求和一个待处理
UI 渲染；UI 忙或过期 deadline 直接丢弃，不补帧、不排队。没有全局帧回调注册、
JS 帧驱动、帧 ID、broadcast 或应用维护的帧队列。
`on_runtime_detach`、view/extension 销毁会取消请求；后台保留 dirty 状态但跳过 UI 渲染，
foreground 恢复时重新 schedule。Lynx 以 0 target 取消未完成请求。
`renderFrame` 保留为显式入口。
deadline 直接使用 VSync 的 monotonic target，不再经过 JS timestamp 或 N-API 预算。

## 历史：JS RAF 适配器（0.0.28）

0.0.28 中 native VSync observer 的 DisplayLink 挂在 BTS 的 NSRunLoop，而 Lynxtron
的后台循环运行 libuv，因此回调不触发。当时临时改为：

```text
App / frame-driver.ts
  MTS requestAnimationFrame → runOnBackground 调用 preload
       ↓
frame_driver.rs / dispatchAnimationFrame()
  native monotonic clock + 16.7ms 预算 → main queue / UI
       ↓
frame_callbacks.rs / dispatch_frame_callbacks(deadline)
```

该适配器、preload 的 `dispatchAnimationFrame` 导出和 `delayFrames` 替换均已删除。
21:00 后显示器唤醒，直接 MTS RAF 探针收到一次回调；当时最终验证为构建、TypeScript、
lint、format、29 个 Rust 测试、clippy、20 个 ReactLynx 单测和 1 个 PNG 比较器测试通过，
windowless E2E 5/5 通过，截图差异像素为 0。这些结果只对应 0.0.28 的临时实现。
