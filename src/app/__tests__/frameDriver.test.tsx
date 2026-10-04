import { expect, test, rstest } from '@rstest/core';
import { render } from '@lynx-js/react/testing-library';
import { useFrameDriver } from '../frameDriver';

function Driver() {
  useFrameDriver();
  return null;
}

test('RAF dispatches once to the host and cancels the app loop on unmount', async () => {
  const callbacks: Array<() => void> = [];
  const request = rstest.fn((callback: () => void) => callbacks.push(callback));
  const cancel = rstest.fn();
  const dispatch = rstest.fn();
  Object.assign(lynxTestingEnv.mainThread.globalThis, {
    requestAnimationFrame: request,
    cancelAnimationFrame: cancel,
  });
  rstest.stubGlobal('NativeModules', { nodejs: { exposed: { dispatchAnimationFrame: dispatch } } });
  const { unmount } = render(<Driver />, { enableMainThread: true });
  await rstest.waitFor(() => expect(request).toHaveBeenCalledOnce());
  lynxTestingEnv.switchToMainThread();
  try {
    callbacks[0]!();
  } finally {
    lynxTestingEnv.switchToBackgroundThread();
  }
  await rstest.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
  await rstest.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  unmount();
  await rstest.waitFor(() => expect(cancel).toHaveBeenCalledWith(2));
  // Even an already-delivered callback cannot invoke Rust after teardown.
  lynxTestingEnv.switchToMainThread();
  try {
    callbacks[1]!();
  } finally {
    lynxTestingEnv.switchToBackgroundThread();
  }
  expect(dispatch).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledTimes(2);
});
