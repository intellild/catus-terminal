import { SftpClient } from './sftp-client';
import { SFTP_CHANNEL } from '../../shared/sftp-bridge';
import type { SftpReply } from '../../shared/sftp-bridge';

// Access NativeModules only when invoked from background-thread business logic.
export const sftpClient = new SftpClient(
  (request) =>
    new Promise((resolve) =>
      NativeModules.bridge.call(SFTP_CHANNEL, request, (reply) => resolve(reply as SftpReply)),
    ),
);
