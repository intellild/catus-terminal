import { app, LynxWindow } from '@lynx-js/lynxtron';
import { LYNX_BUNDLE_PATH } from './vendorPaths';
import path from 'node:path';

const isDev = process.env.NODE_ENV === 'development';

function createWindow() {
  // pluginLynxtron loads AutoLink libraries before this entry creates the window.
  const window = new LynxWindow({
    width: 900,
    height: 850,
    title: 'Catus · Native Component Demo',
    lynxPreference: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (isDev) {
    window.loadURL('http://localhost:5969/main.lynx.bundle');
  } else {
    window.loadFile(LYNX_BUNDLE_PATH);
  }
  window.show();
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
