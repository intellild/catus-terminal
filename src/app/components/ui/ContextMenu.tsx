import { Button } from './Button';
import { cn } from '../../lib/utils';
import { cva } from 'class-variance-authority';
import { createContext, useContext, useState } from '@lynx-js/react';
import type { ComponentProps, ReactNode } from '@lynx-js/react';
import type { ViewProps } from '@lynx-js/types';
import { Popover, PopoverAnchor, PopoverContent, usePopover } from './Popover';
import type { PopoverContentProps } from './Popover';

const contextMenuLabelVariants = cva('text-[13px]', {
  variants: {
    tone: {
      default: 'text-[#e2e8ed]',
      destructive: 'text-[#e4a4a4]',
      disabled: 'text-[#717b88]',
    },
  },
  defaultVariants: { tone: 'default' },
});

const MenuContext = createContext<{
  point: { x: number; y: number } | null;
  trigger(point: { x: number; y: number }): void;
} | null>(null);

export function ContextMenu({
  children,
  open,
  defaultOpen = false,
  delay,
  onOpenChange,
}: ComponentProps<typeof Popover>) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const setOpen = (next: boolean) => {
    if (open === undefined) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
  };
  return (
    <MenuContext.Provider
      value={{
        point,
        trigger: (next) => {
          setPoint(next);
          setOpen(true);
        },
      }}
    >
      <Popover open={open ?? internalOpen} delay={delay} onOpenChange={setOpen}>
        {children}
      </Popover>
    </MenuContext.Provider>
  );
}

// Can also dispatch a controlled menu in a separate business region.
export function useContextMenuTrigger(onContextMenu?: (point: { x: number; y: number }) => void) {
  const context = useContext(MenuContext);
  const onMouseDown: NonNullable<ViewProps['bindmousedown']> = (event) => {
    // Clay supplies the pressed-button bit mask; button can remain 0.
    if (event.button !== 2 && (event.buttons & 2) === 0) {
      return;
    }
    const point = { x: event.pageX, y: event.pageY };
    if (onContextMenu) {
      onContextMenu(point);
    } else if (context) {
      context.trigger(point);
    } else {
      throw new Error('useContextMenuTrigger requires ContextMenu or a callback');
    }
  };
  return { onMouseDown };
}

export function ContextMenuAnchor({
  point,
  className,
  style,
  ...props
}: ComponentProps<typeof PopoverAnchor> & { point: { x: number; y: number } }) {
  return (
    <PopoverAnchor
      {...props}
      className={cn('fixed w-[1px] h-[1px] overflow-visible z-50', className)}
      style={{ left: `${point.x}px`, top: `${point.y}px`, ...style }}
    />
  );
}

export function ContextMenuContent({
  className = '',
  point,
  ...props
}: PopoverContentProps & { point?: { x: number; y: number } }) {
  const context = useContext(MenuContext);
  const anchor = point ?? context?.point;
  return anchor ? (
    <ContextMenuAnchor point={anchor}>
      <PopoverContent
        side="right"
        sideOffset={2}
        {...props}
        className={cn('w-[170px]', className)}
      />
    </ContextMenuAnchor>
  ) : null;
}

export function ContextMenuItem({
  children,
  onSelect,
  disabled = false,
  destructive = false,
  closeOnSelect = true,
  className = '',
  ...props
}: ViewProps & {
  children?: ReactNode;
  onSelect(): void;
  disabled?: boolean;
  destructive?: boolean;
  closeOnSelect?: boolean;
}) {
  const { setOpen } = usePopover();
  return (
    <Button
      variant="ghost"
      disabled={disabled}
      {...props}
      className={cn(
        'h-auto justify-start py-[10px] px-[12px] rounded-[5px] font-normal',
        destructive && !disabled && 'hover:bg-[#59343c]',
        className,
      )}
      bindtap={() => {
        if (disabled) {
          return;
        }
        onSelect();
        if (closeOnSelect) {
          setOpen(false);
        }
      }}
    >
      <text
        className={contextMenuLabelVariants({
          tone: disabled ? 'disabled' : destructive ? 'destructive' : 'default',
        })}
      >
        {children}
      </text>
    </Button>
  );
}

export function ContextMenuSeparator({ className, ...props }: ViewProps = {}) {
  return <view {...props} className={cn('h-[1px] bg-[#39444e] my-[4px]', className)} />;
}
