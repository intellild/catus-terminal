import { app, dialog, LynxWindow, lynxBridge } from '@lynx-js/lynxtron';
import { LYNX_BUNDLE_PATH } from './vendorPaths';
import path from 'node:path';

import { connectSftp } from './sftp';
import { createFileUploader, createFileDownloader } from './fileTransfers';
import { createSftpService } from './sftpService';
import { SFTP_CHANNEL } from '../../shared/sftpBridge';
import type { SftpRequest } from '../../shared/sftpBridge';

// TODO(Lynxtron 0.0.28/macOS): calling native async SFTP from preload/BTS aborts
// with `Environment::GetCurrent(isolate) == env` before the JS callback runs.
// Both napi-rs Promise and TSFN + promisify reproduce it; synchronous noop passes.
// Keep native objects and async completions in Node main and relay JSON via lynxBridge.
// Main calls pass windowless SFTP E2E; the upstream BTS context issue remains unresolved.
// See docs/sftp-async.md.
const sftp = createSftpService(
  connectSftp,
  createFileUploader(() =>
    process.env.CATUS_E2E_PTY && process.env.CATUS_E2E_UPLOAD_FILE
      ? Promise.resolve({ canceled: false, filePaths: [process.env.CATUS_E2E_UPLOAD_FILE] })
      : dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] }),
  ),
  createFileDownloader((filename) =>
    process.env.CATUS_E2E_PTY && process.env.CATUS_E2E_DOWNLOAD_FILE
      ? Promise.resolve({ canceled: false, filePath: process.env.CATUS_E2E_DOWNLOAD_FILE })
      : dialog.showSaveDialog({ defaultPath: filename }),
  ),
);
lynxBridge.handle(SFTP_CHANNEL, (_event, request) => sftp.handle(request as SftpRequest));

const isDev = process.env.NODE_ENV === 'development';
const windowless = process.env.CATUS_E2E_WINDOWLESS === '1';

function createWindow() {
  // pluginLynxtron loads AutoLink libraries before this entry creates the window.
  const window = new LynxWindow({
    width: 1120,
    height: 760,
    windowless,
    deviceScaleFactor: windowless ? 2 : undefined,
    minWidth: 760,
    minHeight: 480,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: '#101215',
    title: 'Catus',
    lynxPreference: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (windowless && window.getNativeWindowHandle().some((byte) => byte !== 0)) {
    throw new Error('Windowless E2E requires a Lynxtron build with no native parent window');
  }

  if (isDev) {
    window.loadURL('http://localhost:5969/main.lynx.bundle');
  } else {
    window.loadFile(LYNX_BUNDLE_PATH);
  }
  window.show();
  if ((process.env.CATUS_E2E_PTY || process.env.CATUS_E2E_TMUX_SOCKET) && !windowless) {
    app.focus({ steal: true });
    window.focus();
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  void sftp.dispose().finally(() => app.quit());
});

app.on('open-file', (event) => {
  console.log(event);
});
