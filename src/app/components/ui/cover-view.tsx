import { createContext } from '@lynx-js/react';
import type { ReactNode } from '@lynx-js/react';
import type { ViewProps } from '@lynx-js/types';
import { cn } from '../../lib/utils';

export const CoverViewContext = createContext(false);

export function CoverView({
  children,
  interactive = true,
  className,
  ...props
}: ViewProps & { children?: ReactNode; interactive?: boolean }) {
  return (
    <CoverViewContext.Provider value={true}>
      <cover-view
        {...props}
        className={cn('overflow-visible', className)}
        events-pass-through={!interactive}
      >
        {children}
      </cover-view>
    </CoverViewContext.Provider>
  );
}
