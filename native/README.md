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
  src/terminal_core/session.rs 网格、键盘、鼠标、粘贴和选区
  src/terminal_core/pty.rs     Pty 句柄、阻塞 I/O 线程、async 桥接和进程回收
  src/terminal_core/pty/       PtyDelegate trait 与普通/tmux 协议适配
  src/host.rs                 Host 会话归属、创建、查找、关闭和 detach
  src/host/                   HostDelegate trait 与普通/tmux 后端
  src/host/factory.rs         HostFactory 选择后端并注入 Host::new
  src/terminal_session.rs      N-API u32 句柄接口和 session renderer
  src/terminal_view.rs         layout resize、revision 和网格快照编排
  src/renderer.rs              共享 GPU、平台无关 wgpu 绘制与 deadline
  src/frame.rs                 平台无关的 cxx Viewport
  src/binding/vsync.rs         VSyncObserver 的安全 Rust 封装
  src/terminal_extension.rs    Rust 组件注册和窗口生命周期
  src/native_terminal_view/
    mod.rs                     NativeTerminalView 对象和模块导出
    host.rs                    TerminalHost 与 view/scheduler 注册
    render_scheduler.rs        VSync 按需渲染状态机
    state.rs                   终端绑定、layout、焦点和错误状态
    view.rs                    element 生命周期、layout、props、invoke 和事件
  src/binding/                共享 bindgen C ABI、Extension / NativeView trait 和 Value RAII
  src/platform/
    mod.rs                     按目标平台选择适配器
    unix.rs                    Unix 默认 shell 和 PTY EOF 策略
    windows.rs                 portable-pty 默认进程和 EOF 策略
    macos/
      mod.rs                   Metal 后端选择
      surface.rs               IOSurface 创建、校验与 wgpu texture 导入
      osr.rs                   自建 OSR IOSurface 池与帧轮换
      terminal.rs              macOS 输入数据和纹理渲染入口
      native_view.rs           Lynx 宿主、鼠标事件和 surface 的 macOS 适配
      view.rs                  Rust NSView、CAMetalLayer、嵌入 / OSR 生命周期
      input_view.rs            objc2 NSResponder、NSTextInputClient 和组合文本
      frame.rs                 native 回调、monotonic clock 和 libdispatch 主队列调度
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
      NativeTerminalRegistration.cc  加载时调用 Rust 注册入口
    platform/
      UiThread.h / RustBridge.h  按平台选择 UI 与 Rust 桥接适配
      macos/
        UiThread.h              monotonic clock 与 UI 线程检查
  package.json / build.mjs      napi-rs 构建入口
  lynx.lib.json / index.cjs     AutoLink 产物描述与加载
  index.d.ts                   napi-rs 自动生成的 Rust API 类型
  elements.d.ts                Lynx 组件类型
  index.d.cts                  公共类型入口
