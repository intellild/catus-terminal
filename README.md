# Catus Terminal

使用 Lynx UI 实现的桌面终端界面，参考 Opera 的 workspace 与 tab 布局。
左侧 dock 放置可配置的终端类型，每个 workspace 保留自己的 terminal tabs；
内容区已接入 portable-pty、Alacritty 字符网格和 Rust wgpu atlas 渲染，
当前每个 tab 固定启动账户默认 shell（`-l -i`），工作目录为用户主目录。

状态管理使用 `effect@4.0.0` 和官方 `@effect/atom-react@4.0.0`。
构建与测试将 React hooks 映射到 ReactLynx。`components/AppLayout.tsx` 导出
布局组件，由 `App.tsx` 按 shadcn 风格通过 children 嵌套组合，在主线程
首帧渲染窗口骨架。tab、workspace 列表、内容、状态栏和设置各有独立的
`<background-only>` 边界及首帧 fallback。`state/SessionRegion.tsx` 为这些区域
提供同一个应用级 Effect registry；Effect 和配置加载只在 BTS 运行。
`runtime.ts` 在 Effect 加载前通过 preload 工厂安装 Node.js 原生
`TextEncoder` / `TextDecoder`，不需要第三方编码 polyfill。

布局组合结构如下，具体区域的 `<background-only>` 边界和业务内容由 `App.tsx`
放入对应组件，布局组件只负责容器与样式：

```tsx
<AppLayout>
  <AppLayoutHeader>{/* 原生窗口按钮留白、tab 栏 */}</AppLayoutHeader>
  <AppLayoutBody>
    <AppLayoutSidebar>{/* workspace 列表 */}</AppLayoutSidebar>
    <AppLayoutMain>
      <AppLayoutContent>{/* terminal 内容 */}</AppLayoutContent>
      <AppLayoutFooter>{/* 状态栏 */}</AppLayoutFooter>
    </AppLayoutMain>
  </AppLayoutBody>
  {/* 设置与配置初始化区域 */}
</AppLayout>
```

