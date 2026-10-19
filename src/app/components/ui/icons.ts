// Lucide ships the same icons as SVG strings in `lucide-static` (ISC).
// ReactLynx renders them through the native <svg content> element, so the
// string form fits both runtimes without a DOM dependency.
// https://lucide.dev/guide/packages/lucide-static
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Download,
  ExternalLink,
  File,
  Folder,
  Link,
  LoaderCircle,
  PanelsTopLeft,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Settings,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-static';

// Import icons one by one so the bundle only carries the icons the UI uses.
export const iconSvgs = {
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'circle-alert': CircleAlert,
  download: Download,
  'external-link': ExternalLink,
  file: File,
  folder: Folder,
  link: Link,
  'loader-circle': LoaderCircle,
  'panels-top-left': PanelsTopLeft,
  pencil: Pencil,
  plus: Plus,
  'refresh-cw': RefreshCw,
  server: Server,
  settings: Settings,
  'square-terminal': SquareTerminal,
  'trash-2': Trash2,
  x: X,
} as const;

export type IconName = keyof typeof iconSvgs;
