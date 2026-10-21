import type { SVGProps } from '@lynx-js/types';
import { cn } from '../../lib/utils';
import { iconSvgs } from './icons';
import type { IconName } from './icons';

export interface IconProps extends Omit<SVGProps, 'content' | 'src' | 'style'> {
  name: IconName;
  /** Square icon size in px. */
  size?: number;
  /** Stroke color; Lucide's `currentColor` is resolved to this value. */
  color?: string;
  strokeWidth?: number;
}

export function Icon({
  name,
  size = 16,
  color = '#e2e8ed',
  strokeWidth = 2,
  className,
  ...props
}: IconProps) {
  return (
    <svg
      {...props}
      content={renderIcon(name, color, strokeWidth)}
      className={cn('shrink-0', className)}
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  );
}

function renderIcon(name: IconName, color: string, strokeWidth: number): string {
  // `current-color` is not available on every host, so bake the resolved color
  // and width into the source string instead of relying on CSS.
  return iconSvgs[name]
    .replace(/\sclass="[^"]*"/, '')
    .replace(/\swidth="24"/, '')
    .replace(/\sheight="24"/, '')
    .replace(/currentColor/g, () => color)
    .replace(/stroke-width="[^"]*"/, `stroke-width="${strokeWidth}"`);
}
