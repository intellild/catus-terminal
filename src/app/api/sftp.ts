import { createSftpHost } from '../../shared/sftp-host';
import { FILE_TRANSFER_CHANNEL } from '../../shared/sftp';
import type { FileTransferReply, FileTransferRequest, NativeSftpHost } from '../../shared/sftp';

// SFTP browsing uses NativeModules.nodejs.exposed, which calls N-API directly
// in preload. Uploads and downloads still cross to main for native dialogs/scp.
const nativeSftpHost = () => NativeModules.nodejs.exposed as NativeSftpHost;

function transfer(request: FileTransferRequest): Promise<boolean> {
  return new Promise((resolve, reject) => {
    NativeModules.bridge.call(FILE_TRANSFER_CHANNEL, request, (reply) => {
      const result = reply as FileTransferReply;
      if (result.ok) {
        resolve(result.value);
      } else {
        reject(new Error(result.error));
      }
    });
  });
}

export const sftpClient = {
  ...createSftpHost(nativeSftpHost),
  uploadFiles(destination: string, path: string): Promise<boolean> {
    return transfer({ operation: 'upload', destination, path });
  },
  downloadFile(destination: string, path: string): Promise<boolean> {
    return transfer({ operation: 'download', destination, path });
  },
};
