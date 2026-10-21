import { Checkbox as LynxCheckbox, CheckboxIndicator } from '@lynx-js/lynx-ui-checkbox';
import type { CheckboxProps as LynxCheckboxProps } from '@lynx-js/lynx-ui-checkbox';
import type { ReactNode } from '@lynx-js/react';
import type { ViewProps } from '@lynx-js/types';
import { cn } from '../../lib/utils';

export interface CheckboxProps extends Omit<ViewProps, 'children' | 'bindtap' | 'style'> {
  style?: LynxCheckboxProps['style'];
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  indeterminate?: boolean;
  onCheckedChange?: LynxCheckboxProps['onChange'];
  children?: ReactNode;
}

export function Checkbox({
  checked,
  defaultChecked,
  disabled,
  indeterminate,
  onCheckedChange,
  children,
  className,
  style,
  ...props
}: CheckboxProps) {
  return (
    <LynxCheckbox
      checked={checked}
      defaultChecked={defaultChecked}
      disabled={disabled}
      indeterminate={indeterminate}
      onChange={onCheckedChange}
      checkboxProps={props}
      style={style}
      className={cn(
        'flex flex-row items-center gap-[8px] cursor-pointer [-x-app-region:no-drag]',
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      <CheckboxIndicator className="w-[16px] h-[16px] shrink-0 flex items-center justify-center rounded-[4px] border border-solid border-[#52616c] bg-[#14191f] ui-checked:bg-[#a8e6cf] ui-checked:border-[#a8e6cf] ui-indeterminate:bg-[#a8e6cf]">
        <text className="text-[12px] text-[#20392f]">{indeterminate ? '−' : '✓'}</text>
      </CheckboxIndicator>
      {children}
    </LynxCheckbox>
  );
}
