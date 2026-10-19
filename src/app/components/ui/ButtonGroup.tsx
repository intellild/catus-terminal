// Copyright (c) 2023 shadcn; MIT license: licenses/SHADCN-MIT.txt
// Adapted from shadcn/ui Button Group (MIT) for Lynx composition.
// https://ui.shadcn.com/docs/components/button-group
import { Children } from '@lynx-js/react';
import type { ReactNode } from '@lynx-js/react';
import type { ViewProps } from '@lynx-js/types';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

export const buttonGroupVariants = cva('flex w-fit items-stretch', {
  variants: {
    orientation: {
      horizontal: 'flex-row',
      vertical: 'flex-col',
    },
  },
  defaultVariants: { orientation: 'horizontal' },
});

type ButtonGroupProps = ViewProps &
  VariantProps<typeof buttonGroupVariants> & { children?: ReactNode };

export function ButtonGroup({ className, orientation, children, ...props }: ButtonGroupProps) {
  return (
    <view
      {...props}
      accessibility-element
      accessibility-role-description="group"
      className={cn(buttonGroupVariants({ orientation }), className)}
    >
      {Children.map(children, (child) =>
        typeof child === 'string' || typeof child === 'number' ? <text>{child}</text> : child,
      )}
    </view>
  );
}

export function ButtonGroupText({
  className,
  children,
  ...props
}: ViewProps & { children?: ReactNode }) {
  return (
    <view
      {...props}
      className={cn(
        'flex flex-row items-center px-[10px] bg-[#14191f] border border-solid border-[#39444e]',
        className,
      )}
    >
      {Children.map(children, (child) =>
        typeof child === 'string' || typeof child === 'number' ? (
          <text className="text-[12px] font-medium text-[#c3cdd6]">{child}</text>
        ) : (
          child
        ),
      )}
    </view>
  );
}

const separatorVariants = cva('shrink-0 bg-[#39444e]', {
  variants: {
    orientation: {
      vertical: 'w-[1px] self-stretch my-[5px]',
      horizontal: 'h-[1px] self-stretch mx-[5px]',
    },
  },
  defaultVariants: { orientation: 'vertical' },
});

export function ButtonGroupSeparator({
  className,
  orientation,
  ...props
}: ViewProps & VariantProps<typeof separatorVariants>) {
  return (
    <view
      {...props}
      accessibility-element={false}
      className={cn(separatorVariants({ orientation }), className)}
    />
  );
}
