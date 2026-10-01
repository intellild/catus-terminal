import { useCallback, useRef, useState } from '@lynx-js/react';
import type { NativeInputEvent } from '@catus/native';
import type { RustCounter } from '@catus/native/lynxtron';
import { verifyRustInterop } from './rustInterop';
import './App.css';

const initialValue = 'Hello, Lynxtron!';

export function App() {
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState('Ready · native component loaded');
  const [revision, setRevision] = useState(0);
  const [rustStatus, setRustStatus] = useState('Ready to verify Rust → C++ → Rust');
  const [rustDetails, setRustDetails] = useState('');
  const rustCounter = useRef<RustCounter | null>(null);
  const verifying = useRef(false);

  const verifyRust = useCallback(async () => {
    'background only';
    if (verifying.current) return;
    verifying.current = true;
    setRustStatus('Verifying…');
    setRustDetails('');
    try {
      const exposed = NativeModules.nodejs.exposed as {
        createRustCounter(initial: number): RustCounter;
      };
      const counter = exposed.createRustCounter(10);
      // Keep the N-API wrapper on the background thread, outside render state.
      rustCounter.current = counter;
      const result = await verifyRustInterop(counter);
      setRustStatus(`PASS · JS ${result.jsBefore} → C++ ${result.cppAfter} → JS ${result.jsAfter}`);
      setRustDetails(JSON.stringify(result));
      console.log('[Rust interop verification]', JSON.stringify(result));
    } catch (error) {
      setRustStatus(`FAIL · ${String(error)}`);
      console.error('[Rust interop verification]', error);
    } finally {
      verifying.current = false;
    }
  }, []);

  const handleInput = useCallback((event: NativeInputEvent) => {
    'background only';
    setValue(event.detail.value);
    setStatus('Received input event from NSTextField');
  }, []);

  const updateProperty = useCallback(() => {
    'background only';
    const next = revision + 1;
    setRevision(next);
    setValue(`Updated from ReactLynx #${next}`);
    setStatus('Updated the native value property');
  }, [revision]);

  const invokeNative = useCallback((method: string, params = {}) => {
    'background only';
    lynx.createSelectorQuery().select('#demo-input').invoke({
      method,
      params,
      success: (result: unknown) => {
        if (method === 'getValue' && typeof result === 'string') {
          setValue(result);
          setStatus(`Native getValue: ${result}`);
        } else {
          if (method === 'setValue') setValue('Set through native method');
          setStatus(`Native ${method} succeeded`);
        }
      },
      fail: (error: unknown) => {
        setStatus(`Native ${method} failed: ${JSON.stringify(error)}`);
      },
    }).exec();
  }, []);

  return (
    <view className="Page">
      <view className="Card">
        <text className="Eyebrow">CATUS / LYNXTRON</text>
        <text className="Title">Custom native component</text>
        <text className="Description">
          A real macOS NSTextField, connected to ReactLynx through the Desktop C++ API.
        </text>
        <text className="Label">NATIVE INPUT</text>
        <native-input
          id="demo-input"
          className="NativeInput"
          value={value}
          placeholder="Type here — including 中文"
          bindinput={handleInput}
        />
        <view className="Actions">
          <view id="update-property" className="Button Primary" bindtap={updateProperty}>
            <text className="PrimaryText">Update property</text>
          </view>
          <view id="set-native-value" className="Button" bindtap={() => invokeNative('setValue', { value: 'Set through native method' })}>
            <text className="ButtonText">Call setValue</text>
          </view>
          <view id="focus-native-input" className="Button" bindtap={() => invokeNative('focus')}>
            <text className="ButtonText">Focus</text>
          </view>
          <view id="read-native-value" className="Button" bindtap={() => invokeNative('getValue')}>
            <text className="ButtonText">Read value</text>
          </view>
        </view>
        <view className="Result">
          <text className="Label">REACTLYNX STATE</text>
          <text id="current-value" className="Value">{value || '(empty)'}</text>
          <text id="native-status" className="Status">{status}</text>
        </view>
        <text className="Footnote">C++ static registration → AutoLink → native-input</text>
        <view className="RustSection">
          <text className="Label">NAPI-RS / CXX INTEROP</text>
          <view id="verify-rust" className="Button Primary" bindtap={verifyRust}>
            <text className="PrimaryText">Verify shared Rust object</text>
          </view>
          <text id="rust-status" className="Status RustStatus">{rustStatus}</text>
          <text id="rust-details" className="RustDetails">{rustDetails}</text>
        </view>
      </view>
    </view>
  );
}
