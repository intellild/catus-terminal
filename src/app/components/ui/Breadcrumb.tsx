// Copyright (c) 2023 shadcn; MIT license: licenses/SHADCN-MIT.txt
// Adapted from shadcn/ui Breadcrumb (MIT) for Lynx elements and tap navigation.
// https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/breadcrumb.tsx
import type { ReactNode } from '@lynx-js/react';
import type { TextProps, ViewProps } from '@lynx-js/types';
import { Button } from './Button';
import type { ButtonProps } from './Button';
import { cn } from '../../lib/utils';

type BreadcrumbViewProps = ViewProps & { children?: ReactNode };
type BreadcrumbTextProps = TextProps & { children?: ReactNode };

export function Breadcrumb({ children, className, ...props }: BreadcrumbViewProps) {
  return (
    <view {...props} className={cn('min-w-0', className)}>
      {children}
    </view>
  );
}
export function BreadcrumbList({ children, className, ...props }: BreadcrumbViewProps) {
  return (
    <view {...props} className={cn('flex flex-row items-center gap-[6px]', className)}>
      {children}
    </view>
  );
}
export function BreadcrumbItem({ children, className, ...props }: BreadcrumbViewProps) {
  return (
    <view {...props} className={cn('min-w-0 flex flex-row items-center', className)}>
      {children}
    </view>
  );
}
export function BreadcrumbLink({ className, ...props }: ButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      {...props}
      className={cn('h-[28px] min-w-0 px-[6px] text-[#8c99a7] hover:text-[#e2e8ed]', className)}
    />
  );
}
export function BreadcrumbPage({ children, className, ...props }: BreadcrumbTextProps) {
  return (
    <text
      {...props}
      className={cn(
        'text-[12px] text-[#e2e8ed] whitespace-nowrap overflow-hidden text-ellipsis',
        className,
      )}
    >
      {children}
    </text>
  );
}
export function BreadcrumbSeparator({ children, className, ...props }: BreadcrumbTextProps) {
  return (
    <text
      {...props}
      accessibility-element={false}
      className={cn('text-[12px] text-[#8c99a7]', className)}
    >
      {children ?? '›'}
    </text>
  );
}
export function BreadcrumbEllipsis({ className, ...props }: BreadcrumbTextProps) {
  return (
    <text {...props} className={cn('text-[12px] text-[#8c99a7] px-[6px]', className)}>
      …
    </text>
  );
}
