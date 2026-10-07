# SFTP 异步实现

采用系统 OpenSSH + russh-sftp 3.0.1，不集成 SSH 加密/认证库。

```text
Lynx BTS / 事件处理或 effect
  bridge.call('catus:sftp', request, callback) → Promise
       ↓
src/main/desktop/main.ts / sftpService.ts
  lynxBridge.handle 接收请求，main 持有连接并通过 sftp.ts 调用 native Promise
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

## 官方异步建议与运行时选择

[Lynxtron 官方通信文档](https://lynxjs.org/next/lynxtron/learn/Communication-Between-Node-And-Lynx.html)
提供 `lynxBridge.handle` / `NativeModules.bridge.call` 请求与回调通道。
本项目将 SFTP N-API 对象和 Promise 完成处理保留在 Node main 环境；BTS 只发送 JSON 请求。
`bridge.call` 返回 void，`src/app/api/sftp.ts` 将回调包装为 Promise，`SftpClient` 封装文件接口。
连接 ID、字符串化的 bigint 元数据和文件类型跨线程传递，UI 再还原 `RemoteFs` 接口。
main 捕获错误并返回明确的成功/错误数据，因为当前 `lynxBridge.handle` 不会自动回复
handler 拒绝的 Promise。所有窗口关闭时释放连接，尚在连接中的请求完成后也会关闭。

[napi-rs async fn](https://napi.rs/docs/concepts/async-fn) 的 `async` feature
提供 Tokio runtime，自动将异步结果转换为 Promise。
[napi-rs 自定义运行时](https://napi.rs/docs/concepts/async-runtime) 支持
`async-runtime` feature + `AsyncRuntime` 注册接口，允许完全不依赖 Tokio；
因此理论上可接入 smol 生态，但需要实现或采用满足关闭生命周期约束的 backend。
这不是 Lynx 提供的 Rust executor。

本次不采用 smol：russh-sftp 发布版本的原生
[runtime.rs](https://docs.rs/crate/russh-sftp/3.0.1/source/src/client/runtime.rs)
直接调用 `tokio::spawn`、`tokio::time::timeout_at`。它的 IO trait 也是 Tokio 的
AsyncRead/AsyncWrite。仅转换 IO trait 或换 N-API executor 无法移除其 Tokio
执行器和计时器要求。保留 russh-sftp 时，统一使用 napi-rs 的 Tokio 更直接。

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
- 已验证的是本地协议与 Node-API。真实远程 SSH 认证尚未实测。windowless E2E 使用 SSH shim 和真实 sftp-server 验证主线程桥接。

## BTS 崩溃记录与 async 接口

此前为排除 native Promise 路径，曾将所有 N-API 操作改成同步 callback 入口，
Tokio 完成后通过 TSFN 返回，JS 使用 `util.promisify` 包装。普通 Node 测试通过，
但 Lynxtron 0.0.28 的 windowless/macOS 和最小 CommonJS preload 仍复现
`Environment::GetCurrent(isolate) == env` 断言。日志确认 TSFN 排队返回 `Ok`，
JS callback 的第一条语句尚未执行。native Promise 路径同样崩溃，同步 noop 正常。

现在恢复 napi-rs `async fn` → native Promise，不再使用 TSFN 或 promisify 包装。
`writeFile` 在 JS 调用线程先复制 Uint8Array，再用 `Env::spawn_future` 返回 Promise，
保证调用后立即修改输入数组不会影响写入数据。所有内部错误在 N-API 边界转换。
崩溃 TODO 位于 `src/main/desktop/main.ts` 的服务注册处；native 对象与异步完成
保留在 main，BTS 通过 JSON 消息操作连接，避免重新进入有问题的 BTS Node 环境。

## Main 环境对照验证

SFTP 不再由 preload 调用。`main.ts` 注册服务，native 连接和文件操作均在 main 的
Node Environment 中创建与完成，UI 通过消息桥接读取目录。原来会崩溃的 windowless
SFTP E2E 已恢复运行并通过，覆盖读取、进入子目录、返回、刷新和关闭 tab。
这验证了 main 路径可绕过已复现的 BTS 回调断言，不代表上游内部根因已确定。
