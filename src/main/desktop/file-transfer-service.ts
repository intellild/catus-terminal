import type { FileTransferReply, FileTransferRequest } from '../../shared/sftp';

// File dialogs and scp stay in main; this handler carries only the transfer request.
export function createFileTransferService(
  uploadFiles: (destination: string, path: string) => Promise<boolean>,
  downloadFile: (destination: string, path: string) => Promise<boolean>,
) {
  return async (request: FileTransferRequest): Promise<FileTransferReply> => {
    try {
      const value =
        request.operation === 'upload'
          ? await uploadFiles(request.destination, request.path)
          : await downloadFile(request.destination, request.path);
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}
