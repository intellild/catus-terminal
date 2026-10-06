use super::*;

async fn local(directory: &std::path::Path) -> Connection {
    let mut command = Command::new("/usr/libexec/sftp-server");
    command.arg("-d").arg(directory);
    Connection::spawn(command).await.unwrap()
}
#[tokio::test]
async fn binary_files_unicode_paths_metadata_and_directory_operations() {
    let directory = tempfile::tempdir().unwrap();
    let connection = local(directory.path()).await;
    let data = [0, 255, 10, 13, 27, 128, 42];
    connection.create_dir("目录").await.unwrap();
    connection.write("目录/文件.bin", &data).await.unwrap();
    assert_eq!(connection.read("目录/文件.bin").await.unwrap(), data);
    assert_eq!(
        connection.metadata("目录/文件.bin").await.unwrap().size,
        Some(data.len() as u64)
    );
    let entries = connection.read_dir("目录").await.unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].file_name(), "文件.bin");
    assert_eq!(entries[0].path(), "目录/文件.bin");
    assert!(entries[0].file_type().is_file());
    connection.write("目录/文件.bin", b"x").await.unwrap();
    assert_eq!(connection.read("目录/文件.bin").await.unwrap(), b"x");
    connection
        .rename("目录/文件.bin", "目录/renamed.bin")
        .await
        .unwrap();
    assert!(connection.read("目录/文件.bin").await.is_err());
    connection.remove_file("目录/renamed.bin").await.unwrap();
    connection.remove_dir("目录").await.unwrap();
    assert!(connection.read_dir(".").await.unwrap().is_empty());
    connection.close().await.unwrap();
    connection.close().await.unwrap();
    assert!(
        connection
            .read("missing")
            .await
            .unwrap_err()
            .to_string()
            .contains("closed")
    );
}
#[tokio::test]
async fn sessions_are_isolated_and_failed_requests_do_not_close_the_connection() {
    let first_dir = tempfile::tempdir().unwrap();
    let second_dir = tempfile::tempdir().unwrap();
    let first = local(first_dir.path()).await;
    let second = local(second_dir.path()).await;
    let error = first.read("missing").await.unwrap_err();
    assert!(format!("{error:#}").contains("Read remote file missing"));
    assert!(error.chain().count() > 1);
    let (a, b) = tokio::join!(
        first.write("same", b"first"),
        second.write("same", b"second")
    );
    a.unwrap();
    b.unwrap();
    assert_eq!(first.read("same").await.unwrap(), b"first");
    assert_eq!(second.read("same").await.unwrap(), b"second");
    first.close().await.unwrap();
    assert_eq!(second.read("same").await.unwrap(), b"second");
    second.close().await.unwrap();
}
#[tokio::test]
async fn invalid_ssh_options_and_failed_handshakes_are_errors() {
    for destination in ["", "-oProxyCommand=bad", "host\nother"] {
        let error = match Connection::connect(Options {
            destination: destination.into(),
            port: None,
            identity_file: None,
            config_file: None,
        })
        .await
        {
            Err(error) => error,
            Ok(_) => panic!("Invalid destinations must fail before SSH starts"),
        };
        assert!(error.to_string().contains("Invalid SSH destination"));
    }
    assert!(
        Connection::spawn(Command::new("/usr/bin/false"))
            .await
            .is_err()
    );
    assert!(
        Connection::spawn(Command::new("/nonexistent/catus-ssh"))
            .await
            .is_err()
    );
}
