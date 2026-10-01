import { useCallback, useState } from '@lynx-js/react';
import type { NativeInputEvent } from '@catus/native-input';
import './App.css';

const initialValue = 'Hello, Lynxtron!';

export function App() {
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState('Ready · native component loaded');
  const [revision, setRevision] = useState(0);

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
      </view>
    </view>
  );
}
