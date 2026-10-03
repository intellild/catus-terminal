import { app, LynxWindow } from '@lynx-js/lynxtron';
import { LYNX_BUNDLE_PATH } from './vendorPaths';
import path from 'node:path';

const isDev = process.env.NODE_ENV === 'development';

function createWindow() {
  // pluginLynxtron loads AutoLink libraries before this entry creates the window.
  const window = new LynxWindow({
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 480,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 20 },
    backgroundColor: '#101215',
    title: 'Catus',
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
