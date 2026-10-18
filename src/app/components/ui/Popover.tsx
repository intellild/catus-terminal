import { usePopoverState } from './usePopoverState';
import type { PopoverController } from './popoverState';
import { Button } from './Button';
import { cn } from '../../lib/utils';
import { createContext, useContext, useEffect, useRef } from '@lynx-js/react';
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
  controller: PopoverController;
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
  const state = usePopoverState({ open, defaultOpen, onOpenChange });
  return (
    <PopoverContext.Provider value={state}>
      <PopoverRoot show={state.open} onVisibleChange={state.setOpen}>
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
  const { controller } = usePopover();
  const { ref, measure } = usePopoverReference();
  useEffect(() => () => controller.cancelClick(), [controller]);
  return {
    ref,
    onTap: () => controller.click(measure, disabled),
    onLayoutChange: () => controller.layout(measure, disabled),
    close: () => controller.setOpen(false),
  };
}

export function usePopoverHoverTrigger({ delay = 100 }: { delay?: number } = {}) {
  const { controller } = usePopover();
  const { ref, measure } = usePopoverReference();
  useEffect(() => () => controller.cancelHover(), [controller]);
  return {
    ref,
    onMouseEnter: () => controller.enter(measure, delay),
    onMouseLeave: () => controller.leave(delay),
    close: () => controller.setOpen(false),
  };
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