UI 样式统一使用 Tailwind CSS v3 和官方 `@lynx-js/tailwind-preset`，通过
`postcss.config.js` 接入 Rspeedy。`src/app/tailwind.css` 只包含 Tailwind 指令，
组件通过 `className` 声明样式；`tailwind.config.ts` 扫描 UI 源码，并用
`satisfies Config` 检查配置类型。运行时的 workspace 颜色和 tab 宽度通过
CSS 变量传给 `bg-[var(--workspace-color)]`、`w-[var(--tab-width)]` 等工具类。
选中状态使用完整的条件类名，避免动态拼接造成漏生成。
参见[官方 Tailwind 接入文档](https://lynxjs.org/rspeedy/styling)。

JS/TS 工具统一使用 Rstack CLI，配置位于 `rstack.config.ts`。
`pnpm format` 格式化所有 JS/TS 文件（含 JSX/TSX、MJS/CJS 和声明文件），
`pnpm format:check` 检查格式，`pnpm lint` 运行 JavaScript / TypeScript 推荐规则，
`pnpm lint:fix` 应用自动修复。构建产物、依赖和缓存不参与检查；native 构建
生成的 `index.d.ts` 会自动格式化。

项目由官方 `@lynx-js/create-lynxtron@0.0.28` 初始化。项目专属的 `@catus/native`
workspace 使用 Rust/napi-rs 导出原生能力，通过 AutoLink 加载 `<native-input>`
和 `<native-terminal>`。macOS 输入框使用 AppKit `NSTextField`；`src/app/NativeDemo.tsx` 保留输入框和 Rust 对象互操作演示。

macOS 窗口使用 `frame: false` / `titleBarStyle: 'hidden'`，系统标题栏由顶部
tab 栏替代，原生红黄绿按钮嵌入同一行。空白 tab 栏可拖动窗口，tab 与 `+`
使用 `-x-app-region: no-drag` 保持交互；只在留白区域声明 `drag`。tab 多时横向
滚动，新建或切换的 tab 自动滚入可见区域。参见[官方自定义窗口文档](https://lynxjs.org/next/lynxtron/learn/Custom-Window-Styles)。

```text
App.tsx / components/AppLayout.tsx
  主线程首帧：窗口骨架 + 各区域 fallback
       ↓
state/SessionRegion.tsx
  BTS 初始化共享 registry，bootstrap 只加载一次配置
       ↓
TabBar / WorkspaceList / TerminalContent / StatusBar / WorkspaceSettings
  各自接收状态及事件，更新对应区域
```

## Workspaces 与配置

- 启动应用时自动打开配置中的第一个 workspace，并创建第一个 tab。
- 首次点击未启动的 workspace 创建 tab；再次点击恢复它上次选中的 tab。
- 顶部 `+` 为当前 workspace 创建独立 tab；关闭最后一个 tab 后圆点消失。
- 圆点表示该 workspace 有打开的 tab，当前不表示真实进程存活。
- 左下角设置或 `Configure workspace` 可新增、编辑和移除终端类型。
- 配置编辑与启动参数保留在 UI 状态中；当前最小终端固定使用账户默认 shell，
  尚不执行 workspace 的 command/args/cwd。tab 状态不跨应用重启保存。

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

## 最小终端（macOS）

计算与渲染分别位于 `native/src/terminal_core/` 和 `native/src/renderer.rs`。
前者无需 Lynx、字体或 GPU：读线程接收 PTY 字节流，持续使用 Alacritty 的
VT parser 更新 `Term`；需要绘制时生成包含字符、颜色、属性、宽字符和光标的
owned `GridSnapshot`。`TerminalRenderer` 接收借用的 Metal FrameBuffer 对象和网格，
通过 crossfont/atlas、背景矩形及 instance buffer 绘制。

```text
TerminalView.tsx / useTerminalSession.ts（BTS）/ preload.ts
  新增 tab → createTerminalSession() → u32 ID → 账户默认 shell / portable-pty
       ↓
NativeTerminalView.tsx / native-terminal
  terminal-id → OnPropertiesChanged → 注册表 session → session renderer
       ↓
NativeTerminalMacOS.mm / OnLayoutChanged
  逻辑尺寸 × backing scale → 字体 advance、line height / leading → 行列 / PTY resize
       ↓
terminal_core/pty.rs（独立读线程）
  字节流 → terminal_core/grid.rs / Alacritty Processor + Term
       ↓
frame_clock.rs（Rust）/ native VSync（BTS）
  全局 broadcast → register_frame_listener / FrameListener
       ↓
NativeFrameHost.mm（UI 线程）
  消费 Rust listener 的帧信号 → native view 绘制 → 完成后 Rust 续订
       ↓
terminal_view.rs
  session renderer / viewport → 检查 revision → GridSnapshot
       ↓
NativeTerminalMacOS.mm
  借用 Lynx IOSurface → 使用 renderer 的 MTLDevice 创建 MTLTexture
       ↓
renderer.rs / glyph_renderer.rs
  接收 framebuffer + 网格 → crossfont atlas → wgpu 绘制
       ↓
GPU 完成 → Lynx SwapBack / MarkDirty
```

帧调度由 Rust 的 `frame_clock.rs` 管理，全局 `tokio::sync::broadcast` 分发 native VSync。
C++ 通过 `register_frame_listener()` 注册 Rust receiver，Lynx extension 提供 observer。
macOS 14+ 使用 SDK 的 custom VSync monitor 接口，把 `CADisplayLink` 注册到 UI main run loop；
当前 Lynxtron 的默认 monitor 在 BTS run loop 上无法触发回调。
RAF 在 BTS 注册和回调，native 内投递到 UI 线程绘制，GPU 完成后再续订；没有 JS 每帧桥接。
PTY 计算线程只更新网格；VSync 消费最新网格，空闲帧跳过 snapshot、纹理导入和 GPU 提交。
广播按窗口和 runtime generation 过滤，慢 receiver 合并 tick；零尺寸、解绑、detach、后台和销毁停止续订。
窗口尺寸或 backing scale 变化会重新计算行列、通知 PTY，并绘制新网格。

已实现普通键、Enter、退格、Tab、方向键、常用 Ctrl/Option 键，以及 ANSI
颜色、清屏、光标、宽字符/组合字符和 alternate screen。切换 tab 保留 shell；
TerminalView 和 NativeTerminalView 在内容区仅挂载一次，切换 tab 更新 terminal-id，保留 session 和 renderer。
useTerminalSession hook 维护 tab 到 session ID 的映射；关闭 tab 或内容组件卸载时调用
closeTerminalSession(id)，异步结束 shell。没有选中 tab 时传 ID 0 解绑并隐藏 view，Rust 帧监听停止；
loading 和配置错误不会卸载 native element。字体逐字符栅格化；尚未实现 IME、
剪贴板、选择、滚动历史 UI、复杂 shaping、鼠标协议、完整键盘协议和光标闪烁。

`native/src/tests/terminal_grid.rs` 验证分片 UTF-8/ANSI、回复、alternate screen；
`terminal_pty.rs` 验证真实 shell 往返、resize、退出；`renderer.rs` 验证真实网格
在 Metal 上绘制和回读、颜色与 atlas 复用。`test:napi` 同时验证默认 shell 导出。
数字 ID、props 切换、session renderer 保留及真实 layout resize 见
[session 验证报告](docs/terminal-session-verification.json)；该报告记录单一 view 重构之前的实现。
当前 UI 回归测试还验证切换、空 workspace、重建 tab 和错误重试过程中始终复用同一 native element。
实际保留元素引用的 ID 切换及 ID 0 解绑验证见
[持续挂载 view 验证报告](docs/terminal-persistent-view-verification.json)，记录的是 native VSync 重构之前的实现。
实际 PTY 输出见 [截图](docs/terminal-pty.jpeg) 和 [验证报告](docs/terminal-pty-verification.json)。
历史报告使用 DevTool 手动调用 renderFrame；Rust native VSync 的续订、订阅释放和旧回调失效由独立 Rust 测试覆盖。
当前 [native VSync 验证报告](docs/terminal-native-vsync-verification.json) 记录 Rust/C++ 注册链路和实测结果；
默认 shell 提示符及 PTY 写入后的中文输出均自动绘制，未手动调用 `renderFrame`。
通过 Lynx `view.takeScreenshot` 截取的本地截图 `docs/terminal-native-vsync.png` 包含 native surface；暂不提交截图，待 UI 稳定后再纳入版本管理。

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
pnpm run tsc         # tsc --build：检查根 tsconfig 引用的所有项目
pnpm run typecheck   # 同 pnpm run tsc
pnpm test            # ReactLynx 交互、Effect 状态与 JSON 配置读写测试
pnpm run test:node   # 截图比较器回归测试
pnpm run test:e2e    # 构建 + Rstest/Lynx DevTool E2E + PNG 基准对比
pnpm run test:e2e:update # 显式生成或更新截图基准，更新后检查 PNG
pnpm run test:rust   # Rust 生命周期/异常/多线程测试、fmt、clippy
pnpm run test:napi   # 实际 Node-API 扩展的构造、方法、句柄、异常测试
pnpm run pack        # 本机 macOS 应用打包，不发布
```

根目录 `tsconfig.json` 使用 `files: []` 和 `references` 组织三个 TypeScript 项目：

```text
tsconfig.json
  ├─ src/app/tsconfig.json            ReactLynx UI、测试、shared、native 声明
  ├─ src/main/desktop/tsconfig.json   Node 桌面端、测试、shared
  └─ tsconfig.tools.json             构建、测试、Tailwind、Rstack 配置
```

子项目启用 `composite` 和 `noEmit`；UI 单独配置 ReactLynx JSX。
`tsc --build` 检查全部引用项目，不输出 JS 或声明文件，只在忽略目录
`.tmp/typecheck/` 保存增量检查缓存。

运行时验收默认使用 Lynx 的 DOM/Input 和 `view.takeScreenshot`，由 Rstack 的
Rstest 组织测试。截图覆盖 native terminal surface；测试等待 VSync 实际呈现的像素，
不调用 `renderFrame`。E2E 当前需要 macOS 桌面和 Metal，运行前关闭已有的 Catus 应用。
窗口尺寸固定为 1120×760；当前 `darwin-arm64` 基准在 Retina 2× 下生成，需保持
同样的显示比例、系统字体和 emoji 版本，其他环境需显式建立并检查对应基准。

```text
tests/fixtures/fake-pty.mjs（JS 子进程，raw PTY，无系统 shell 配置）
  确定的 ANSI / 中文 / 组合字符 / emoji / 输入 / resize 输出
       ↓
portable-pty → Alacritty 网格 → Rust session renderer → native VSync / wgpu
       ↓
tests/support/lynx.ts
  官方 connector → Lynx DOM / Input 操作 → view.takeScreenshot
       ↓
tests/support/screenshots.ts
  PNG 解码 → pixelmatch（包含抗锯齿像素）→ 基准 / actual / diff
```

`tests/e2e/terminal.test.ts` 验证首个 workspace 启动、native key 输入、tab 独立 PTY
和保留内容、workspace 首次激活、关闭最后一个 tab 后解绑并移除 dock 圆点。
每个用例独立启动应用，在临时目录写配置，不修改用户配置。
基准在 `tests/e2e/__screenshots__/<platform>-<arch>/`；默认缺失基准或尺寸变化直接失败。
截图目录暂时加入 gitignore，本地基准保留；新 checkout 需先运行 `pnpm run test:e2e:update` 并检查生成的图片，再运行截图对比。
颜色匹配阈值为 0.1，但允许的差异像素数为零，字形缺失和空白 framebuffer 会失败。
失败产物、最后的 Lynx DOM/截图与日志保存在 `.tmp/e2e/artifacts/`。
当前自动化验收结果和基准尺寸/hash 见 [E2E 验证报告](docs/terminal-e2e-verification.json)。

Rust `native/src/tests/terminal_rendering.rs` 也使用同一 fake PTY，经过真实
`TerminalHandle::render_frame` 导入 Metal texture 并回读，验证 PTY 更新、空闲跳帧、
无效 framebuffer、重新绑定、不同 session 内容隔离、DPI resize 和关闭后的句柄行为。
调用 `createTerminalSession()` 仍启动账户默认 shell；可选 `{ program, args }` 供测试启动
fake PTY，桌面 preload 仅在设置 `CATUS_E2E_PTY` 时注入它。

## Native 演示交互（NativeDemo.tsx）

- 在原生输入框键入文字，`bindinput` 将 `event.detail.value` 回传到 ReactLynx。
- **Update property**：通过 React 状态更新 `value` 属性。
- **Call setValue**：使用 SelectorQuery 调用 C++ `setValue` 方法。
- **Focus**：调用原生方法，将焦点移到 `NSTextField`。
- **Read value**：调用 `getValue`，显示原生组件内部的值。
- **Verify shared Rust object**：创建 napi-rs `RustCounter`，作为 `invoke.params.rustObject`
  传给 native view，C++ 通过 cxx 修改同一 Rust 实例，再从原始 JS 对象读取结果。
## Native terminal / 共享 GPU

所有 `<native-terminal>` 通过同一个全局 `LazyLock<Result<GpuContext, String>>`
共享 wgpu device、queue、glyph pipeline、sampler、crossfont 字形缓存和 atlas。
每个 session 拥有 `TerminalRenderer`，保留独立 instance buffer 与网格 revision/viewport/generation。
销毁或重建 view 不清空缓存，相同字形无需重复栅格化和上传。

```text
renderer.rs / 全局 LazyLock
  首个 view 惰性初始化 Metal device + queue + Mutex<SharedGlyphs>
       ↓
font.rs / 共享多字号缓存
  字体 + 字符 + 物理字号 → atlas 字形区域
       ↓
glyph_renderer.rs
  共享 pipeline / sampler / 页 bind group
  每个 session 独立 instance buffer
       ↓
NativeTerminalMacOS.mm / frame.rs
  Lynx layout → Viewport；借用 IOSurface → 同一 MTLDevice 创建 MTLTexture
  FrameBuffer { metal_texture } + session viewport → TerminalRenderer::render_grid
       ↓
共享锁下编码上传、绘制、提交并等待 GPU → Lynx SwapBack / MarkDirty
```

同一 rasterizer 和 atlas 同时保留不同物理字号，窗口在不同 DPI 之间切换不会
清空其他 view 的字形。上传、提交和 GPU 完成保持同一共享锁，防止跨 view
观察到尚未提交的字形。失败回滚会递增 atlas generation，所有 view 下一帧重绘。

native terminal 只接收必需的数字 `terminal-id`（u32 session ID）和标准 Lynx 属性，公开方法只保留
`focus()`、`write({ text })`、`key({ key, control, alt })` 和 `renderFrame()`。
UI 不传字体、DPI 或渲染模式；framebuffer 尺寸与 backing scale 来自 Lynx layout。
三角形/atlas 原型模式、渲染统计以及 IOSurface 像素扫描接口已删除。
历史三角形和字体验证报告仍保留在 `docs/` 中。

wgpu 使用 Metal / WGSL；导入纹理使用共享 device 的实际 MTLDevice。
IOSurface 所有权归 Lynx，Rust 只 retain 导入的 MTLTexture。当前仍同步等待 GPU
（最长 10 秒），完成后才交换缓冲。共享 atlas 按需增长，尚无 LRU/内存预算。

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
glyph_renderer.rs / instance buffer（VERTEX | COPY_DST）
  位置、UV、颜色 → 按 atlas 页切换 bind group → instanced draw
       ↓
atlas.wgsl → Lynx IOSurface → SwapBack / MarkDirty
```

调用者传入自己的 command encoder，上传和采样可以安排在同一提交中。
完整高度的字形允许恰好占满一页；无效位图先拒绝，再分配空间。
`clear()` 复用已有 GPU texture，递增 generation，使旧字形句柄失效；
调用者同时清空字形缓存和待绘制批次。

终端字体按 14 logical px × backing scale 栅格化，使用 font metrics 和 glyph
偏移定位；Alacritty 网格确定字符列位置。跨 view 和 DPI 共用多个字号缓存，
切回先前字号不重复栅格化或上传。每个 session 的 instance buffer 独立，页 bind group 共享。

crossfont 使用平台默认抗锯齿。RGB coverage 转成均值单通道，彩色 emoji 保留
premultiplied RGBA；自定义 grayscale、复杂 shaping、ligature 尚未实现。

`pnpm run test:rust` 覆盖 CoreText、真实 Metal 上传/回读、多字号缓存、跨 view
共享和并发绘制、重建 view 保留缓存，以及 generation 失效恢复。
当前验证见 [共享 GPU 验证报告](docs/terminal-shared-gpu-verification.json) 和
[实际 Lynx 截图](docs/terminal-shared-gpu.jpeg)。
之前的字体/atlas 截图报告记录的是原型阶段的调试接口。

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
src/app/App.tsx                         组合静态 layout 和各区域的后台边界
src/app/components/AppLayout.tsx       主线程首帧布局骨架与窗口 tab 栏
src/app/components/                    tab、workspace、内容、状态栏、设置的展示组件
src/app/state/SessionRegion.tsx        各区域 BTS 边界共享同一个 Effect registry
src/app/state/useWorkspaceSession.ts   配置加载与 workspace/tab/设置操作
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
  src/terminal_core/                   portable-pty 传输与 Alacritty 网格计算
  src/terminal_session.rs              u32 注册表、session renderer 及生命周期
  src/terminal_view.rs                 cxx 桥、layout resize 与帧调度适配
  src/renderer.rs                     LazyLock 共享 GPU/atlas 与每个 session 的 renderer
  src/frame.rs                        FrameBuffer / Viewport 描述及 cxx 共享类型
  src/frame_clock.rs                  Rust native VSync、全局 broadcast 和订阅
  src/atlas.rs                         Alacritty atlas 分配与 wgpu staging buffer 上传
  src/font.rs                          crossfont 字体与字形缓存
  src/tests/                           counter、atlas、font 独立测试模块
  src/glyph_renderer.rs / atlas.wgsl        真实字体验证、instance buffer 与采样 shader
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
    NativeTerminalMacOS.mm             借用 IOSurface，创建 Metal texture，绘制 native-terminal
    NativeTerminalRegistration.mm      extension 生命周期和 native VSync observer
    NativeFrameHost.h/mm               native BTS/UI task queue 桥接
    NativeVSyncMonitorMacOS.h/mm        UI main run loop 上的 macOS display link
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
