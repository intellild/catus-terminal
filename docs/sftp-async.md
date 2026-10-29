# SFTP 异步实现

采用系统 OpenSSH + russh-sftp 3.0.1，不集成 SSH 加密/认证库。

```text
Lynx BTS / 事件处理或 effect
  NativeModules.nodejs.exposed.sftpConnect / sftpReaddir / sftpRealpath /
  sftpStat / sftpClose → Promise
       ↓
src/main/desktop/preload.ts / sftp.ts
  preload 保存连接表，直接调用 napi-rs 并返回可序列化数据
       ↓
native/src/sftp_api.rs
  N-API async fn → napi-rs 管理的 Tokio runtime → native Promise
       ↓
native/src/sftp/mod.rs / transport.rs
  ssh -T -o BatchMode=yes [-p port] [-i identity] [-F config] -s -- destination sftp
  ChildStdin + ChildStdout → AsyncRead + AsyncWrite → russh-sftp
       ↓
远端 SFTP subsystem
  结构化目录/元数据与二进制文件操作
```

## 官方通信方式与运行时选择

[Lynxtron 官方通信文档](https://lynxjs.org/next/lynxtron/learn/Communication-Between-Node-And-Lynx.html)
明确 preload 可以直接使用 Node.js 能力，并通过 `contextBridge.exposeInLynxBTS()`
把方法暴露给 `NativeModules.nodejs.exposed`。SFTP 使用这条路径：preload 创建 napi-rs
连接，BTS 调用暴露的操作，不经过 main 进程的 JSON 请求/回复桥。

不能在返回值里直接携带 napi 连接对象及其方法：ContextBridge 会在 BTS 调用这些
方法时抛出 `TypeError: no access`。因此 preload 保存数字连接 ID，只暴露
`sftpConnect`、`sftpReaddir`、`sftpRealpath`、`sftpStat` 和 `sftpClose`；
bigint 尺寸以字符串传递。`src/shared/sftp-host.ts` 在 BTS 把这些操作适配成
与 `node:fs/promises` 接近的 `RemoteFs`。

[napi-rs async fn](https://napi.rs/docs/concepts/async-fn) 的 `async` feature
提供 Tokio runtime，自动将异步结果转换为 Promise。
[russh-sftp 3.0.1](https://docs.rs/crate/russh-sftp/3.0.1/source/src/client/runtime.rs)
直接使用 `tokio::spawn`、`tokio::time::timeout_at` 和 Tokio IO trait，因此保留
napi-rs 的 Tokio runtime，不引入 smol 等其他 executor。

## 调用方式

以下代码运行在 BTS 事件处理或 effect 中：

```ts
// Renderer 状态层调用 facade，不需要访问 bridge。
const sftp = await sftpClient.connectSftp({
  destination: 'my-server', // 可以是 ~/.ssh/config 中的 Host 别名
});
try {
  const entries = await sftp.readdir('.', { withFileTypes: true });
  const directory = await sftp.realpath('.');
  const metadata = await sftp.stat(directory);
} finally {
  await sftp.close();
}
```

BTS 实际调用的是 `NativeModules.nodejs.exposed.sftp*`；连接对象和 Promise
完成处理都留在 preload/BTS，不进入 main。

## 上传与下载

上传/下载仍由 main 处理，因为原生文件对话框和 scp 是 main 进程能力：
BTS 通过 `lynxBridge` 的 `catus:file-transfer` 通道发送目的地和远端路径，main 调用
`dialog.showOpenDialog` / `dialog.showSaveDialog` 后执行 scp。这个通道只承载
文件选择与传输请求，不创建或转发 SFTP N-API 对象。

## 当前行为与验证范围

- SSH 使用普通二进制管道，不分配 PTY。stderr 独立继承到 host 日志。
- 认证沿用系统配置、密钥、agent 和 known_hosts。BatchMode 禁止交互认证提示；
  未完成认证或主机信任时返回失败，当前没有密码输入流程。
- 每个对象拥有一个独立 SSH 进程；连接内操作串行执行，连接间可并行。
- 初始化等待上限 10 秒；close 关闭协议后等待进程退出，2 秒后强制终止并回收。
  close 幂等，close 后操作拒绝。对象丢弃也会通过 kill-on-drop 终止子进程。
- writeFile 在 JS 调用线程复制 Uint8Array，避免异步操作读取随后被修改的 JS 内存。
  readFile/writeFile 当前将完整文件放入内存；流式传输、进度和取消接口尚未实现。
- `native/src/tests/macos/sftp.rs` 使用本地 OpenSSH sftp-server 验证真实协议：
  二进制/Unicode 文件、覆盖截断、目录、元数据、重命名、删除、隔离、错误和关闭。
- `pnpm run test:napi` 中的 `tests/native/sftp.mjs` 使用临时 SSH shim，验证 SSH 参数、
  N-API Promise、256 KiB 二进制数据、字节复制和连接回收。不会连接远端服务器。
- windowless E2E 使用 SSH shim 和真实 sftp-server 验证 BTS 直接调用 N-API 的浏览、
  上传和下载流程。真实远程 SSH 认证尚未实测。

## 历史问题与 0.0.31 修复

Lynxtron 0.0.28 的 BTS 在 TSFN 排队后、进入 JS callback 前触发
`Environment::GetCurrent(isolate) == env` 断言。napi-rs Promise 和 TSFN + promisify
均能复现，同步 noop 正常。当时的临时方案是把 native 对象与异步完成移到 Node main，
再由 `lynxBridge` 转发 JSON；该方案和 `sftp-service.ts`/`sftp-bridge.ts` 已移除。

Lynxtron 0.0.31 在 TSFN dispatch/finalizer 构造 `CallbackScope` 前进入所属 V8 context，
修复了 preload/BTS 中的 native Promise 与 callback。现在恢复直接在 preload 调用
napi-rs 导出的方法；上传/下载的 main 通道仅用于文件对话框和 scp。
