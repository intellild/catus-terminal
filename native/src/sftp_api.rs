//! Promise-based SFTP API, called directly from the preload Node environment.
use crate::sftp::{Connection, Options};
use napi::{
    Env,
    bindgen_prelude::{BigInt, PromiseRaw, Uint8Array},
};
use napi_derive::napi;
use russh_sftp::client::fs::Metadata;
use std::sync::Arc;

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
#[napi]
pub async fn connect_sftp(options: SftpOptions) -> napi::Result<SftpConnection> {
    let connection = Connection::connect(Options {
        destination: options.destination,
        port: options.port,
        identity_file: options.identity_file,
        config_file: options.config_file,
    })
    .await
    .map_err(crate::napi_error)?;
    Ok(SftpConnection {
        connection: Arc::new(connection),
    })
}
#[napi]
impl SftpConnection {
    #[napi]
    pub async fn realpath(&self, path: String) -> napi::Result<String> {
        self.connection
            .realpath(&path)
            .await
            .map_err(crate::napi_error)
    }
    #[napi]
    pub async fn stat(&self, path: String) -> napi::Result<SftpMetadata> {
        self.connection
            .stat(&path)
            .await
            .map(Into::into)
            .map_err(crate::napi_error)
    }
    #[napi]
    pub async fn readdir(&self, path: String) -> napi::Result<Vec<SftpEntry>> {
        Ok(self
            .connection
            .read_dir(&path)
            .await
            .map_err(crate::napi_error)?
            .into_iter()
            .map(|entry| SftpEntry {
                name: entry.file_name(),
                path: entry.path(),
                metadata: entry.metadata().into(),
            })
            .collect())
    }
    #[napi]
    pub async fn read_dir(&self, path: String) -> napi::Result<Vec<SftpEntry>> {
        self.readdir(path).await
    }
    #[napi]
    pub async fn metadata(&self, path: String) -> napi::Result<SftpMetadata> {
        self.connection
            .metadata(&path)
            .await
            .map(Into::into)
            .map_err(crate::napi_error)
    }
    #[napi]
    pub async fn read_file(&self, path: String) -> napi::Result<Uint8Array> {
        self.connection
            .read(&path)
            .await
            .map(Into::into)
            .map_err(crate::napi_error)
    }
    #[napi]
    pub fn write_file<'env>(
        &self,
        env: &'env Env,
        path: String,
        data: Uint8Array,
    ) -> napi::Result<PromiseRaw<'env, ()>> {
        // Copy on the JS thread before spawning the future; callers may mutate the array immediately.
        let data = data.to_vec();
        let connection = self.connection.clone();
        env.spawn_future(async move {
            connection
                .write(&path, &data)
                .await
                .map_err(crate::napi_error)
        })
    }
    #[napi]
    pub async fn create_dir(&self, path: String) -> napi::Result<()> {
        self.connection
            .create_dir(&path)
            .await
            .map_err(crate::napi_error)
    }
    #[napi]
    pub async fn rename(&self, from: String, to: String) -> napi::Result<()> {
        self.connection
            .rename(&from, &to)
            .await
            .map_err(crate::napi_error)
    }
    #[napi]
    pub async fn remove_file(&self, path: String) -> napi::Result<()> {
        self.connection
            .remove_file(&path)
            .await
            .map_err(crate::napi_error)
    }
    #[napi]
    pub async fn remove_dir(&self, path: String) -> napi::Result<()> {
        self.connection
            .remove_dir(&path)
            .await
            .map_err(crate::napi_error)
    }
    #[napi]
    pub async fn close(&self) -> napi::Result<()> {
        self.connection.close().await.map_err(crate::napi_error)
    }
}
