import { SftpClient } from './SftpClient';
import { SFTP_CHANNEL } from '../../shared/sftpBridge';
import type { SftpReply } from '../../shared/sftpBridge';

// Access NativeModules only when invoked from background-thread business logic.
export const sftpClient = new SftpClient(
  (request) =>
    new Promise((resolve) =>
      NativeModules.bridge.call(SFTP_CHANNEL, request, (reply) => resolve(reply as SftpReply)),
    ),
);