```

terminal 的 extension module 负责组件注册和窗口生命周期。新增原生组件时，
实现 `binding::native_view::NativeView` / `ViewFactory`，由 extension 注册标签，
并在 `elements.d.ts` 声明标签类型。

`src/binding/` 统一保存 SDK 生成的 C ABI 和 Rust 封装；`extension.rs` 提供 extension 桥接层。
实现 `Extension` trait 后，`Module::new(value)` 自动绑定全部生命周期回调；未实现的方法为空操作。
回调按具体 Rust 类型单态化，不使用 trait object 或 C++ 虚函数。状态要求 `Send + Sync`，
因为 UI 与 BTS 生命周期可能跨线程执行；view、observer 和 N-API 参数仍需遵守各自线程及有效期。
`Module` 持有初始 C 引用，未交给宿主时 Drop 会 unref；factory 用 `into_raw()` 转交给 Lynx。
`on_destroy` 只通知生命周期，最后一次 unref 的 finalizer 才回收 `Box<T>`。
在支持 unwind 的构建中，桥接捕获回调/析构 panic，避免其跨越 C ABI。
`binding/binding.h` 汇总 SDK 头文件，并将 C++ invoke 状态常量暴露为 enum。
构建时 bindgen 通过此入口从 pnpm 安装的 `lynx-library-headers` 生成 C ABI 类型、回调和函数声明，
产物写入 Cargo `OUT_DIR`，不提交生成代码；按相关 C API 分组过滤，并复用 napi-rs 的 N-API 类型。
SDK 头文件变动自动触发重新生成；测试用独立 C 宿主替身和生成的回调类型验证绑定和释放。
生成需要 libclang，macOS 可使用 Xcode Command Line Tools 提供的版本；自定义安装可设置 `LIBCLANG_PATH`。

`terminal_extension.rs` 实现 `Extension` trait，通过泛型 `register<T>` 注册 factory。
每个 Lynx view 创建一个 Rust extension 和帧注册表；`on_view_create` 注册 `native-terminal`。
Rust native view 克隆该表的共享句柄，不再使用 C++ shared host 或 render target。
前后台生命周期直接修改 Rust 状态；view/module 销毁及最终 Drop 均停止帧回调。
已创建的 native view 可以比 extension 活得更久，但不能继续绘制已销毁窗口。
C++ 注册文件只保留加载 constructor，由 cdylib 专用静态库触发，避免 Rust 测试进程自动注册宿主接口。
C++ extension / native view 类及 weak N-API 编译选项已移除。

`binding/native_view.rs` 提供 `NativeView` trait；`View::new` 绑定全部生命周期、
layout、props、motion、focus 和 invoke 回调，按具体 Rust 类型单态化。
`ViewFactory` / `register<T>` 将具体组件注册给 Lynx；借用的 factory context
由 extension 持有到窗口销毁。`on_destroy` 仅通知组件清理，最后一次
`lynx_native_view_release` 才释放 Rust 对象。创建失败和初始化 panic 同样释放初始引用。
Native View 限定在创建/UI 线程，允许直接持有 AppKit 和 RefCell 状态；不要求 Send/Sync。
`Handle` 在释放后失效；`Target<T>` 可保存在共享 frame registry 中，但仅在创建线程
借用组件，释放后的回调直接跳过。回调执行期间 retain host，防止事件/焦点重入释放对象。
`binding/value.rs` 管理属性读写、UTF-8、引用计数和事件/invoke 值的所有权转移；
内部错误保留 anyhow 原因链，在 invoke 边界转换为 Lynx 状态码。
`binding/types.rs` 将 SDK 常量转换为 Rust enum：事件/设备/滚动信号、surface buffer 模式、
Value 类型、Value API 状态和 invoke 状态。未知值使用 `Unrecognized(raw)` 保留，
不将未经校验的数字 transmute 为 enum。鼠标按键通过 `MouseButton` / `MouseButtons`
表达组合与未知 bits；`MotionEvent` 在回调边界转换枚举、字段名及 bool。
应用代码使用 typed 参数，`Reply` 返回 `InvokeStatus`，`NativeView::surface_buffer_mode`
返回 `SurfaceBufferMode`。invoke 数字来自已安装 SDK 的 C++ constexpr，经 bindgen
生成，Rust 不重复维护数值。FFI 模块私有；平台宿主操作通过 `binding/host.rs` 调用。
SDK C ABI / 泛型桥接的独立宿主测试位于 `src/tests/lynx_native_view*.rs` 和
`src/tests/lynx_value_host.rs`，实际 native component 创建由运行时 E2E 验证。

`binding/protocol.rs` 集中定义字符串协议的 `ExtensionName`、`ElementName`、
`Event`、`Property` 和 `Method` 枚举。注册、属性读写、事件发送和 invoke 回调
只接受枚举；C 字符串编码/解析在 binding 内完成，原有 JS 接口名称保持不变。
未知方法转换为 `Method::Unknown` 并返回 `MethodNotFound`。新增组件的协议名称
也在此目录维护；文本内容、错误信息和运行时 URL 仍使用普通字符串。

## 终端对象和帧接口

`createTerminalSession(id)` 接收 JS 分配的正整数 `u32` ID，创建默认 shell，成功返回 void。
Rust 不分配 ID，互斥保护注册表创建，拒绝重复 ID 和保留值 0；创建失败不占用 ID。
第二个可选参数 `{ hostId?, program, args, cwd?, tmux? }` 指定所属 host 和启动参数。
`tmux` 存在时 tmux tab 使用 session 模式：`resolveTmuxLaunch` 在目标机器上没有 session
时新建 `<prefix>0`，否则 attach 最近使用的 session（或菜单指定的目标）。Rust 在 control
mode attach 后先用 `display-message -p '#{session_name}'` 确认实际 session，再列出并管理
该 session 的窗口；`TmuxOptions.session` 是启动时的预期名称，attach 后以 tmux 的回复为准。JS 通过
`getTmuxSessionInfo(id)`、`selectTmuxWindow(id, windowId)`、`createTmuxWindow(id)` 和
`closeTmuxWindow(id, windowId)` 驱动 terminal 标题栏中的 tmux tab；返回的
`TmuxSessionInfo.windows` 包含窗口 ID、index、名称和 active 状态。
省略 `hostId` 时归入默认 host，兼容直接调用 N-API 的测试和主机。
E2E preload 用 `CATUS_E2E_PTY`
和 `CATUS_E2E_NODE` 指向 JS fixture 与 Node，不读取用户的 shell 初始化脚本。
数字 tab ID 直接作为 session ID；JS 全局 `sessionRegistry` 的 `sessionAtom` 写入时同步 native session。
新 tab 创建 session、关闭 tab 或删除 host 时删除对应 session，registry 销毁时 detach 剩余 session。
`TerminalView` 只展示 atom 派生的 ID 和错误；React unmount/remount 不影响 session 生命周期。
`TerminalView` 与 `NativeTerminalView` 持续挂载，切换 tab 只更新 `terminal-id`，无需 active 或 key。
没有选中 tab 时 ID 0 清除 native 绑定并隐藏 view，Rust 停止该 view 的帧监听；loading/配置错误也保持挂载。
Rust `Host` 强引用自己所属的 session；全局 `Hosts` 只维护 host 和数字句柄的归属索引。
每个 session 拥有计算层和带锁的 renderer/viewport。
renderer 在首次有效 layout 时惰性创建，之后随 session 保留。
切换 tab 保留同一个 native element、shell 和 renderer，由 OnPropertiesChanged 更新 session 绑定。
Rust 的 `on_properties_changed` 校验数字 ID，并取得共享 `TerminalHandle`。
诊断/主机 API 为 `writeTerminalSession(id, text)` 和 `getTerminalSessionInfo(id)`。

`terminal_core/grid.rs` 只计算 Alacritty 字符网格；`terminal_core/session.rs` 管理网格及输入编码，
通过 `Pty` 发送已编码的字节。`terminal_core/pty.rs` 管理阻塞 PTY 读写线程和进程回收。
portable-pty 的 reader/writer 各占一个独立线程，只负责阻塞读写；reader 通过有界
tokio channel（16 个 chunk）把字节交给专用 tokio runtime 上的 async parser，writer
从无界 channel 接收命令，避免 UI 输入等待 PTY。parser 获取
`tokio::sync::Mutex<TerminalGrid>` 后 `.await` `PtyDelegate`；delegate 方法本身也是
async，`TmuxPtyDelegate` 的 `TmuxClient` 使用 tokio Mutex。PTY 的
master/child/input/error 和 grid 都使用 tokio 锁，UI/N-API/测试的同步边界用
`block_on`/`blocking_lock` 进入 async API。关闭时先发送 delegate 命令，再发送带
grace 的 Close；writer 在 grace 内保持 fd 打开，让 shell 消费已排队的命令后退出。
`host.rs` 管理生命周期，`terminal_session.rs` 提供 N-API 和 native handle，
`terminal_view.rs` 编排共享渲染流程，
`platform/macos/terminal.rs` 提供 macOS cxx 适配。
`OnLayoutChanged` 接收逻辑尺寸及 backing scale，更新 viewport，再用 crossfont
字体 advance、line height（含 CoreText leading）和 padding 计算行列，resize PTY。
属性晚于 layout 到达时，绑定 session 后应用缓存的 layout；UI 不传宽高或行列参数。
`renderFrame()` 只读取 session 的 renderer/viewport、检查 revision、生成快照并绘制。
`renderer.rs` 接收计算后的网格、session 的 viewport 和准备 wgpu texture 的回调，
不访问 PTY 或 OS 指针。macOS 回调在 `platform/macos/surface.rs` 导入 IOSurface。
native view 不独立持有或创建 renderer。

配置数据在 TypeScript 中使用 `HostProfile` / `HostProfileSchema`，配置文件包含 `hosts` 与 `display` 字段。
Rust `Host` 统一管理会话创建、查找、关闭、detach 和成员清理；
`HostFactory` 根据启动参数选择普通或 tmux delegate，传给 `Host::new(delegate)`。
`Hosts` 持有 factory；已有 host 的后端更新也由 factory 注入，
`Host` 本身不判断后端类型。
`HostDelegate` 只创建对应后端的会话，不管理终端协议。
`TerminalSession` 管理网格和输入编码，持有一个 `Pty`；`Pty` 统一管理 PTY 句柄、
I/O 线程、错误、退出状态和子进程回收，通过 `PtyDelegate` 调用后端特有操作。
`terminal_core/pty/plain.rs` 处理普通 PTY 字节和窗口尺寸；`terminal_core/pty/tmux.rs`
处理 control mode 协议、窗口 resize 和关闭窗口。关闭 terminal tab 只发送
`detach-client`，session 由 session 菜单显式结束。
`PtyDelegate::close` 返回进程回收前的宽限时间，让 tmux 关闭命令先经过 writer 送到服务端。
`Pty` 的 Drop 默认 detach；显式 close 后的再次 close、detach 或 Drop 不重复发送关闭命令。
每个 session 保留创建时的 `PtyDelegate`，因此修改配置只影响新建 tab；原来的普通或 tmux
会话继续使用自己的后端。创建失败不留下空 host 或占用数字 ID。

```text
HostProfile
  preload 解析启动参数，传入 hostId
       ↓
