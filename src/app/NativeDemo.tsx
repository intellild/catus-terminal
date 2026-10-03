import { useCallback, useRef, useState } from '@lynx-js/react';
import type { NativeInputEvent } from '@catus/native';
import type { RustCounter } from '@catus/native/lynxtron';
import { verifyRustInterop } from './rustInterop';
import './NativeDemo.css';

const initialValue = 'Hello, Lynxtron!';

export function NativeDemo() {
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState('Ready · native component loaded');
  const [revision, setRevision] = useState(0);
  const [rustStatus, setRustStatus] = useState('Ready to verify Rust → C++ → Rust');
  const [rustDetails, setRustDetails] = useState('');
  const rustCounter = useRef<RustCounter | null>(null);
  const verifying = useRef(false);
  const [terminalStatus, setTerminalStatus] = useState('Rust wgpu · crossfont / glyph atlas');
  const [terminalDetails, setTerminalDetails] = useState('');
  const [compactTerminal, setCompactTerminal] = useState(false);
  const [terminalGeneration, setTerminalGeneration] = useState(0);

  const verifyTerminal = useCallback((method: 'renderTriangle' | 'renderAtlas' | 'clearAtlas') => {
    'background only';
    lynx.createSelectorQuery().select('#demo-terminal').invoke({
      method,
      params: {},
      success: (result: unknown) => {
        const info = result as { backend: string; mode: string; width: number; height: number; frames: number; pixelVerified: boolean; error: string; atlasUploads: number; atlasInstances: number; cachedGlyphs: number; rasterizations: number; missingGlyphs: number };
        const atlasPassed = info.mode !== 'atlas' || (info.atlasUploads > 0 && info.atlasInstances > 0 && info.cachedGlyphs > 0 && info.rasterizations === info.cachedGlyphs && info.missingGlyphs === 0);
        const passed = info.backend === 'Metal' && info.pixelVerified && !info.error && info.frames > 0 && atlasPassed;
        setTerminalStatus(`${passed ? 'PASS' : 'FAIL'} · ${info.mode} · ${info.backend} · ${info.width} × ${info.height} px`);
        setTerminalDetails(JSON.stringify(result));
        console.log('[wgpu rendering verification]', JSON.stringify(result));
      },
      fail: (error: unknown) => setTerminalStatus(`FAIL · ${JSON.stringify(error)}`),
    }).exec();
  }, []);

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
    <scroll-view scroll-y className="Viewport">
      <view className="Page">
        <view className="Card">
          <text className="Eyebrow">CATUS / LYNXTRON</text>
          <text className="Title">Native components</text>
          <text className="Description">
            A Rust wgpu surface and a macOS input view, embedded in ReactLynx.
          </text>
          <view className="TerminalSection">
            <text className="Label">NATIVE TERMINAL / RUST WGPU</text>
            <native-terminal id="demo-terminal" key={terminalGeneration}
              className="TerminalSurface" style={{ height: compactTerminal ? '150px' : '220px' }} />
            <view className="Actions TerminalActions">
              <view id="verify-atlas" className="Button Primary" bindtap={() => verifyTerminal('renderAtlas')}>
                <text className="PrimaryText">Render / verify fonts</text>
              </view>
              <view id="verify-terminal" className="Button" bindtap={() => verifyTerminal('renderTriangle')}>
                <text className="ButtonText">Triangle</text>
              </view>
              <view id="clear-atlas" className="Button" bindtap={() => verifyTerminal('clearAtlas')}>
                <text className="ButtonText">Clear atlas</text>
              </view>
              <view id="resize-terminal" className="Button" bindtap={() => setCompactTerminal(current => !current)}>
                <text className="ButtonText">Resize</text>
              </view>
              <view id="recreate-terminal" className="Button" bindtap={() => {
                setTerminalGeneration(current => current + 1);
                setTerminalDetails('');
                setTerminalStatus('View recreated · render to verify');
              }}>
                <text className="ButtonText">Recreate view</text>
              </view>
            </view>
            <text id="terminal-status" className="Status">{terminalStatus}</text>
            <text id="terminal-details" className="RustDetails">{terminalDetails}</text>
          </view>
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
    </scroll-view>
  );
}
