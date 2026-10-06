# SFTP 异步实现

采用系统 OpenSSH + russh-sftp 3.0.1，不集成 SSH 加密/认证库。

```text
Lynx BTS / 事件处理或 effect
  await NativeModules.nodejs.exposed.connectSftp(options)
       ↓
src/main/desktop/preload.ts
  调用同步 Rust N-API callback 工厂，用 util.promisify 返回 Promise / SftpConnection 对象
       ↓
native/src/sftp_api.rs
  同步 N-API fn 注册 TSFN → napi-rs 管理的 Tokio runtime
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
推荐用 preload 暴露 Node 对象给 BTS；暴露的方法可以返回 Promise。
`bridge.call` 本身返回 void，使用该通道时需将回调包装为 Promise。
本项目已有 preload 对象通道，所以沿用它。在事件处理或 effect 中 await；
不在组件 render 或主线程脚本中调用 Node 能力。

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
const sftp = await NativeModules.nodejs.exposed.connectSftp({
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
- 已验证的是本地协议与 Node-API。真实远程 SSH 认证及 Lynx BTS 中的 SFTP 调用尚未实测。

## TSFN 对照验证

所有 N-API 入口都是同步函数，最后一个参数是 error-first callback。Rust 在
Tokio 中执行连接和文件操作，通过共享的 `dispatch` helper 用 TSFN 返回结果。
`src/main/desktop/sftp.ts` 使用 Node `util.promisify` 包装 Promise，实例方法必须先
`bind(connection)` 保留 receiver；Lynx 侧的 RemoteFs Promise 接口保持不变。
没有 Rust Future → native Promise 的转换。派发 helper 上保留了崩溃 TODO。

普通 Node 的成功/失败连接回调与文件操作测试通过。Lynxtron 0.0.28 的
windowless E2E 和最小 CommonJS preload 都仍复现相同的 Node Environment
断言。诊断日志确认连接成功，TSFN 排队返回 `Ok`，但 JS callback 的第一条
语句尚未执行。问题发生在进入回调之前，不能归因于后续目录读取。

连接 callback 的对照测试已复现断言。所有文件方法也已改为 callback，以继续
排除 native Promise 路径；尚不能将这次转换当作已验证的 BTS 崩溃修复。
