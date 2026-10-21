import { Children, forwardRef } from '@lynx-js/react';
import type { ReactNode } from '@lynx-js/react';
import type { NodesRef, ViewProps } from '@lynx-js/types';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

export const buttonVariants = cva(
  'flex flex-row items-center justify-center gap-[8px] shrink-0 rounded-[6px] text-[12px] font-medium cursor-pointer [-x-app-region:no-drag]',
  {
    variants: {
      variant: {
        default: 'bg-[#a8e6cf] text-[#20392f]',
        destructive: 'bg-[#863d46] text-[#fff0f0]',
        outline: 'border border-solid border-[#39444e] bg-[#14191f] text-[#e2e8ed]',
        secondary: 'bg-[#22262c] text-[#c3cdd6]',
        ghost: 'bg-transparent text-[#c3cdd6]',
        link: 'bg-transparent text-[#a8e6cf]',
      },
      size: {
        default: 'h-[36px] px-[16px]',
        sm: 'h-[32px] px-[12px]',
        lg: 'h-[40px] px-[20px]',
        icon: 'w-[36px] h-[36px] p-0',
        'icon-sm': 'w-[28px] h-[28px] p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

const buttonHoverVariants = cva('', {
  variants: {
    variant: {
      default: 'hover:bg-[#91d4b9]',
      destructive: 'hover:bg-[#a04b56]',
      outline: 'hover:bg-[#2b333c]',
      secondary: 'hover:bg-[#343d47]',
      ghost: 'hover:bg-[#343d47]',
      link: 'hover:bg-[#263b33] hover:underline',
    },
  },
  defaultVariants: { variant: 'default' },
});

export type ButtonProps = ViewProps &
  VariantProps<typeof buttonVariants> & {
    children?: ReactNode;
    disabled?: boolean;
  };

// Forward the native ref so composed triggers can measure their hit target.
export const Button = forwardRef<NodesRef, ButtonProps>(function Button(
  { children, variant, size, disabled = false, className, bindtap, catchtap, ...props },
  ref,
) {
  return (
    <view
      accessibility-element
      accessibility-traits={disabled ? 'disabled' : 'button'}
      {...props}
      ref={ref}
      className={cn(
        buttonVariants({ variant, size }),
        !disabled && buttonHoverVariants({ variant }),
        className,
        disabled && 'opacity-50 cursor-not-allowed',
      )}
      // Keep the handler attached in the main-thread fallback even before BTS
      // supplies its action; conditional binding loses it during hydration.
      bindtap={
        catchtap
          ? undefined
          : (event) => {
              if (!disabled) {
                bindtap?.(event);
              }
            }
      }
      catchtap={
        catchtap
          ? (event) => {
              if (!disabled) {
                catchtap(event);
              }
            }
          : undefined
      }
    >
      {Children.map(children, (child) =>
        typeof child === 'string' || typeof child === 'number' ? <text>{child}</text> : child,
      )}
    </view>
  );
});
