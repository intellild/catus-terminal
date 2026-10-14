import { useEffect, useRef, useState } from '@lynx-js/react';
import type { MouseEvent, TouchEvent } from '@lynx-js/types';
import { cn } from '../../lib/utils';
import { scrollbarGeometry, scrollbarOffset } from './scrollbarGeometry';

// Twelve logical pixels also define the AppKit overlay exclusion strip.
export function ScrollBar({
  'data-automation-id': automationId,
  offset,
  historyRows,
  visibleRows,
  onOffsetChange,
  className,
  resetKey,
}: {
  'data-automation-id': string;
  offset: number;
  historyRows: number;
  visibleRows: number;
  onOffsetChange(offset: number): void;
  className?: string;
  resetKey?: number;
}) {
  const [height, setHeight] = useState(0);
  const pressed = useRef(false);
  const bounds = useRef<{ top: number; height: number }>();
  const press = useRef<object>();
  const drag = useRef<{ y: number; top: number; travel: number; history: number }>();
  const last = useRef<number>();
  const geometry = scrollbarGeometry(height, visibleRows, historyRows, offset);
  useEffect(() => {
    end();
  }, [resetKey, historyRows === 0]);
  function end() {
    pressed.current = false;
    press.current = undefined;
    drag.current = undefined;
    last.current = undefined;
  }
  function emit(value: number) {
    if (value !== last.current) {
      last.current = value;
      onOffsetChange(value);
    }
  }
  function begin(y: number, thumb: boolean) {
    'background only';
    if (!Number.isFinite(y) || historyRows <= 0) {
      return;
    }
    pressed.current = true;
    const token = {};
    press.current = token;
    const start = (rect: { top: number; height: number }) => {
      if (!pressed.current || press.current !== token || rect.height <= 0) {
        return;
      }
      const current = scrollbarGeometry(rect.height, visibleRows, historyRows, offset);
      const top = thumb
        ? current.top
        : Math.max(0, Math.min(current.travel, y - rect.top - current.thumb / 2));
      drag.current = { y, top, travel: current.travel, history: historyRows };
      if (!thumb) {
        emit(scrollbarOffset(top, current.travel, historyRows));
      }
    };
    if (bounds.current) {
      start(bounds.current);
    } else {
      measure(start);
    }
  }
  function measure(callback?: (rect: { top: number; height: number }) => void) {
    'background only';
    lynx
      .createSelectorQuery()
      .select(`[data-automation-id=${automationId}]`)
      .invoke({
        method: 'boundingClientRect',
        success: (value) => {
          const rect = value as { top: number; height: number } | undefined;
          if (rect && rect.height > 0) {
            bounds.current = rect;
            callback?.(rect);
          }
        },
      })
      .exec();
  }
  function move(y: number) {
    const current = drag.current;
    if (current && Number.isFinite(y)) {
      emit(scrollbarOffset(current.top + y - current.y, current.travel, current.history));
    }
  }
  function mouseDown(event: MouseEvent, thumb: boolean) {
    if (event.buttons & 1) {
      begin(event.pageY, thumb);
    }
  }
  function touchY(event: TouchEvent) {
    return event.changedTouches[0]?.pageY ?? event.touches[0]?.pageY;
  }
  return (
    <view
      data-automation-id={automationId}
      data-offset={offset}
      data-history={historyRows}
      className={cn(
        'absolute right-0 top-0 bottom-0 w-[12px] z-[10] [-x-app-region:no-drag]',
        historyRows <= 0 ? 'hidden' : '',
        className,
      )}
      bindlayoutchange={(event) => {
        setHeight(event.detail.height);
        measure();
      }}
      catchmousedown={(event) => mouseDown(event, false)}
      catchtouchstart={(event) => begin(touchY(event), false)}
      global-bindmousemove={(event) => {
        if (pressed.current && !(event.buttons & 1)) {
          end();
        } else {
          move(event.pageY);
        }
      }}
      global-bindmouseup={end}
      global-bindtouchmove={(event) => move(touchY(event))}
      global-bindtouchend={end}
      global-bindtouchcancel={end}
    >
      <view
        data-automation-id={`${automationId}-thumb`}
        className="absolute left-[3px] right-[3px] top-[var(--scrollbar-top)] h-[var(--scrollbar-height)] rounded-full bg-[#65717f]/60 hover:bg-[#8996a5]"
        style={`--scrollbar-top: ${geometry.top}px; --scrollbar-height: ${geometry.thumb}px`}
        catchmousedown={(event) => mouseDown(event, true)}
        catchtouchstart={(event) => begin(touchY(event), true)}
      />
    </view>
  );
}