Hosts（host.rs）
  检查全局 ID 唯一性，定位所属 Host
       ↓
HostFactory（host/factory.rs）
  选择普通 / tmux delegate → Host::new(delegate)
  已有 host 则更新未来会话使用的 delegate
       ↓
Host
  保存 session 成员，统一创建 / 查找 / close / detach
       ↓
HostDelegate（host/delegate.rs）
  选择普通或 tmux 会话及其 PtyDelegate
       ↓
TerminalSession（terminal_core/session.rs）
  网格、键盘、鼠标、粘贴和选区
       ↓
Pty（terminal_core/pty.rs）
  共享 PTY 句柄、I/O 线程、错误和子进程回收
       ↓
PtyDelegate（terminal_core/pty/delegate.rs）
  PlainPtyDelegate → 原始字节流和 PTY resize
  TmuxPtyDelegate → control mode 和 tmux window resize
       ↓
现有 renderer 和 native view
```

| native-terminal 接口 | 用途 |
| --- | --- |
| `terminal-id: number` | 正数绑定 u32 session ID，0 解绑 |
| `renderFrame()` | 使用 session 的 viewport 绘制最新网格，空闲时跳过 GPU；成功返回 true |
| `focus()` | 获得 Lynx 键盘焦点 |
| `write({ text })` | 写入 UTF-8 文本（诊断/未来粘贴入口） |
| `key({ key, control, alt })` | 编码普通键和基本终端控制键并写入 PTY |

`binding/vsync.rs` 保存 module 和 Lynx VSync observer，对外只暴露安全的
`VsyncObserver` 句柄；raw pointer、BTS task 和 N-API callback 都留在 binding 内。
渲染是事件驱动的：terminal 网格更新、terminal-id 切换、layout/resize、attach 和
foreground 恢复时调用 `schedule_render`。它通过绑定层请求一次与 VSync 同步的渲染，
VSync 回调只把这个 view 的 target deadline 投递到 UI，再由该 view 调用自己的
`frame(deadline)`。同一 view 同时只有一个 VSync 请求和一个待处理 UI 渲染；
UI 忙或 deadline 过期时直接丢弃，不补帧、不排队，也不维持常驻 RAF 循环。
`on_runtime_detach`、view/extension 销毁会取消 pending 请求；后台保留 dirty 状态，
foreground 恢复时重新 schedule。Lynx 以 0 target 取消未完成的请求。
deadline 直接来自 VSync 的 monotonic target，不再经过 JS timestamp 或 N-API 预算。
`renderFrame` 保留为显式入口。
原 native RAF 调查见 [验证文档](../docs/terminal-native-raf-verification.md)。
每个回调都检查本次 VSync 的 monotonic deadline；view/session/grid/atlas 锁忙则直接丢帧。
提交前过期丢弃 encoder 并撤销未上传的 atlas handles；提交后过期先等待 GPU 完成，
再丢弃呈现，保持网格 dirty。不会把还在写入的借用 buffer 还给 Lynx，也不会重放旧帧。
async parser 只更新自己的网格；attach/layout/props 只更新状态，不直接启动 GPU 绘制。
网格 revision、尺寸和 scale 均未变化时不获取 framebuffer、不生成快照、不绘制。
ID 0、零尺寸、detach、后台和销毁停止执行渲染回调。
Rust 测试在 `src/tests/vsync.rs`，覆盖安全封装下的请求、回调、detach 和重复请求拒绝。
网格变更通知通过 `TerminalGrid::set_on_change` 传递到 view 的 `schedule_render`。
`src/tests/macos/terminal_rendering.rs` 使用真实 portable-pty 启动
`../tests/fixtures/fake-pty.mjs`，通过 session 的 `render_surface` 导入真实 IOSurface 并回读
Metal 像素。覆盖网格更新、空闲跳帧、过期/资源忙丢帧后的最新网格恢复、坏 framebuffer、重新绑定、session 隔离和 DPI resize。
`src/tests/renderer_support.rs` 只提供共享测试锁；
`src/tests/macos/surface_support.rs` 提供 IOSurface 创建与像素回读夹具。
桌面自动化与截图对比通过根目录 `pnpm run test:e2e` 运行。
逐字符 atlas 支持普通/粗体、前景/背景色、下划线、删除线、光标及宽字符。
macOS 输入通过 NSResponder / NSTextInputClient 处理，组合文本在提交前只作为显示叠加。
剪贴板粘贴独立于普通文本输入：开启 bracketed-paste 时整包发送起止标记，并过滤
payload 中的 ESC/Ctrl-C；关闭时将 CRLF/LF 转为 Enter 的 CR，普通输入保持原样。
滚轮和触控板滚动 Alacritty 历史；拖动选择文本，双击选词、三击选行，Option 拖动矩形选择，Cmd+C 复制。
程序启用鼠标报告时，点击、拖动和滚轮转发给 PTY；Shift 强制本地选择/历史滚动。备用屏幕使用 Alacritty 的 alternate-scroll 模式发送方向键。
OSR pointer cancel 使用记忆中的按键、位置和按下时修饰键补发 release；即使无布局或
取消坐标无效也会清理状态，重复取消不发送报告，取消本地选择保留选区。
嵌入模式通过 NSView 接收事件，OSR 通过 Lynx `OnMotionEvent` 接收；逻辑坐标转换及触控板小数滚动累积位于 Rust macOS 适配器，高亮由现有 atlas 渲染。尚不支持拖出视口后的自动滚动、完整键盘协议和复杂文本 shaping。

滚动条是 `src/app/components/ui/scroll-bar.tsx` 渲染的 12px overlay，不改变 terminal viewport 或网格列数。
现有 UI-thread RAF 在滚动状态变化时派发 `scrollchange`，detail 为
`{ sessionId, offset, historyRows, visibleRows }`；位置以距底部的历史行数计，0 表示最新内容。
拖动通过 `invoke({ method: 'scrollTo', params: { sessionId, offset } })` 绝对定位；native 校验当前绑定 session，
将 offset 限制在历史范围内，且不向 PTY 写鼠标报告。`getScrollState` 可查询当前状态。
无历史时滑块隐藏，切换 session 后由新事件同步；旧 session 的事件会被 UI 忽略。
嵌入 NSView 模式用 CALayer mask 透出右侧覆盖区域，并在 hitTest 中让该区域交给 Lynx。
OSR 使用 Lynx 合成；网格数据始终留在 native。


## tmux control mode

`TerminalSessionCommand.tmux` 提供 session、初始 window 名、Shell 命令和工作目录。
`terminal_core/tmux.rs` 在 async parser 任务中解析 `-CC` 的 DCS 握手、命令结果和异步输出，
仅将当前 pane 的解码字节交给 Alacritty；终端查询由 tmux 自己响应。
输入通过 `send-keys -H` 传递原始字节，覆盖键盘、鼠标报告和粘贴。
连接时列出 session 的窗口并绑定 active window；没有窗口时保留启动命令创建的窗口。
关闭自动重命名，按该 terminal 的 native layout resize 当前窗口。
使用 `capture-pane` 恢复屏幕和历史、备用屏幕、光标及输入模式，再接续增量输出。
tmux 3.7+ 的 `pane_private_modes` 还能恢复 bracketed-paste 等 private modes。
resize 使用 `resize-window`，只修改对应窗口，并重新捕获服务端 reflow 后的内容。
窗口增删、重命名及 `%session-window-changed` 通知会刷新窗口列表；外部 tmux 客户端或
prefix 键切换窗口时，native client 重新绑定 active pane 并同步屏幕。
`selectTmuxWindow` / `createTmuxWindow` / `closeTmuxWindow` 操作窗口；最后一个窗口不允许
从 UI 关闭。`closeTerminalSession` 结束该 terminal 的 tmux session，
`detachTerminalSession` 和 Drop 仅断开控制连接。
协议单测和独立 socket 上的真实 tmux 回归位于 `src/tests/tmux.rs`，
真实 Lynx 渲染、窗口 tab 和输入验收位于 `../tests/e2e/tmux.test.ts`。

```text
host default tab / tmux tab button → preload resolveTmuxLaunch()
       ↓
