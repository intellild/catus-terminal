import { cn } from '../../lib/utils';
import { cva } from 'class-variance-authority';
import { Children, createContext, useContext, useEffect, useRef, useState } from '@lynx-js/react';
import type { ReactNode } from '@lynx-js/react';
import type { InputProps as NativeInputProps, NodesRef, ViewProps } from '@lynx-js/types';

interface InputGroupState {
  disabled: boolean;
  setFocused(focused: boolean): void;
}

const InputGroupContext = createContext<InputGroupState | null>(null);

export interface InputGroupProps extends ViewProps {
  children?: ReactNode;
  disabled?: boolean;
}

export function InputGroup({ children, disabled = false, className, ...props }: InputGroupProps) {
  const [focused, setFocused] = useState(false);
  return (
    <InputGroupContext.Provider value={{ disabled, setFocused }}>
      <view
        {...props}
        className={cn(
          'w-full h-[34px] flex flex-row items-center rounded-[6px] bg-[#14191f] border border-solid',
          focused && !disabled ? 'border-[#a8e6cf]' : 'border-[#39444e]',
          disabled && 'opacity-50',
          className,
        )}
      >
        {children}
      </view>
    </InputGroupContext.Provider>
  );
}

type InputAddonProps = ViewProps & { children?: ReactNode };

function InputAddon({ children, className, ...props }: InputAddonProps) {
  return (
    <view
      {...props}
      className={cn('h-full flex flex-row items-center shrink-0 gap-[6px]', className)}
    >
      {Children.map(children, (child) =>
        typeof child === 'string' || typeof child === 'number' ? (
          <text className="text-[12px] text-[#9ca6b2]">{child}</text>
        ) : (
          child
        ),
      )}
    </view>
  );
}

export function InputBeforeAddon({ className, ...props }: InputAddonProps) {
  return <InputAddon {...props} className={cn('pl-[10px] pr-[6px]', className)} />;
}

export function InputAfterAddon({ className, ...props }: InputAddonProps) {
  return <InputAddon {...props} className={cn('pl-[6px] pr-[10px]', className)} />;
}

export const inputVariants = cva(
  'w-full h-[34px] px-[10px] rounded-[6px] bg-[#14191f] border border-solid border-[#39444e] text-[13px] text-[#e2e8ed]',
  {
    variants: {
      disabled: { true: 'opacity-50', false: null },
      grouped: {
        true: 'flex-1 min-w-0 w-0 h-full rounded-none border-0 bg-transparent',
        false: null,
      },
      focused: { true: 'border-[#a8e6cf]', false: null },
    },
    defaultVariants: { disabled: false, grouped: false, focused: false },
  },
);

export interface InputProps extends Omit<NativeInputProps, 'ref' | 'bindinput'> {
  value: string;
  disabled?: boolean;
  onChange(value: string): void;
}

export function Input({
  value,
  disabled,
  onChange,
  className,
  bindfocus,
  bindblur,
  ...props
}: InputProps) {
  const group = useContext(InputGroupContext);
  const [focused, setFocused] = useState(false);
  const isDisabled = !!(disabled || group?.disabled);
  const inputRef = useRef<NodesRef>(null);
  const inputValue = useRef<string>();
  const setGroupFocused = group?.setFocused;
  useEffect(() => {
    if (isDisabled) {
      setFocused(false);
      setGroupFocused?.(false);
    }
    return () => setGroupFocused?.(false);
  }, [isDisabled, setGroupFocused]);
  useEffect(() => {
    if (!inputRef.current || inputValue.current === value) {
      return;
    }
    // Native input has no controlled value prop. Only write external changes;
    // echoing user input through setValue would move the caret and disrupt IME.
    inputValue.current = value;
    inputRef.current.invoke({ method: 'setValue', params: { value } }).exec();
  }, [value]);
  return (
    <input
      {...props}
      ref={inputRef}
      className={cn(
        inputVariants({
          disabled: isDisabled && !group?.disabled,
          grouped: !!group,
          focused: !group && focused && !isDisabled,
        }),
        className,
      )}
      disabled={isDisabled}
      readonly={isDisabled || props.readonly}
      bindfocus={(event) => {
        'background only';
        if (!isDisabled) {
          setFocused(true);
          setGroupFocused?.(true);
        }
        bindfocus?.(event);
      }}
      bindblur={(event) => {
        'background only';
        setFocused(false);
        setGroupFocused?.(false);
        bindblur?.(event);
      }}
      bindinput={(event) => {
        'background only';
        if (isDisabled || props.readonly || inputValue.current === event.detail.value) {
          return;
        }
        inputValue.current = event.detail.value;
        onChange(event.detail.value);
      }}
    />
  );
}
