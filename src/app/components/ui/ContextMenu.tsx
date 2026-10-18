import { Button } from './Button';
import { cn } from '../../lib/utils';
import { cva } from 'class-variance-authority';
import { createContext, useContext, useState } from '@lynx-js/react';
import type { ComponentProps, ReactNode } from '@lynx-js/react';
import type { ViewProps } from '@lynx-js/types';
import {
  PopoverRoot,
  PopoverAnchor,
  PopoverPositioner,
  PopoverContent as LynxPopoverContent,
} from '@lynx-js/lynx-ui-popover';
import { PopoverOverlay } from './Popover';
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
  open: boolean;
  setOpen(open: boolean): void;
  trigger(point: { x: number; y: number }): void;
} | null>(null);

export function useContextMenu() {
  const context = useContext(MenuContext);
  if (!context) {
    throw new Error('ContextMenu components require ContextMenu');
  }
  return context;
}

export function ContextMenu({
  children,
  open,
  defaultOpen = false,
  onOpenChange,
}: {
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?(open: boolean): void;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const actualOpen = open ?? internalOpen;
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
        open: actualOpen,
        setOpen,
        trigger: (next) => {
          setPoint(next);
          setOpen(true);
        },
      }}
    >
      <PopoverRoot show={actualOpen} onVisibleChange={setOpen}>
        {children}
      </PopoverRoot>
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
  className,
  children,
  point,
  side = 'right',
  align = 'start',
  sideOffset = 2,
  dismissClassName,
  modal = true,
  interactive = true,
  style,
  ...props
}: PopoverContentProps & { point?: { x: number; y: number } }) {
  const context = useContextMenu();
  const anchor = point ?? context.point;
  return anchor ? (
    <>
      {modal && context.open ? (
        <PopoverOverlay className="fixed inset-0 z-40">
          <Button
            className={cn(
              'w-full h-full p-0 rounded-none bg-transparent hover:bg-transparent [-x-app-region:no-drag]',
              dismissClassName,
            )}
            bindtap={() => context.setOpen(false)}
          />
        </PopoverOverlay>
      ) : null}
      <ContextMenuAnchor point={anchor}>
        <PopoverPositioner
          placement={align === 'center' ? side : `${side}-${align}`}
          placementOffset={sideOffset}
          autoAdjust="shift"
        >
          <PopoverOverlay interactive={interactive}>
            <LynxPopoverContent
              className={cn(
                'w-[170px] p-[5px] bg-[#20262d] border border-solid border-[#39444e] rounded-[8px] [-x-app-region:no-drag]',
                className,
                !interactive && 'pointer-events-none',
              )}
              style={style}
              popoverContentProps={{
                flatten: false,
                ...props,
                ...(!interactive && { 'event-through': true }),
              }}
            >
              {children}
            </LynxPopoverContent>
          </PopoverOverlay>
        </PopoverPositioner>
      </ContextMenuAnchor>
    </>
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
  const { setOpen } = useContextMenu();
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
