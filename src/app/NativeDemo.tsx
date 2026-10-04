import { useCallback, useRef, useState } from '@lynx-js/react';
import type { NativeInputEvent } from '@catus/native';
import type { RustCounter } from '@catus/native/lynxtron';
import { verifyRustInterop } from './rustInterop';
import './tailwind.css';

const initialValue = 'Hello, Lynxtron!';

export function NativeDemo() {
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
    lynx
      .createSelectorQuery()
      .select('#demo-input')
      .invoke({
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
      })
      .exec();
  }, []);

  return (
    <scroll-view scroll-y className="w-full h-full">
      <view className="flex w-full min-h-full items-center justify-center bg-[#eef2f6] p-[20px]">
        <view className="flex flex-col w-[680px] max-w-full p-[24px] rounded-[20px] bg-[#ffffff] shrink-0">
          <text className="text-[#25765b] text-[12px] font-bold tracking-[2px] mb-[16px]">
            CATUS / LYNXTRON
          </text>
          <text className="text-[#17212b] text-[30px] font-bold mb-[12px]">Native components</text>
          <text className="text-[#64748b] text-[15px] leading-[23px] mb-[28px]">
            A macOS input view and shared Rust objects, embedded in ReactLynx.
          </text>
          <text className="text-[#64748b] text-[11px] font-bold tracking-[1px] mb-[10px]">
            NATIVE INPUT
          </text>
          <native-input
            id="demo-input"
            className="w-full h-[40px] mb-[20px]"
            value={value}
            placeholder="Type here — including 中文"
            bindinput={handleInput}
          />
          <view className="flex flex-row flex-wrap gap-[8px] mb-[24px]">
            <view
              id="update-property"
              className="py-[10px] px-[14px] rounded-[8px] bg-[#25765b]"
              bindtap={updateProperty}
            >
              <text className="text-[13px] text-[#ffffff]">Update property</text>
            </view>
            <view
              id="set-native-value"
              className="py-[10px] px-[14px] rounded-[8px] bg-[#e9eef3]"
              bindtap={() => invokeNative('setValue', { value: 'Set through native method' })}
            >
              <text className="text-[13px] text-[#253647]">Call setValue</text>
            </view>
            <view
              id="focus-native-input"
              className="py-[10px] px-[14px] rounded-[8px] bg-[#e9eef3]"
              bindtap={() => invokeNative('focus')}
            >
              <text className="text-[13px] text-[#253647]">Focus</text>
            </view>
            <view
              id="read-native-value"
              className="py-[10px] px-[14px] rounded-[8px] bg-[#e9eef3]"
              bindtap={() => invokeNative('getValue')}
            >
              <text className="text-[13px] text-[#253647]">Read value</text>
            </view>
          </view>
          <view className="p-[18px] rounded-[10px] bg-[#f5f7f9]">
            <text className="text-[#64748b] text-[11px] font-bold tracking-[1px] mb-[10px]">
              REACTLYNX STATE
            </text>
            <text id="current-value" className="text-[18px] text-[#17212b] mb-[10px]">
              {value || '(empty)'}
            </text>
            <text id="native-status" className="text-[12px] text-[#25765b]">
              {status}
            </text>
          </view>
          <text className="text-[11px] text-[#94a3b8] mt-[22px]">
            C++ static registration → AutoLink → native-input
          </text>
          <view className="flex flex-col mt-[24px] pt-[20px] border-t border-solid border-[#e9eef3]">
            <text className="text-[#64748b] text-[11px] font-bold tracking-[1px] mb-[10px]">
              NAPI-RS / CXX INTEROP
            </text>
            <view
              id="verify-rust"
              className="py-[10px] px-[14px] rounded-[8px] bg-[#25765b]"
              bindtap={verifyRust}
            >
              <text className="text-[13px] text-[#ffffff]">Verify shared Rust object</text>
            </view>
            <text id="rust-status" className="text-[12px] text-[#25765b] mt-[14px]">
              {rustStatus}
            </text>
            <text
              id="rust-details"
              className="text-[11px] leading-[16px] text-[#64748b] mt-[8px] break-all"
            >
              {rustDetails}
            </text>
          </view>
        </view>
      </view>
    </scroll-view>
  );
}
