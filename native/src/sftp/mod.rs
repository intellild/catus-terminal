//! SFTP protocol and SSH subprocess lifecycle, independent of Lynx and Node-API.
mod transport;
use anyhow::{Context, Result, ensure};
use russh_sftp::client::{
    SftpSession,
    fs::{DirEntry, Metadata},
};
use std::{process::Stdio, time::Duration};
use tokio::{
    io::AsyncWriteExt,
    process::{Child, Command},
    sync::{MappedMutexGuard, Mutex, MutexGuard},
    time::timeout,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const CLOSE_TIMEOUT: Duration = Duration::from_secs(2);

pub(crate) struct Options {
    pub destination: String,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
    pub config_file: Option<String>,
}
impl Options {
    fn command(&self) -> Result<Command> {
        ensure!(
            !self.destination.is_empty()
                && !self.destination.starts_with('-')
                && !self.destination.contains(['\0', '\n', '\r']),
            "Invalid SSH destination"
        );
        let mut command = Command::new("ssh");
        command.args(["-T", "-o", "BatchMode=yes"]);
        if let Some(port) = self.port {
            ensure!(port != 0, "SSH port must be in 1..=65535");
            command.arg("-p").arg(port.to_string());
        }
        if let Some(path) = &self.identity_file {
            command.arg("-i").arg(path);
        }
        if let Some(path) = &self.config_file {
            command.arg("-F").arg(path);
        }
        command
            .arg("-s")
            .arg("--")
            .arg(&self.destination)
            .arg("sftp");
        Ok(command)
    }
}
struct Client {
    session: SftpSession,
    child: Child,
}

pub(crate) struct Connection {
    client: Mutex<Option<Client>>,
}
impl Connection {
    pub(crate) async fn connect(options: Options) -> Result<Self> {
        Self::spawn(options.command()?).await
    }
    async fn spawn(mut command: Command) -> Result<Self> {
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .context("Launch SSH SFTP subprocess")?;
        let stream = transport::Transport {
            stdin: child.stdin.take().context("Open SSH stdin")?,
            stdout: child.stdout.take().context("Open SSH stdout")?,
        };
        let handshake = timeout(CONNECT_TIMEOUT, SftpSession::new(stream))
            .await
            .context("SFTP handshake timed out")
            .and_then(|result| result.context("Initialize SFTP subsystem"));
        match handshake {
            Ok(session) => Ok(Self {
                client: Mutex::new(Some(Client { session, child })),
            }),
            Err(error) => {
                let _ = child.kill().await;
                Err(error)
            }
        }
    }
    async fn client(&self) -> Result<MappedMutexGuard<'_, Client>> {
        MutexGuard::try_map(self.client.lock().await, Option::as_mut)
            .map_err(|_| anyhow::anyhow!("SFTP connection is closed"))
    }
    pub(crate) async fn read_dir(&self, path: &str) -> Result<Vec<DirEntry>> {
        Ok(self
            .client()
            .await?
            .session
            .read_dir(path)
            .await
            .with_context(|| format!("List remote directory {path}"))?
            .collect())
    }
    pub(crate) async fn metadata(&self, path: &str) -> Result<Metadata> {
        self.client()
            .await?
            .session
            .symlink_metadata(path)
            .await
            .with_context(|| format!("Read remote metadata {path}"))
    }
    pub(crate) async fn realpath(&self, path: &str) -> Result<String> {
        self.client()
            .await?
            .session
            .canonicalize(path)
            .await
            .with_context(|| format!("Resolve remote path {path}"))
    }
    pub(crate) async fn stat(&self, path: &str) -> Result<Metadata> {
        self.client()
            .await?
            .session
            .metadata(path)
            .await
            .with_context(|| format!("Stat remote path {path}"))
    }
    pub(crate) async fn read(&self, path: &str) -> Result<Vec<u8>> {
        self.client()
            .await?
            .session
            .read(path)
            .await
            .with_context(|| format!("Read remote file {path}"))
    }
    pub(crate) async fn write(&self, path: &str, data: &[u8]) -> Result<()> {
        // russh-sftp's session.write opens existing files without CREATE/TRUNCATE.
        // Our writeFile API follows std::fs::write: create or replace the file.
        let client = self.client().await?;
        let mut file = client
            .session
            .create(path)
            .await
            .with_context(|| format!("Create remote file {path}"))?;
        let written = file
            .write_all(data)
            .await
            .with_context(|| format!("Write remote file {path}"));
        let closed = file
            .close()
            .await
            .with_context(|| format!("Close remote file {path}"));
        written?;
        closed
    }
    pub(crate) async fn create_dir(&self, path: &str) -> Result<()> {
        self.client()
            .await?
            .session
            .create_dir(path)
            .await
            .with_context(|| format!("Create remote directory {path}"))
    }
    pub(crate) async fn rename(&self, from: &str, to: &str) -> Result<()> {
        self.client()
            .await?
            .session
            .rename(from, to)
            .await
            .with_context(|| format!("Rename remote path {from} to {to}"))
    }
    pub(crate) async fn remove_file(&self, path: &str) -> Result<()> {
        self.client()
            .await?
            .session
            .remove_file(path)
            .await
            .with_context(|| format!("Remove remote file {path}"))
    }
    pub(crate) async fn remove_dir(&self, path: &str) -> Result<()> {
        self.client()
            .await?
            .session
            .remove_dir(path)
            .await
            .with_context(|| format!("Remove remote directory {path}"))
    }
    pub(crate) async fn close(&self) -> Result<()> {
        let mut guard = self.client.lock().await;
        let Some(mut client) = guard.take() else {
            return Ok(());
        };
        // Hold the lock through shutdown so concurrent close calls also await reaping.
        let closed = client.session.close().await.context("Close SFTP channel");
        let status = match timeout(CLOSE_TIMEOUT, client.child.wait()).await {
            Ok(status) => status.context("Reap SSH SFTP subprocess"),
            Err(_) => {
                client
                    .child
                    .kill()
                    .await
                    .context("Stop SSH SFTP subprocess")?;
                client
                    .child
                    .wait()
                    .await
                    .context("Reap stopped SSH subprocess")
            }
        };
        closed?;
        ensure!(
            status?.success(),
            "SSH SFTP subprocess exited unsuccessfully"
        );
        Ok(())
    }
}

#[cfg(all(test, target_os = "macos"))]
#[path = "../tests/macos/sftp.rs"]
mod tests;
