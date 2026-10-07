import { cn } from '../../lib/utils';
import { cva } from 'class-variance-authority';
import { Input as LynxInput } from '@lynx-js/lynx-ui-input';
import type { InputProps as LynxInputProps } from '@lynx-js/lynx-ui-input';

export type { InputRef } from '@lynx-js/lynx-ui-input';

export const inputVariants = cva(
  'w-full h-[34px] px-[10px] rounded-[6px] bg-[#14191f] border border-solid border-[#39444e] text-[13px] text-[#e2e8ed]',
  {
    variants: { disabled: { true: 'opacity-50', false: null } },
    defaultVariants: { disabled: false },
  },
);

export interface InputProps extends Omit<LynxInputProps, 'value' | 'onInput'> {
  value: string;
  disabled?: boolean;
  onChange(value: string): void;
}

export function Input({ value, disabled, onChange, className, ...props }: InputProps) {
  return (
    <LynxInput
      {...props}
      className={cn(inputVariants({ disabled }), className)}
      value={value}
      readonly={disabled || props.readonly}
      onInput={(value) => {
        'background only';
        if (disabled || props.readonly) {
          return;
        }
        onChange(value);
      }}
    />
  );
}
