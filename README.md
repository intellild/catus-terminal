# Catus Terminal

使用 Lynx UI 实现的桌面终端界面，参考 Opera 的 workspace 与 tab 布局。
左侧 dock 放置可配置的终端类型，每个 workspace 保留自己的 terminal tabs；
内容区已接入 portable-pty、Alacritty 字符网格和 Rust wgpu atlas 渲染。
每个 host（workspace）可选择默认 tab 类型（普通 shell、tmux 或 SFTP），顶部加号按钮组
也可直接创建另外两种 tab；tmux tab 会在 terminal 自己的标题栏中显示 session 窗口。
tmux 按钮上的角标显示目标机器的 session 数量，右键可选择 attach 或关闭 session；
左下角设置按钮提供 host（含 tmux 前缀）与显示（i18n）设置。

Web 开发预览使用官方 [Lynx for Web / Rspeedy web 环境](https://lynxjs.org/3.6/rspeedy/start/integrate-with-existing-apps)：

```sh
pnpm dev:web
# 仅构建 web bundle
pnpm build:web
```

打开终端输出的 `Preview` 地址。Web 模式复用 tab、workspace、设置弹窗和状态栏，
内容区保持空白，不需要编译 Rust 或启动 Lynxtron。配置使用内存中的默认 workspace，
支持编辑、新建和删除；刷新后恢复默认值，不读写桌面配置。Shell 候选不做系统检测，
可以选择默认 Shell 或自定义命令。Web 模式不启动 PTY 或 SSH/SFTP 连接。
构建产物位于 `dist/web/main.web.bundle`。

状态管理使用 `effect@4.0.0` 和官方 `@effect/atom-react@4.0.0`。
构建与测试将 React hooks 映射到 ReactLynx。`components/app-layout.tsx` 导出
布局组件，由 `app.tsx` 按 shadcn 风格通过 children 嵌套组合，在主线程
首帧渲染窗口骨架。tab、workspace 列表、内容和状态栏各有独立的
`<background-only>` 边界及首帧 fallback；设置 Dialog 与新建/编辑按钮一起组合在 workspace 区域内。
`app.tsx` 在两个线程中都使用同一层
`state/session-provider.tsx`，保持首屏到后台接管时的组件树结构一致。
Provider 精确导入 `@effect/atom-react/RegistryContext`，各区域继承应用级 registry；
主线程只创建空 registry，业务 atom、配置加载及 Node 编码器适配只在 BTS 运行。
`index.tsx` 在 BTS 入口启动 `state/session-runtime.ts`，不依赖 React 挂载。
配置加载、保存、workspace/tab/编辑操作由 `session-actions.ts` 的 action atoms 执行；
全局状态仅保存 workspace ID 顺序和当前 workspace ID；`workspaceAtom(id)` family
保存每个 workspace 的配置、`tabIds` 和 `activeTabId`，不通过筛选全局 tabs 推导归属。
`tabAtom(id)` family 保存 tab 数据，TabItem 只接收 ID 并独立订阅 `tabViewAtom(id)`。
各区域订阅 `session-views.ts` 中对应的视图 atom，并将 UI 事件发送给 action atom。
Registry 的 reset/dispose 管理异步任务和终端资源，UI 卸载不会停止它们。
`runtime.ts` 在 Effect 加载前通过 preload 工厂安装 Node.js 原生
`TextEncoder` / `TextDecoder`，不需要第三方编码 polyfill。

布局组合结构如下，具体区域的 `<background-only>` 边界和业务内容由 `app.tsx`
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
</AppLayout>
```

UI 样式统一使用 Tailwind CSS v3 和官方 `@lynx-js/tailwind-preset`，通过
`postcss.config.js` 接入 Rspeedy。`src/app/tailwind.css` 只包含 Tailwind 指令，
组件通过 `className` 声明样式；`tailwind.config.ts` 扫描 UI 源码，并用
`satisfies Config` 检查配置类型。运行时的 workspace 颜色和 tab 宽度通过
CSS 变量传给 `bg-[var(--workspace-color)]`、`w-[var(--tab-width)]` 等工具类。
选中状态使用完整的条件类名，避免动态拼接造成漏生成。
参见[官方 Tailwind 接入文档](https://lynxjs.org/rspeedy/styling)。

`components/ui/` 中渲染元素的组件都支持 `className`，使用 `cn` 合并默认样式和自定义样式。
纯上下文组件（如 Form、FormField、Select、Popover）由可视子组件承接样式。

按钮统一使用 `components/ui/button.tsx`，提供 shadcn 风格的 `variant` / `size`，
通过 `cva` 和 `cn` 合并 Tailwind 样式。Hover 使用 CSS `:hover`（Tailwind `hover:`）；`disabled` 同时阻止点击和 hover。普通文字 children 自动包进 `<text>`，
原生 ref 会转发到 `<view>`，供 Select / Popover 定位。

```tsx
<Button variant="ghost" size="icon" bindtap={onAdd}>+</Button>
<Button disabled={saving} bindtap={onSave}>{t('workspace.save')}</Button>
```

参考 [shadcn Button Group](https://ui.shadcn.com/docs/components/button-group)，
`ButtonGroup` 用于组合一组执行动作的按钮，支持 `horizontal` / `vertical`
方向和 `ButtonGroupSeparator`、`ButtonGroupText`。顶部 tab 栏的 `+` 区域使用
`ButtonGroup`：加号创建 workspace 的默认 tab，旁边的图标按钮分别创建其余 tab 类型。

```tsx
<ButtonGroup>
  <Button size="icon-sm" bindtap={() => onAdd(defaultKind)}>
    <Icon name="plus" />
  </Button>
  <Button size="icon-sm" bindtap={() => onAdd('tmux')}>
    <Icon name="panels-top-left" />
  </Button>
</ButtonGroup>
```

图标统一使用 `components/ui/icon.tsx`，数据来自 `lucide-static` 的 SVG 字符串
（ISC 许可），通过 Lynx 原生 `<svg content>` 渲染，不依赖 DOM SVG 或图标字体。
`name` 取自 `components/ui/icons.ts` 的按需注册表；默认 `16px`、主文字色
`#e2e8ed`、`strokeWidth` 2，可按需覆盖。新增图标时只导入用到的 Lucide 图标，
避免整个图标集进入 bundle。

```tsx
<Icon name="plus" size={16} color="#c1c7d0" />
<Icon name="x" size={13} strokeWidth={2.5} />
```

文件列表统一使用 `components/file-explorer/`。`FileExplorer` 负责虚拟列表、
隐藏文件过滤、加载/错误/空状态和行级 automation ID；`FileItem` 负责单行类型图标、
文件名与类型标签。组件不感知 SFTP：行首操作通过 `renderLeadingAction` 注入，
跨目录稳定的虚拟列表 key 通过 `itemKey` 交给调用方。

```tsx
<FileExplorer
  automationId="sftp"
  entries={listing.entries}
  onOpen={open}
  itemKey={(entry) => joinPath(listing.path, entry.name)}
  renderLeadingAction={(entry, index) =>
    entry.directory ? null : <DownloadButton entry={entry} index={index} />
  }
/>
```

界面翻译使用 i18next，资源独立放在 `locales/`，目前只提供 `en.toml`。
TOML 按界面区域分组，变量使用 `{{name}}`，数量使用 `_one` / `_other` 复数键。
Rspeedy 和 Rstest 在构建时将 TOML 解析成对象，解析器不会进入应用运行时。
`src/app/i18n.ts` 同步初始化英文资源，主线程首屏与 BTS 使用同一份文案，
无需网络加载或浏览器语言检测。用户自定义名称、命令和底层错误保留原文。
Lynx 缺少 Intl，初始化前使用 FormatJS 条件 polyfill 补齐 PluralRules 及其依赖，
只加载英文复数数据；Node 的原生 Intl 实现保持使用。
按[官方文档](https://lynxjs.org/guide/inclusion/internationalization)使用 i18next v24 + Intl polyfill。
组件通过 `useTranslation()` 获取 `t`，订阅 `languageChanged` 并在卸载时取消订阅；
`i18n.t()` 本身不触发 React 更新，仅在 action atom 等非 React 逻辑里直接调用。
React 绑定通过现有 alias 使用 ReactLynx，关闭 Suspense；同步资源保证主线程首屏可渲染。

JS/TS 工具统一使用 Rstack CLI，配置位于 `rstack.config.ts`。
`pnpm format:cpp` 使用 clang-format 格式化仓库内 C/C++/Objective-C 源码和头文件，
`pnpm format:cpp:check` 只检查格式。配置在 `.clang-format`；可用 `CLANG_FORMAT` 指定程序路径，
macOS 默认还会尝试 Xcode 工具链。

`pnpm format` 格式化所有 JS/TS 文件（含 JSX/TSX、MJS/CJS 和声明文件），
`pnpm format:check` 检查格式，`pnpm lint` 运行 JavaScript / TypeScript 推荐规则，
`pnpm lint:fix` 应用自动修复。构建产物、依赖和缓存不参与检查；native 构建
生成的 `index.d.ts` 会自动格式化。

文件和目录统一使用 kebab-case（如 `state/session-actions.ts`、
`components/tab-bar/`），`pnpm lint` 通过 `unicorn/filename-case` 检查；
`__tests__` 目录名例外，其中的测试文件仍会检查。

项目由官方 `@lynx-js/create-lynxtron@0.0.28` 初始化。项目专属的 `@catus/native`
workspace 使用 Rust/napi-rs 导出终端能力，通过 AutoLink 加载 `<native-terminal>`。
workspace 设置表单通过项目 UI 组件封装 Lynx 原生 `<input>`。
表单使用 React Hook Form，`FormField` 通过 `useController` 绑定 Lynx 受控组件。
`src/shared/workspaces.ts` 集中定义配置与表单 Schema，表单通过
`Schema.toStandardSchemaV1` 和 `standardSchemaResolver` 显示字段错误。
Schema 同时将 args JSON 和表单字段转换为启动参数类型，并按 `defaultTab` 校验
SFTP 只能用于 SSH workspace；Effect registry 保留草稿、Shell 检测及配置保存，
并在保存时用同一 Schema 再次校验。

`src/app/components/ui/` 放置 shadcn 风格的组合组件：`Input` 封装原生
`<input>`，通过后台线程 `bindinput` 转发表单 `onChange`，用 `setValue`
同步外部受控值；输入值不重复写回原生控件。业务组件只依赖项目 UI 组件。
参考 [shadcn Input Group](https://ui.shadcn.com/docs/components/input-group)，
用 `InputGroup` 组合外框、`InputBeforeAddon`、`Input` 和 `InputAfterAddon`。
外框由原生输入框的后台 `bindfocus` / `bindblur` 更新边框高亮；addon 可以放文字、图标或按钮。

```tsx
<InputGroup>
  <InputBeforeAddon>https://</InputBeforeAddon>
  <Input value={value} onChange={setValue} />
  <InputAfterAddon>.com</InputAfterAddon>
</InputGroup>
```

`Select` 和 `ContextMenu` 共用官方 `@lynx-js/lynx-ui-popover`。
`Dialog` 参考 [shadcn Dialog](https://ui.shadcn.com/docs/components/dialog)，提供
`DialogTrigger`、`DialogContent`、`DialogHeader`、`DialogTitle`、`DialogDescription`、
`DialogFooter` 和 `DialogClose` 组合组件，支持 `open` / `defaultOpen` / `onOpenChange`。
`DialogContent` 自动把遮罩和内容放进共享的 `CoverView`，点击遮罩或关闭按钮关闭；
`overlayProps.closeOnPress` 和 `showCloseButton` 可关闭对应的默认行为。
`SettingsDialog` 只挂载一次，连接设置入口、主机列表、删除确认、Shell 检测和保存命令；
`WorkspaceSettings` 只渲染表单，不依赖 Dialog 或开关/关闭逻辑。
主机类型在创建时选择，编辑已有主机时只读。
Dialog 内的 Select / Popover 保持更高的浮层层级。
目前封装显示状态、布局和点击交互，不提供 Escape / Tab 焦点陷阱。
Popover 的 Anchor / Positioner 负责定位，点击外部区域关闭浮层。
在 cover 层内部，Positioner 将 anchor-local 偏移转换为视口坐标并使用 fixed 定位，
避免固定遮罩盖住仍在 Dialog 子树内的菜单；Dialog 外保持原来的相对定位。
`lynx.config.ts` 保留 Lynx UI 的主线程模板注册，并将其 `delayFrames` 替换为
`ui/frames.ts`：由应用现有 MTS RAF 推进 Presence，绕过当前 Lynxtron BTS RAF
回调不推进的问题。此适配不改变终端的帧调度，不增加 RAF 循环。
Shell 候选项和菜单操作由业务层传入，通用组件不读取 workspace 状态。

需要组合多个样式来源时，通过 `src/app/lib/utils.ts` 的 `cn(...inputs)` 合并 className：
`clsx` 处理条件和数组，`tailwind-merge` 消除冲突，后传入的样式覆盖默认样式。
Input、Select 和菜单项的状态样式通过 `class-variance-authority`（cva）定义 variants，
再由 `cn(variants(...), className)` 合并调用方样式。固定样式、单个条件表达式和
单独的 variants 结果直接作为 className，不额外包装 `cn`。

```tsx
<Select value={value} onValueChange={setValue}>
  <SelectTrigger><SelectValue>{label}</SelectValue></SelectTrigger>
  <SelectContent>
    <SelectItem value="$SHELL">Default shell</SelectItem>
    <SelectItem value="custom">Custom command</SelectItem>
  </SelectContent>
</Select>
```

macOS 窗口使用 `frame: false` / `titleBarStyle: 'hidden'`，系统标题栏由顶部
tab 栏替代，原生红黄绿按钮嵌入同一行。空白 tab 栏可拖动窗口，tab 与 `+`
按钮组使用 `-x-app-region: no-drag` 保持交互；只在留白区域声明 `drag`。tab 多时横向
滚动，新建或切换的 tab 自动滚入可见区域。参见[官方自定义窗口文档](https://lynxjs.org/next/lynxtron/learn/Custom-Window-Styles)。

```text
app.tsx / components/app-layout.tsx
  主线程首帧：窗口骨架 + 各区域 fallback
       ↓
index.tsx → state/session-runtime.ts
  BTS 启动独立 registry，每个 registry 只初始化一次
       ↓
app.tsx → state/session-provider.tsx
  两个线程使用一致的 Provider；主线程 registry 为空，BTS 启动业务 atom
       ↓
state/session-actions.ts
  action atom 加载/保存配置，执行 workspace/tab/编辑操作
       ↓
state/session-views.ts → components/session-views.tsx
  各区域订阅自己的视图 atom，发送操作指令
       ↓
TabBar / WorkspaceList / SessionContent / StatusBar / WorkspaceSettings
  各自接收状态及事件，更新对应区域
```

## Workspaces 与配置

- 启动应用时自动打开配置中的第一个 workspace，并创建第一个 tab。
- 首次点击未启动的 workspace 创建 tab；再次点击恢复它上次选中的 tab。
- 顶部 `+` 按钮组为当前 workspace 创建 tab：加号创建默认 tab，其余图标按钮分别
  创建 shell、tmux 或 SFTP tab；SFTP 只在 SSH workspace 显示。关闭最后一个 tab 后圆点消失。
- 圆点表示该 workspace 有打开的 tab，当前不表示真实进程存活。
- 左下角齿轮打开设置：一级菜单分为主机和显示。主机页用纵向列表管理 workspace，
  悬停行显示删除按钮，删除前用 popover 二次确认；右侧内容区复用现有表单并编辑 tmux 前缀。
  配置至少保留一个 workspace，删除会释放该 workspace 的会话。
- workspace 不再有右键菜单：编辑和删除都在设置的主机列表里完成。显示页放置 i18n
  （界面语言）选项，目前只有 English。
- 配置分为本地和 SSH，远程显示 Host；两者都可以选择检测到的 Shell 或输入自定义命令。
  主机类型在创建后固定，编辑器不会允许再切换。
- Shell 候选项由 Effect atom 异步管理。本地读取 `/etc/shells` 并检查可执行权限，
  远程通过 SSH 检测；Host 输入防抖 400ms，SSH 检测超时 8 秒，失败可重试。
- Workspace 设置使用 **Default tab**（JSON 字段 `defaultTab`）选择加号创建的 tab 类型：
  `shell`、`tmux` 或 `sftp`，默认 `shell`。SFTP 只能用于 SSH workspace。
  tmux 不再是 workspace 开关，而是每个 tab 独立的启动类型。
- 配置修改用于新建 tab，已运行的 tab 保留启动参数；tab 状态不跨应用重启保存。
- tmux tab 使用 tmux control mode，本地使用本机 tmux，SSH workspace 使用远端 tmux，
  目标机器需安装 tmux 3.2 或更新版本。catus 使用独立的 `-L catus` socket，不干扰
  用户自己的 tmux；每个 host 可配置 session 前缀（JSON `tmuxPrefix`，默认 `catus-`），
  Shell、自定义命令和工作目录仍由 workspace 配置决定。
- 打开 tmux tab 时优先 attach 目标机器最近使用的 session；只有机器上没有任何 session
  时才新建 `<prefix>0`。`-CC attach-session` 之后 native 通过
  `display-message -p '#{session_name}'` 确认实际 session 名称，再列出并绑定窗口，
  因此没有本地 session 缓存时也能 attach tmux 的默认目标。
- 加号按钮上的角标显示当前 host 的 session 数量；registry 每 10 秒轮询，
  workspace/tab 变化和菜单打开时立即刷新。右键打开 session 菜单：点击行 attach 对应
  session，行悬停显示关闭按钮，菜单底部新建下一个空闲的 `<prefix>N`。
- 关闭 terminal tab 只 detach，tmux session 继续运行；结束 session 使用菜单中的关闭按钮。
  窗口显示在 terminal 标题栏：点击切换窗口，`+` 新建窗口，窗口多于一个时可关闭。
  窗口名称和激活状态由 native session 提供，`%window-add`、`%window-renamed`、
  `%window-close` 等 control-mode 通知保持同步。退出应用同样只断开控制连接。
  例如可以在应用外通过 `tmux -L catus attach -t catus-0` 连接对应 session。
  旧配置的 `tmux` / `tmuxSessionName` 字段会在读取时迁移为 `defaultTab: "tmux"` 并被移除。

默认配置模板为 `config/workspaces.json`，只内置用户默认 Shell 的本地配置；workspace 类型分为本地和 SSH。
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
      "cwd": "~",
      "defaultTab": "shell"
    }
  ]
}
```

`$SHELL` 使用用户账户默认 shell，`~` / `~/...` 展开为用户主目录。
`shell` 保存 `$SHELL`、检测到的绝对路径或 `custom`。选定的 Shell 以 `-l` 启动；
`custom` 使用 `command` 字段，本地通过默认 Shell 执行，远程作为 SSH 命令执行。
SSH 的 `remoteCommand` 可在选定 Shell 前运行额外命令。旧配置的 executable/args 仍然兼容。
编辑 JSON 后重启应用加载。真实界面截图见 [Shell](docs/workspaces-shell.jpeg)、
[多个 tabs](docs/workspaces-tabs.jpeg)，实测结果见 [验证报告](docs/workspaces-verification.json)。

## 最小终端（macOS）

计算与渲染分别位于 `native/src/terminal_core/` 和 `native/src/renderer.rs`。
前者无需 Lynx、字体或 GPU：portable-pty 读线程把字节经 channel 交给 async parser，
持续使用 Alacritty 的 VT parser 更新 `Term`；需要绘制时生成包含字符、颜色、属性、宽字符和光标的
owned `GridSnapshot`。`TerminalRenderer` 接收网格和平台提供的 wgpu texture，
通过 crossfont/atlas、背景矩形及 instance buffer 绘制。macOS 的 IOSurface / Metal
导入、字体策略和 UI 桥接集中在 `native/src/platform/macos/`。

```text
state/session.ts / terminal-sessions.ts / preload.ts（BTS）
  新增 tab → JS 分配 number ID → createTerminalSession(id, profile, env, kind)
       → 普通 shell / tmux control mode / SFTP
       ↓
native-terminal-view.tsx / native-terminal
  terminal-id → OnPropertiesChanged → 注册表 session → session renderer
       ↓
native_terminal_view.rs / on_layout_changed
  逻辑尺寸 × backing scale → 字体 advance、line height / leading → 行列 / PTY resize
       ↓
terminal_core/pty.rs（读线程 + async parser）
  字节流 → terminal_core/grid.rs / Alacritty Processor + Term
       ↓
frame-driver.ts（MTS RAF）→ preload（BTS）→ frame_driver.rs
  dispatchAnimationFrame() → UI → Rust 全局回调注册对象
       ↓
native_terminal_view.rs → platform/macos/native_view.rs（同一 UI 线程）
  按缓存 layout 获取 Lynx IOSurface → render_surface(iosurface, deadline)
       ↓
terminal_view.rs
  检查锁忙、过期和 revision → session viewport / GridSnapshot
       ↓
platform/macos/surface.rs
  校验 IOSurface → 共享 MTLDevice 创建纹理 → 返回 wgpu::Texture
       ↓
renderer.rs / text/glyph_renderer.rs
  编码 atlas 上传与绘制 → 提交并等待 GPU
       ↓
GPU 完成 → Lynx SwapBack / MarkDirty
```

当前使用独立的 JS RAF 适配器绕过 native observer 的 NSRunLoop/libuv 问题：
`src/app/frame-driver.ts` 由 App 挂载时启动一个 MTS RAF 循环，卸载时取消；
跨线程调用函数在外层 MTS 创建，嵌套 RAF 回调只调用该函数。
preload 暴露 Rust 的 `dispatchAnimationFrame()`，由 `native/src/frame_driver.rs`
使用 native monotonic clock 创建约 16.7ms 的预算并转发到 UI。
`frame_callbacks.rs` 中的全局 `LazyLock` 保存弱引用的窗口注册对象，在 UI
遍历仍有效的回调；关闭窗口或 view 不会被全局对象保活。
不保存帧队列；延迟、过期和资源忙的帧丢弃，PTY 只更新网格。
跨线程调用或宿主分发失败会被捕获，RAF 链保持并继续重试。自动帧只在窗口可见且
未被遮挡时呈现；启动或显示器唤醒阶段窗口尚未合成时网格保持 dirty，窗口可见后的
下一帧重绘。GPU 和 session renderer 初始化失败不会缓存到进程生命周期，
而是按帧重试（1 秒退避）。
后续替换帧信号来源时可直接调用 `dispatch_frame_callbacks(deadline)`，
无需修改 terminal session、IOSurface 导入或 atlas 渲染。
项目自建的 CADisplayLink、timer 和单次 native RAF 探针已移除。
原 native RAF 调查记录见 [验证文档](docs/terminal-native-raf-verification.md)。

已实现普通键、Enter、退格、Tab、方向键、常用 Ctrl/Option 键，以及 ANSI
颜色、清屏、光标、宽字符/组合字符和 alternate screen。切换 tab 保留 shell。
SessionContent 按 active tab 组装面板：TmuxPanel 作为稳定的 terminal 会话外壳，
内部嵌入 TerminalPanel；tmux tab 时在 header 显示窗口 tabs，shell tab 复用同一外壳。
SftpPanel 和 PanelPlaceholder 分别承载 SFTP、loading/空 workspace/配置错误。面板基于 `ui/panel.tsx` 的 Panel、PanelHeader、PanelTitle、
PanelActions、PanelContent 和 PanelFooter 组合，布局与 shadcn 的分段结构一致。
TerminalView 和 NativeTerminalView 在空/错误/SFTP 状态通过隐藏的 TerminalPanel 保持挂载，
切换回 terminal 时复用同一个 native element 并更新 terminal-id；session 和 renderer 不随面板重建。
tab ID 就是 session ID；全局 `sessionRegistry` 中的 `sessionAtom` 写入时统一同步 Rust session：
创建 tab 时创建 session，关闭 tab 或删除 workspace 时调用 `closeTerminalSession(id)`。
tmux tab 的标题栏由 `components/terminal/tmux-tab-bar.tsx` 组合。窗口快照保存在
`state/tmux.ts` 的 `tmuxSessionAtom` family 中（按 session ID，`keepAlive` 全局存活）；
`tmuxSyncAtom` 在应用级 registry 中轮询 `getTmuxSessionInfo(id)`，与 Rust `TmuxClient`
按 ID 同步，registry reset/dispose 会清理轮询。组件只订阅快照，并通过 `tmuxActionsAtom`
分发 `selectTmuxWindow` / `createTmuxWindow` / `closeTmuxWindow`；挂载/卸载不会启动或停止同步。
`TmuxClient` 在 attach 后列出 session 窗口、绑定当前窗口的 active pane；切换窗口时
清空旧 pane 的待处理输入并重新同步屏幕。窗口增删、重命名和 session 切换通知会刷新
缓存，因此 tab 名称和激活状态不需要额外的 native 回调通道。原生测试覆盖窗口列表解析、
切换后重新绑定 pane，以及真实 tmux 的创建、选择和关闭窗口流程。
React 组件只读取 atom 派生的 ID 和错误，卸载或重新挂载不会创建或关闭 session；registry 销毁时释放剩余 session。没有选中 tab 时传 ID 0 解绑并隐藏 view，Rust 帧监听停止；
loading 和配置错误不会卸载 native element。字体逐字符栅格化；尚未实现 IME、
剪贴板、选择、滚动历史 UI、复杂 shaping、鼠标协议、完整键盘协议和光标闪烁。

`src/app/__tests__/terminal-sessions.test.ts` 不挂载 React，验证 atom 分配数字 ID、关闭后台 tab、
删除 workspace、创建失败和 registry 释放；UI 测试验证卸载/重新挂载保留 session。

`native/src/tests/terminal_grid.rs` 验证分片 UTF-8/ANSI、回复、alternate screen；
`terminal_pty.rs` 验证真实 shell 往返、resize、退出；`renderer.rs` 验证真实网格
在 Metal 上绘制和回读、颜色与 atlas 复用。`test:napi` 同时验证默认 shell 导出。
数字 ID、props 切换、session renderer 保留及真实 layout resize 见
[session 验证报告](docs/terminal-session-verification.json)；该报告记录单一 view 重构之前的实现。
当前 UI 回归测试还验证切换、空 workspace、重建 tab 和错误重试过程中始终复用同一 native element。
实际保留元素引用的 ID 切换及 ID 0 解绑验证见
[持续挂载 view 验证报告](docs/terminal-persistent-view-verification.json)，记录的是 native VSync 重构之前的实现。
实际 PTY 输出见 [截图](docs/terminal-pty.jpeg) 和 [验证报告](docs/terminal-pty-verification.json)。
独立 Rust 测试覆盖同线程直接回调、过期帧丢弃、注销、后台/销毁及 session/atlas 锁忙后的恢复。
历史 [native VSync 验证报告](docs/terminal-native-vsync-verification.json) 记录此前广播/队列实现的实测结果；
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
pnpm run test:e2e    # 构建 + windowless Rstest/Lynx DevTool E2E + PNG 基准对比
pnpm run test:e2e:windowed # 用原生窗口运行同一套 E2E，供排查窗口行为
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
不调用 `renderFrame`。E2E 默认设置 `LynxWindow({ windowless: true, deviceScaleFactor: 2 })`，
不创建原生父窗口、不抢占焦点；启动时检查原生窗口句柄全为 0，防止运行时忽略该选项。
`pnpm run test:e2e:windowed` 可显式切回原生窗口；两种模式使用相同测试和截图基准。
当前需要 macOS Metal 和活跃显示器；显示器睡眠时 JS RAF 不回调，截图 E2E 会超时。
运行前关闭已有的 Catus 应用。viewport 固定为 1120×760、windowless 比例固定为 2×；
`darwin-arm64` 基准还依赖系统字体和 emoji 版本，其他环境需显式建立并检查对应基准。

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

Rust `native/src/tests/macos/terminal_rendering.rs` 也使用同一 fake PTY，经过真实
`TerminalHandle::render_surface` 导入真实 IOSurface 并回读，验证 PTY 更新、空闲跳帧、
无效 framebuffer、尺寸/像素布局不匹配、重新绑定、不同 session 内容隔离、DPI resize 和关闭后的句柄行为。
调用 `createTerminalSession(id, command?)` 启动账户默认 shell；`command` 的 program/args/cwd
和可选 `tmux` 描述启动参数。桌面 preload 根据 tab `kind` 选择普通 shell 或 tmux launch，
并传入菜单选择的 tmux session 目标；E2E 通过 `CATUS_E2E_PTY` 注入 fake PTY。
JS 分配 `1..0xffffffff` 的数字 tab ID，Rust 不分配 ID；创建成功返回 void，重复 ID 和保留值 0 被拒绝。
关闭 tab 的 E2E 测试直接查询 Rust 注册表，确认对应 ID 已删除且其他 session 仍可查询。

## Native terminal / 共享 GPU

所有 `<native-terminal>` 通过同一个全局 `LazyLock<anyhow::Result<GpuContext>>`
共享 wgpu device、queue、glyph pipeline、sampler、crossfont 字形缓存和 atlas。
每个 session 拥有 `TerminalRenderer`，保留独立 instance buffer 与网格 revision/viewport/generation。
销毁或重建 view 不清空缓存，相同字形无需重复栅格化和上传。

```text
renderer.rs / 全局 LazyLock
  首个 view 惰性初始化 Metal device + queue + Mutex<SharedGlyphs>
       ↓
text/font.rs / 共享多字号缓存
  字体 + 字符 + 物理字号 → atlas 字形区域
       ↓
text/glyph_renderer.rs
  共享 pipeline / sampler / 页 bind group
  每个 session 独立 instance buffer
       ↓
native_terminal_view.rs / terminal_view.rs
  Lynx C API → Rust layout / session；平台适配借用 IOSurface
       ↓
platform/macos/terminal.rs / surface.rs
  IOSurface + session viewport → 校验并导入 wgpu::Texture
       ↓
renderer.rs
  TerminalRenderer::render_grid → 平台无关的 wgpu 绘制
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

`native/src/text/atlas.rs` 从本地 Alacritty `d692748d` 的
`alacritty/src/renderer/text/atlas.rs` 迁移逐行分配、分页和清空复用逻辑。
使用 1024×1024 R8Unorm coverage 页和 RGBA8Unorm premultiplied 彩色字形页，
用 wgpu buffer 替换 GL 上传路径。来源说明和 MIT 文本保存在
`native/licenses/ALACRITTY-MIT.txt`，并随 native 包分发。

```text
text/font.rs / crossfont 0.9.0（macOS CoreText）
  Menlo 普通体/粗体 → 系统 fallback → GlyphKey 字形缓存
       ↓
RasterizedGlyph / Gray 或 premultiplied RGBA 位图
       ↓
AtlasSet::insert（native/src/text/atlas.rs）
  校验数据 → 分配位置 → 行数据补齐到 256 字节
       ↓
wgpu staging buffer / COPY_SRC
  encoder.copy_buffer_to_texture → atlas texture / COPY_DST | TEXTURE_BINDING
       ↓
Glyph handle
  page + generation + UV + 尺寸/偏移 + multicolor
       ↓
text/glyph_renderer.rs / instance buffer（VERTEX | COPY_DST）
  位置、UV、颜色 → 按 atlas 页切换 bind group → instanced draw
       ↓
text/atlas.wgsl → Lynx IOSurface → SwapBack / MarkDirty
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

## Native 构建与链接

napi-rs 驱动 Cargo 构建 Rust `cdylib`，将 terminal C++ 静态库链接进同一个
`catus-native.node`。Rust 通过 bindgen C API 接收 Lynx View 回调；cxx 仅桥接加载入口和 UI 调度。

```text
pnpm run build:native → native/build.mjs
  napi-rs CLI 调用 Cargo，生成 TypeScript 声明和 .node 文件
       ↓
native/build.rs
  napi_build::setup() 配置 Node-API 动态链接
  cxx_build 生成桥接头文件和 C++ 桥接静态库
       ↓
native/cxx/CMakeLists.txt
  编译加载 constructor → libcatus_native.a
       ↓
Cargo / Rust 链接器
  Rust cdylib + cxx 桥 + C++ 静态库 + AppKit 等系统 framework
  -force_load 保留 C++ 元素注册构造函数
       ↓
napi-rs CLI
  输出 dist/darwin/<arch>/catus-native.node，生成 native/index.d.ts
```

最终 Node-API 入口由 Rust 的 napi-rs 提供。
CMake 只负责 C++ 静态库，不负责最终 `.node` 链接；加载 constructor 调用 Rust 仍通过 cxx。
`-force_load` 只用于 `cdylib`，Rust 测试可独立运行。`test:napi` 使用
`--no-default-features` 构建不含 Lynx view 的扩展，在 Node 中检查 napi-rs 导出；
组合扩展的组件注册和跨语言调用则在实际 Lynxtron 应用中验证。

Cargo 输出位于 `/tmp/catus-native-<源码路径哈希>`，由
`scripts/rust-target.mjs` 统一计算；CMake 输出在 Cargo 的 `OUT_DIR/cxx` 中。
可用 `CATUS_RUST_TARGET_DIR` 环境变量覆盖为
项目外的绝对路径。cxx 在输出目录中创建指回源码的符号链接，因此 Rust 检查
通过 `pnpm run test:rust` 使用同一外部输出目录，避免 JS 构建/监听扫描目录循环。
修改 Rust/C++ 后重启 `pnpm run dev`。

## 代码位置

```text
config/workspaces.json                             内置终端类型与默认 shell 配置
src/shared/workspaces.ts                           Effect Schema 校验、启动参数解析与 host 类型
src/app/app.tsx                                    组合静态 layout 和各区域的后台边界
src/app/components/app-layout.tsx                  主线程首帧布局骨架与窗口 tab 栏
src/app/components/                                tab、workspace、内容、状态栏、设置的展示组件
src/app/state/session-provider.tsx                 两个线程共有的唯一 Effect registry Provider
src/app/components/session-views.tsx               直接渲染的后台区域组件，订阅 atom 并绑定事件
src/app/state/session-runtime.ts                   BTS 入口启动的独立 atom runtime
src/app/state/session-actions.ts                   配置加载、保存与 workspace/tab/设置操作
src/app/state/session-views.ts                     各 UI 区域的派生视图 atom
src/app/runtime.ts                                 preload 的 Node 编码器构造函数适配
src/app/state/session.ts                           Effect atoms、tab 生命周期和配置编辑状态
src/app/state/tmux.ts                              tmux 窗口快照、session 列表视图和 registry 轮询
src/app/state/tmux-sessions.ts                     目标机器 session 列表、刷新、kill 和 attach 数据
src/app/components/settings/                       设置面板（主机列表/编辑器、删除确认、显示/i18n）
src/main/desktop/tmux.ts                           list-sessions / kill-session（本地与 SSH）
src/app/components/ui/panel.tsx                    shadcn 风格 Panel/Header/Title/Actions/Content/Footer
src/app/components/terminal/terminal-panel.tsx     terminal 面板，持有 TerminalView
src/app/components/terminal/tmux-panel.tsx         稳定 terminal 外壳，tmux 时嵌入 terminal + 窗口 tabs
src/app/components/terminal/panel-placeholder.tsx  loading/空/错误状态面板
src/app/components/terminal/session-content.tsx    按 active tab 组装各面板
src/app/components/sftp-panel.tsx                  SFTP 面板
src/app/components/terminal/tmux-tab-bar.tsx       订阅 tmux 快照并分发标题栏操作
src/shared/tmux.ts                                 tmux 窗口/session 的 host 类型
src/main/desktop/workspace-config.ts               Node.js JSON 配置读写与账户默认 shell
src/main/desktop/main.ts                           创建 LynxWindow
rsbuild.config.ts                                  pluginLynxtron 启用 AutoLink
native/
  Cargo.toml / Cargo.lock              项目 Rust crate 和依赖
  build.rs                            生成 cxx 桥，构建并链接 C++ 静态库
  src/lib.rs                          napi-rs 类、cxx 桥、共享状态和生命周期
  src/terminal_core/                   portable-pty 传输与 Alacritty 网格计算
  src/terminal_session.rs              u32 注册表、session renderer 及生命周期
  src/binding/                        bindgen ABI、Extension / NativeView trait 和 Value RAII
  src/native_terminal_view.rs          Rust native element 生命周期、属性、invoke 和事件
  src/terminal_view.rs                 layout resize、网格快照与渲染目标准备
  src/renderer.rs                     LazyLock 共享 GPU/atlas 与每个 session 的 renderer
  src/frame.rs                        平台无关的 cxx Viewport
  src/frame_driver.rs                 napi-rs JS RAF 适配器
  src/frame_callbacks.rs              全局回调注册与 UI 同步分发 / deadline 丢帧
  src/platform/
    mod.rs                            按目标平台选择适配器
    unix.rs                           Unix 默认 shell 和 PTY EOF 策略
    windows.rs                        portable-pty 默认进程和 EOF 策略
    macos/
      mod.rs                          Metal 后端选择
      surface.rs                      IOSurface 校验与 wgpu texture 导入
      terminal.rs                     macOS terminal cxx 桥
      frame.rs                        UI 调度、时钟和 native 回调桥
      font.rs                         Menlo / CoreText 字体策略
      build.rs                        macOS CMake 与 framework 链接
  src/text/
    mod.rs                            文字渲染模块入口
    atlas.rs                          Alacritty atlas 分配与 wgpu staging buffer 上传
    font.rs                           crossfont 字体与字形缓存
    glyph_renderer.rs                 instance buffer 与文字绘制
    atlas.wgsl                        字形采样 shader
  src/tests/                           平台无关测试；macos/ 保存平台测试和夹具
  package.json                        @catus/native 本地 workspace
  lynx.lib.json                        声明 macOS arm64/x64 原生产物
  elements.d.ts                       自定义标签及事件的 TypeScript 类型
  index.d.ts / index.d.cts             Rust API 类型及公共类型入口
  index.cjs                           加载当前平台的 .node 文件
  build.mjs                           napi-rs 构建入口，输出扩展和 TypeScript 声明
  cxx/
    CMakeLists.txt                    仅生成项目 C++ 静态库
    common/
      NativeTerminalRegistration.cc    Lynx extension 注册与窗口生命周期
    platform/
      UiThread.h / RustBridge.h        按平台选择适配器
      macos/
        UiThread.h                     主队列调度和 UI 线程检查
```

`@catus/native` 是整个项目的 native 包。新增组件实现 Rust `NativeView` / `ViewFactory`，
由 extension 注册唯一标签，再补充 `native/elements.d.ts` 类型。多个组件共享一个 `.node`，
不要求包名与标签同名。

```text
pnpm run dev / build
  napi-rs → Cargo → build.rs/CMake，生成 catus-native.node
       ↓
pluginLynxtron（rsbuild.config.ts）
  扫描 lynx.lib.json，复制原生库并注入加载代码
       ↓
native/index.cjs
  require(.node)，激活 terminal extension 静态注册
       ↓
terminal-view.tsx 渲染 <native-terminal>
  Rust factory 创建 terminal view 并绑定 session
       ↓
OnPropertiesChanged / OnLayoutChanged
  更新原生属性与布局
       ↓
终端键盘输入 → Rust PTY → 网格更新 → RAF 绘制
```

原生库输出：`native/dist/darwin/<arch>/catus-native.node`。
AutoLink 将它加载到桌面主进程并使标签可用于 Lynx runtime；UI 不应直接
import `@catus/native/lynxtron`。示例只使用该包的 TypeScript 类型。

native terminal 当前只实现 macOS 后端。

## SFTP 异步接口

已实现本地/SSH workspace 编辑弹窗，以及使用系统 SSH 管道 + russh-sftp 的文件浏览面板。
Native 接口使用 napi-rs async Promise，Node main 持有连接并接收异步结果，
Lynx BTS 使用 `lynxBridge` 请求文件操作。主线程路径已通过 windowless SFTP E2E，
绕过了 BTS 中的 Node Environment 回调断言；上游根因仍待确认。
运行时选择、调用示例和测试说明见 [SFTP 异步实现](docs/sftp-async.md)。

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
