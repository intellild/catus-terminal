import { Button } from './Button';
import { cn } from '../../lib/utils';
import {
  createContext,
  createPortal,
  useContext,
  useEffect,
  useRef,
  useState,
} from '@lynx-js/react';
import type { ReactNode } from '@lynx-js/react';
import type { CSSProperties, NodesRef, ViewProps } from '@lynx-js/types';
import {
  PopoverRoot,
  PopoverContext as LynxPopoverContext,
  PopoverAnchor,
  PopoverPositioner,
  PopoverContent as LynxPopoverContent,
} from '@lynx-js/lynx-ui-popover';

const PortalContext = createContext<{
  host: NodesRef | null;
  setActive: (update: (count: number) => number) => void;
} | null>(null);
const PopoverContext = createContext<{ open: boolean; setOpen(open: boolean): void } | null>(null);

// Portals preserve React context and escape the editor's scroll-view clipping.
// The host stays in this Lynx page; no native overlay window is required.
export function PopoverProvider({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<NodesRef>(null);
  const [host, setHost] = useState<NodesRef | null>(null);
  const [active, setActive] = useState(0);
  useEffect(() => setHost(ref.current), []);
  return (
    <PortalContext.Provider value={{ host, setActive }}>
      {children}
      <view
        ref={ref}
        flatten={false}
        id="popover-host"
        className={cn(
          active
            ? 'absolute inset-0 overflow-visible'
            : 'absolute left-0 top-0 w-0 h-0 overflow-visible',
          className,
        )}
      />
    </PortalContext.Provider>
  );
}

export function usePopover() {
  const context = useContext(PopoverContext);
  if (!context) throw new Error('Popover components require Popover');
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
    if (open === undefined) setInternalOpen(next);
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

export function PopoverTrigger({
  disabled = false,
  children,
  ...props
}: ViewProps & { disabled?: boolean; children?: ReactNode }) {
  const { open, setOpen } = usePopover();
  const { updateRects } = useContext(LynxPopoverContext);
  const ref = useRef<NodesRef>(null);
  const measure = (onMeasured?: () => void) => {
    // layoutchange's left/top are parent-relative in Clay. The portal uses
    // page coordinates, so query the trigger in the same coordinate space.
    ref.current
      ?.invoke({
        method: 'boundingClientRect',
        params: { relativeTo: 'screen' },
        success(result) {
          const rect = result as { left: number; top: number; width: number; height: number };
          updateRects({
            type: 'updateReference',
            rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
          });
          onMeasured?.();
        },
      })
      .exec();
  };
  return (
    <Button
      variant="ghost"
      disabled={disabled}
      {...props}
      ref={ref}
      bindlayoutchange={(event) => {
        props.bindlayoutchange?.(event);
        if (open) measure();
      }}
      bindtap={() => {
        if (disabled) return;
        if (open) setOpen(false);
        // Measure before mounting Positioner: it computes on entering, so a
        // later native response would otherwise leave the original coordinates.
        else measure(() => setOpen(true));
      }}
    >
      {children}
    </Button>
  );
}

export interface PopoverContentProps extends Omit<ViewProps, 'style'> {
  style?: CSSProperties;
  children?: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  dismissId?: string;
}

export function PopoverContent({
  children,
  side = 'bottom',
  align = 'start',
  sideOffset = 4,
  dismissId,
  className = '',
  style,
  ...props
}: PopoverContentProps) {
  const { sharedInfo } = useContext(LynxPopoverContext);
  const anchor = sharedInfo.alternativeReference ?? sharedInfo.reference;
  const portal = useContext(PortalContext);
  const { open, setOpen } = usePopover();
  const setActive = portal?.setActive;
  useEffect(() => {
    if (!open || !setActive) return;
    setActive((count) => count + 1);
    return () => setActive((count) => count - 1);
  }, [open, setActive]);
  if (!portal?.host) return null;
  return createPortal(
    <view
      className="absolute inset-0 [-x-app-region:no-drag]"
      style={{ display: open ? 'flex' : 'none' }}
    >
      {open ? (
        <view id={dismissId} className="absolute inset-0" bindtap={() => setOpen(false)} />
      ) : null}
      {/* Lynx UI positions relative to its anchor. Translate that origin into
          page coordinates when rendering in the page-level portal. */}
      <view
        className="absolute w-0 h-0 overflow-visible"
        style={{ left: `${anchor.x}px`, top: `${anchor.y}px` }}
      >
        <PopoverPositioner
          placement={align === 'center' ? side : `${side}-${align}`}
          placementOffset={sideOffset}
          autoAdjust="shift"
        >
          <LynxPopoverContent
            className={cn(
              'p-[5px] bg-[#20262d] border border-solid border-[#39444e] rounded-[8px]',
              className,
            )}
            style={style}
            popoverContentProps={{ flatten: false, ...props }}
          >
            {children}
          </LynxPopoverContent>
        </PopoverPositioner>
      </view>
    </view>,
    portal.host,
  );
}
