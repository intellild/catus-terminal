import { delayPopover } from './popoverDelay';
import { Button } from './Button';
import { cn } from '../../lib/utils';
import { createContext, useContext, useEffect, useRef, useState } from '@lynx-js/react';
import type { ReactNode } from '@lynx-js/react';
import type { CSSProperties, NodesRef, ViewProps } from '@lynx-js/types';
import {
  PopoverRoot,
  PopoverContext as LynxPopoverContext,
  PopoverAnchor,
  PopoverPositioner,
  PopoverContent as LynxPopoverContent,
} from '@lynx-js/lynx-ui-popover';

const PopoverContext = createContext<{
  open: boolean;
  setOpen(open: boolean): void;
} | null>(null);

export function usePopover() {
  const context = useContext(PopoverContext);
  if (!context) {
    throw new Error('Popover components require Popover');
  }
  return context;
}

export function Popover({
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
  const setOpen = (next: boolean) => {
    if (open === undefined) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
  };
  return (
    <PopoverContext.Provider value={{ open: actualOpen, setOpen }}>
      <PopoverRoot show={actualOpen} onVisibleChange={setOpen}>
        {children}
      </PopoverRoot>
    </PopoverContext.Provider>
  );
}

export { PopoverAnchor };

function usePopoverReference() {
  const { updateRects } = useContext(LynxPopoverContext);
  const ref = useRef<NodesRef>(null);
  const measure = (isCurrent: () => boolean, onMeasured: () => void) => {
    // Viewport coordinates are used by Lynx UI when checking available space.
    ref.current
      ?.invoke({
        method: 'boundingClientRect',
        params: {},
        success(result) {
          if (!isCurrent()) {
            return;
          }
          const rect = result as { left: number; top: number; width: number; height: number };
          updateRects({
            type: 'updateReference',
            rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
          });
          onMeasured();
        },
      })
      .exec();
  };
  return { ref, measure };
}

export function usePopoverClickTrigger({ disabled = false }: { disabled?: boolean } = {}) {
  const { open, setOpen } = usePopover();
  const { ref, measure } = usePopoverReference();
  const pending = useRef<object | null>(null);
  useEffect(
    () => () => {
      pending.current = null;
    },
    [],
  );
  const close = () => {
    pending.current = null;
    setOpen(false);
  };
  const onTap = () => {
    if (disabled) {
      return;
    }
    if (open || pending.current) {
      close();
      return;
    }
    const request = {};
    pending.current = request;
    measure(
      () => pending.current === request,
      () => {
        pending.current = null;
        setOpen(true);
      },
    );
  };
  const onLayoutChange = () => {
    if (!open || disabled || pending.current) {
      return;
    }
    const request = {};
    pending.current = request;
    measure(
      () => pending.current === request,
      () => {
        pending.current = null;
      },
    );
  };
  return { ref, onTap, onLayoutChange, close };
}

export function usePopoverHoverTrigger({ delay = 100 }: { delay?: number } = {}) {
  const { open, setOpen } = usePopover();
  const { ref, measure } = usePopoverReference();
  const visit = useRef<object | null>(null);
  const interrupt = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      visit.current = null;
      interrupt.current?.();
    },
    [],
  );
  const cancel = () => {
    interrupt.current?.();
    interrupt.current = null;
  };
  const schedule = (next: boolean) => {
    cancel();
    if (next === open) {
      return;
    }
    const wait = Math.max(0, delay);
    if (wait === 0) {
      setOpen(next);
      return;
    }
    interrupt.current = delayPopover(wait, () => {
      interrupt.current = null;
      setOpen(next);
    });
  };
  const close = () => {
    visit.current = null;
    cancel();
    setOpen(false);
  };
  const onMouseLeave = () => {
    visit.current = null;
    schedule(false);
  };
  const onMouseEnter = () => {
    // One measurement per visit; delayed results cannot reopen a closed popover.
    if (visit.current) {
      return;
    }
    cancel();
    const request = {};
    visit.current = request;
    measure(
      () => visit.current === request,
      () => schedule(true),
    );
  };
  return { ref, onMouseEnter, onMouseLeave, close };
}

export interface PopoverContentProps extends Omit<ViewProps, 'style'> {
  style?: CSSProperties;
  children?: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  dismissClassName?: string;
  modal?: boolean;
  interactive?: boolean;
}

export function PopoverOverlay({
  children,
  interactive = true,
  className,
  ...props
}: ViewProps & { children?: ReactNode; interactive?: boolean }) {
  return (
    <cover-view
      {...props}
      className={cn('overflow-visible', className)}
      events-pass-through={!interactive}
    >
      {children}
    </cover-view>
  );
}

export function PopoverContent({
  children,
  side = 'bottom',
  align = 'start',
  sideOffset = 4,
  dismissClassName,
  modal = true,
  interactive = true,
  className = '',
  style,
  ...props
}: PopoverContentProps) {
  const { open, setOpen } = usePopover();
  return (
    <>
      {modal && open ? (
        <PopoverOverlay className="fixed inset-0 z-40">
          <Button
            className={cn(
              'w-full h-full p-0 rounded-none bg-transparent hover:bg-transparent [-x-app-region:no-drag]',
              dismissClassName,
            )}
            bindtap={() => setOpen(false)}
          />
        </PopoverOverlay>
      ) : null}
      <PopoverPositioner
        placement={align === 'center' ? side : `${side}-${align}`}
        placementOffset={sideOffset}
        autoAdjust="shift"
        popoverPositionerProps={{
          className: cn('z-50', !interactive && 'pointer-events-none'),
          ...(!interactive && { 'event-through': true }),
        }}
      >
        <PopoverOverlay interactive={interactive}>
          <LynxPopoverContent
            className={cn(
              'p-[5px] bg-[#20262d] border border-solid border-[#39444e] rounded-[8px] [-x-app-region:no-drag]',
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
    </>
  );
}