terminal_core/pty.rs
  本地 tmux / SSH -tt → tmux -CC（每 terminal 独立 session）
       ↓
terminal_core/pty/tmux.rs
  TmuxPtyDelegate 转发输入 / 输出 / resize / close，并提供窗口快照与窗口操作
       ↓
terminal_core/tmux.rs
  窗口列表 / 命令结果 / 屏幕捕获 / pane 输出 / 输入和 resize
       ↓
terminal_core/grid.rs
  Alacritty 网格 → 现有 native renderer
```

## 构建与加载

`native-terminal` 使用 `CatusNativeTerminalElement` 注册。参考 Lynx CEF 的 macOS 适配：
默认将 NSView 加入 `lynx_view_get_native_window()` 返回的宿主，layout 更新其 frame。
NSView 的 CAMetalLayer 提供 drawable，Rust 用共享 wgpu device 导入纹理，GPU 完成后呈现。
网格使用左上角坐标；直接 Metal 目标按 wgpu Y-up NDC 转换，只有 Lynx OSR 做合成所需的 Y 轴补偿。
NSView frame 根据父 view 的 isFlipped 转换；自身 isFlipped 只决定内部坐标。
attach/detach/destroy 管理子 view、焦点、输入法和回调生命周期。
`use-osr` 可显式选择 OSR；没有宿主 NSView 或 NSWindow 的 windowless 环境自动使用 OSR。
创建时窗口尚未就绪的自动选择会在后续 attach/layout 重新判断，窗口出现后切换到嵌入模式。
OSR 才启用 `IsSurfaceEnabled()`。平台层按物理像素维护两个自建 IOSurface
（BGRA8、Metal 可导入），每帧轮换一个作为渲染目标，不再借用 Lynx 的 back buffer。
会话层检查锁忙和 idle revision，准备网格快照后调用公共
`render_to_surface(renderer, viewport, grid, &IOSurfaceRef, deadline)`。
该函数只负责目标校验、纹理导入及绘制，不读取 PTY 或 session。Rust 检查尺寸和
像素布局，使用全局共享 MTLDevice 创建 BGRA8Unorm texture，再导入 wgpu 绘制。
Rust 等待已提交 GPU 工作完成并检查 deadline，然后通过 C API `PresentSurface`
把自建 surface 交给 Lynx 合成；不再使用 `AcquireSurface` / `SwapBack`。
嵌入模式直接呈现 CAMetalLayer drawable，不经过 Lynx surface。
两种模式共享 NSTextInputClient：嵌入模式通过 NSView responder 接收事件；OSR 与 CEF 一样通过
`lynx_view_register_ime_handler` 和 NSTextInputContext 接收宿主事件。组合文本不会写入 PTY，
提交文本才调用 Rust write；两种模式的组合文本均由共享 atlas 绘制。
NSView、NSTextInputContext、CAMetalLayer 和输入会话绑定全部由 Rust 持有；
Rust 平台适配直接通过 SDK C API 请求焦点、注册 IME 并获取宿主句柄。
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
库的 Node-API 和组件注册由 Rust 提供，C++ 加载 constructor 调用 Rust 注册入口。

源码编译依赖 `@lynx-js/lynx-library-headers`，CMake 直接读取已安装的 SDK 头文件。

Rust 扩展与最小 C++ 加载/调度适配链接为同一个 `.node`，cxx 生成注册入口和 UI 调度头文件。
构建入口是 `build.mjs`，通过官方 `@napi-rs/cli` 调用 Cargo，输出
`.node` 和自动生成的 `index.d.ts`。`build.rs` 先用 `cxx-build` 生成
桥接代码，再调用 CMake 构建 `libcatus_native.a`；Rust `cdylib` 最后链接
该静态库、cxx 桥和系统 framework。CMake 不再构建动态库，Node-API 入口由
Rust napi-rs 提供。

macOS 链接参数 `-force_load` 保留 C++ 的 terminal extension 注册构造函数，
仅应用于 Cargo 的 `cdylib` 目标。`native-view` 是默认 feature；关闭它可构建
不含 Lynx view 的 Rust 扩展，供独立 Node 进程执行 N-API 测试。实际组合扩展
通过 AutoLink 加载，Rust 组件注册及 SDK 回调在 Lynxtron 中验证。

release profile 显式使用 `strip = "none"`，避免当前 Rust 1.95 / LLVM 在 macOS 27
上 strip 产生无效 LINKEDIT 的问题（[Rust issue #157750](https://github.com/rust-lang/rust/issues/157750)）。

详见项目根目录 [README](../README.md) 和
[官方 Desktop custom element 文档](https://lynxjs.org/next/guide/custom-native-component.html?platform=desktops)。

## SFTP

`connectSftp({ destination, port?, identityFile?, configFile? })` 返回 Promise。
Rust 使用 napi-rs async fn 在 Tokio 中执行；preload 保存连接表并暴露
`sftpConnect`、`sftpReaddir`、`sftpRealpath`、`sftpStat`、`sftpClose`，
Lynx BTS 直接调用这些 N-API 操作，不再经过 main 的 JSON bridge。
ContextBridge 不能返回带 native 方法闭包的连接对象（会抛 `TypeError: no access`），
因此连接 ID 和连接对象都留在 preload，数据以普通对象/字符串跨越边界。
连接提供 `readDir`、`metadata`、`readFile`、`writeFile`、`createDir`、`rename`、
`removeFile`、`removeDir` 和 `close`，均返回 Promise。
`writeFile` 在 JS 调用线程复制输入，再通过 `Env::spawn_future` 执行异步写入。
目录项包含 `name`、POSIX `path` 和 metadata；size 是可选 bigint，modified 是
可选 Unix 秒时间，fileType 是 file/directory/symlink/other。

调用链、运行时选择及限制见 [SFTP 异步实现](../docs/sftp-async.md)。

Lynxtron 0.0.31 在 TSFN 回调前进入所属 V8 context，修复了 preload/BTS 中
native Promise 与 callback 的 abort。普通 Node 测试、windowless SFTP E2E 和上传/
下载均通过；原生文件对话框和 scp 仍在 main，SFTP 数据路径直接调用 N-API。
