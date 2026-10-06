//! Error-first TSFN boundary; Promise wrapping belongs to the JS host adapter.
use crate::sftp::{Connection, Options};
use napi::{
    bindgen_prelude::{BigInt, ToNapiValue, Uint8Array},
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;
use russh_sftp::client::fs::Metadata;
use std::{future::Future, sync::Arc};

#[napi(object)]
pub struct SftpOptions {
    pub destination: String,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
    pub config_file: Option<String>,
}
#[napi(object)]
pub struct SftpMetadata {
    pub size: Option<BigInt>,
    pub permissions: Option<u32>,
    pub modified: Option<u32>,
    pub file_type: String,
}
impl From<Metadata> for SftpMetadata {
    fn from(value: Metadata) -> Self {
        let file_type = match value.file_type() {
            russh_sftp::protocol::FileType::Dir => "directory",
            russh_sftp::protocol::FileType::File => "file",
            russh_sftp::protocol::FileType::Symlink => "symlink",
            russh_sftp::protocol::FileType::Other => "other",
        }
        .into();
        Self {
            size: value.size.map(BigInt::from),
            permissions: value.permissions,
            modified: value.mtime,
            file_type,
        }
    }
}
#[napi(object)]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub metadata: SftpMetadata,
}
#[napi]
pub struct SftpConnection {
    connection: Arc<Connection>,
}
// TODO: Lynxtron 0.0.28 windowless/macOS aborts with
// `Environment::GetCurrent(isolate) == env` after a successful TSFN enqueue.
// Normal Node callback tests pass; synchronous noop passes in Lynx BTS.
// Both native Promise and TSFN + JS Promise paths reproduce the assertion.
// Investigate the Node/V8 context entered by the BTS libuv callback dispatch.
// See docs/sftp-async.md; this callback boundary is not a confirmed workaround.
fn dispatch<T: ToNapiValue + Send + 'static>(
    callback: ThreadsafeFunction<T, ()>,
    future: impl Future<Output = anyhow::Result<T>> + Send + 'static,
) {
    napi::bindgen_prelude::spawn(async move {
        callback.call(
            future.await.map_err(crate::napi_error),
            ThreadsafeFunctionCallMode::NonBlocking,
        );
    });
}

#[napi]
pub fn connect_sftp(options: SftpOptions, callback: ThreadsafeFunction<SftpConnection, ()>) {
    dispatch(callback, async move {
        let connection = Connection::connect(Options {
            destination: options.destination,
            port: options.port,
            identity_file: options.identity_file,
            config_file: options.config_file,
        })
        .await?;
        Ok(SftpConnection {
            connection: Arc::new(connection),
        })
    });
}
#[napi]
impl SftpConnection {
    #[napi]
    pub fn realpath(&self, path: String, callback: ThreadsafeFunction<String, ()>) {
        let connection = self.connection.clone();
        dispatch(callback, async move { connection.realpath(&path).await });
    }
    #[napi]
    pub fn stat(&self, path: String, callback: ThreadsafeFunction<SftpMetadata, ()>) {
        let connection = self.connection.clone();
        dispatch(
            callback,
            async move { Ok(connection.stat(&path).await?.into()) },
        );
    }
    #[napi]
    pub fn readdir(&self, path: String, callback: ThreadsafeFunction<Vec<SftpEntry>, ()>) {
        let connection = self.connection.clone();
        dispatch(callback, async move {
            Ok(connection
                .read_dir(&path)
                .await?
                .into_iter()
                .map(|entry| SftpEntry {
                    name: entry.file_name(),
                    path: entry.path(),
                    metadata: entry.metadata().into(),
                })
                .collect())
        });
    }
    #[napi]
    pub fn read_dir(&self, path: String, callback: ThreadsafeFunction<Vec<SftpEntry>, ()>) {
        self.readdir(path, callback);
    }
    #[napi]
    pub fn metadata(&self, path: String, callback: ThreadsafeFunction<SftpMetadata, ()>) {
        let connection = self.connection.clone();
        dispatch(callback, async move {
            Ok(connection.metadata(&path).await?.into())
        });
    }
    #[napi]
    pub fn read_file(&self, path: String, callback: ThreadsafeFunction<Uint8Array, ()>) {
        let connection = self.connection.clone();
        dispatch(
            callback,
            async move { Ok(connection.read(&path).await?.into()) },
        );
    }
    #[napi]
    pub fn write_file(&self, path: String, data: Uint8Array, callback: ThreadsafeFunction<(), ()>) {
        // Snapshot mutable JS bytes on the JS thread before scheduling native work.
        let data = data.to_vec();
        let connection = self.connection.clone();
        dispatch(
            callback,
            async move { connection.write(&path, &data).await },
        );
    }
    #[napi]
    pub fn create_dir(&self, path: String, callback: ThreadsafeFunction<(), ()>) {
        let connection = self.connection.clone();
        dispatch(callback, async move { connection.create_dir(&path).await });
    }
    #[napi]
    pub fn rename(&self, from: String, to: String, callback: ThreadsafeFunction<(), ()>) {
        let connection = self.connection.clone();
        dispatch(callback, async move { connection.rename(&from, &to).await });
    }
    #[napi]
    pub fn remove_file(&self, path: String, callback: ThreadsafeFunction<(), ()>) {
        let connection = self.connection.clone();
        dispatch(callback, async move { connection.remove_file(&path).await });
    }
    #[napi]
    pub fn remove_dir(&self, path: String, callback: ThreadsafeFunction<(), ()>) {
        let connection = self.connection.clone();
        dispatch(callback, async move { connection.remove_dir(&path).await });
    }
    #[napi]
    pub fn close(&self, callback: ThreadsafeFunction<(), ()>) {
        let connection = self.connection.clone();
        dispatch(callback, async move { connection.close().await });
    }
}
