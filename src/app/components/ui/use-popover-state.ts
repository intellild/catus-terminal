import { useAtomValue } from '@effect/atom-react';
import { useEffect, useMemo, useRef } from '@lynx-js/react';
import { makePopoverState } from './popover-state';
import type { PopoverOptions } from './popover-state';

// Only the latest external props live in a ref. Mutable interaction state and
// pending work belong to the Effect registry, not React hooks.
export function usePopoverState(options: PopoverOptions) {
  const props = useRef(options);
  props.current = options;
  const state = useMemo(() => makePopoverState(options.defaultOpen, () => props.current), []);
  const controller = useAtomValue(state.controllerAtom);
  const internalOpen = useAtomValue(state.openAtom);
  const point = useAtomValue(state.pointAtom);
  useEffect(() => controller.sync(), [controller, options.open]);
  return { open: options.open ?? internalOpen, point, controller, setOpen: controller.setOpen };
}
