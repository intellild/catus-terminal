import { Button } from './Button';
import { cn } from '../../lib/utils';
import { cva } from 'class-variance-authority';
import { Children, createContext, useContext, useState } from '@lynx-js/react';
import type { ReactNode } from '@lynx-js/react';
import type { ViewProps } from '@lynx-js/types';
import { Popover, PopoverContent, PopoverTrigger, usePopover } from './Popover';
import type { PopoverContentProps } from './Popover';

export const selectTriggerVariants = cva(
  'w-full h-[34px] px-[10px] rounded-[6px] bg-[#14191f] border border-solid border-[#39444e] flex flex-row items-center justify-between font-normal',
  {
    variants: { disabled: { true: 'opacity-50', false: null } },
    defaultVariants: { disabled: false },
  },
);

export const selectItemVariants = cva(
  'flex flex-row items-center h-[36px] px-[10px] rounded-[5px]',
  {
    variants: {
      selected: { true: 'bg-[#35483f]', false: null },
      disabled: { true: 'opacity-50', false: null },
    },
    defaultVariants: { selected: false, disabled: false },
  },
);

interface SelectState {
  value: string;
  disabled: boolean;
  width: number;
  setWidth(width: number): void;
  onValueChange(value: string): void;
}
const SelectContext = createContext<SelectState | null>(null);
function useSelect() {
  const context = useContext(SelectContext);
  if (!context) throw new Error('Select components require Select');
  return context;
}

export function Select({
  children,
  value,
  onValueChange,
  disabled = false,
}: {
  children: ReactNode;
  value: string;
  onValueChange(value: string): void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(260);
  return (
    <SelectContext.Provider value={{ value, onValueChange, disabled, width, setWidth }}>
      <Popover open={open && !disabled} onOpenChange={setOpen}>
        {children}
      </Popover>
    </SelectContext.Provider>
  );
}

export function SelectTrigger({
  children,
  className = '',
  ...props
}: ViewProps & { children?: ReactNode }) {
  const { disabled, setWidth } = useSelect();
  const { open } = usePopover();
  return (
    <PopoverTrigger
      {...props}
      disabled={disabled}
      className={cn(selectTriggerVariants({ disabled }), className)}
      bindlayoutchange={(event) => setWidth(event.detail.width)}
    >
      {children}
      <text className="text-[12px] text-[#9ca6b2]">{open ? '▴' : '▾'}</text>
    </PopoverTrigger>
  );
}

export function SelectValue({
  children,
  placeholder,
}: {
  children?: ReactNode;
  placeholder?: string;
}) {
  const { value } = useSelect();
  return (
    <text className="text-[13px] text-[#e2e8ed] flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
      {children ?? (value || placeholder)}
    </text>
  );
}

export function SelectContent({ children, ...props }: PopoverContentProps) {
  const { width } = useSelect();
  return (
    <PopoverContent {...props} style={{ width: `${width}px`, ...props.style }}>
      <scroll-view scroll-y style={{ height: `${Math.min(220, Children.count(children) * 36)}px` }}>
        <view className="flex flex-col">{children}</view>
      </scroll-view>
    </PopoverContent>
  );
}

export function SelectItem({
  value,
  disabled = false,
  children,
  className = '',
  ...props
}: ViewProps & {
  value: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const select = useSelect();
  const { setOpen } = usePopover();
  const selected = select.value === value;
  return (
    <Button
      variant="ghost"
      disabled={disabled || select.disabled}
      {...props}
      className={cn(
        selectItemVariants({ selected, disabled: false }),
        'justify-start gap-0 font-normal',
        className,
      )}
      bindtap={() => {
        if (disabled || select.disabled) return;
        select.onValueChange(value);
        setOpen(false);
      }}
    >
      <text className="w-[18px] text-[12px] text-[#a8e6cf]">{selected ? '✓' : ''}</text>
      <text className="text-[13px] text-[#e2e8ed] flex-1 whitespace-nowrap overflow-hidden text-ellipsis">
        {children}
      </text>
    </Button>
  );
}
