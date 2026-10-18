import * as Atom from 'effect/reactivity/Atom';
import * as Effect from 'effect/Effect';

export interface PopoverOptions {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?(open: boolean): void;
}

export interface PopoverPoint {
  x: number;
  y: number;
}

export type MeasurePopover = (isCurrent: () => boolean, onMeasured: () => void) => void;

// These are presentation atoms, independent of React and business/session atoms.
// Each registry owns its controller and interrupts its effects on reset/dispose.
export function makePopoverState(defaultOpen = false, options: () => PopoverOptions = () => ({})) {
  const openAtom = Atom.make(defaultOpen);
  const pointAtom = Atom.make<PopoverPoint | null>(null);
  const interactionAtom = Atom.make<{ click: object | null; hover: object | null }>({
    click: null,
    hover: null,
  });
  const controllerAtom = Atom.make((get) => {
    const registry = get.registry;
    let active = true;
    get.mount(openAtom);
    get.mount(pointAtom);
    get.mount(interactionAtom);
    get.addFinalizer(() => {
      active = false;
    });
    const isOpen = () => options().open ?? registry.get(openAtom);
    const applyOpen = (next: boolean) => {
      if (!active) {
        return;
      }
      const props = options();
      if (props.open === undefined) {
        registry.set(openAtom, next);
      }
      props.onOpenChange?.(next);
    };
    const delayAtom = Atom.fn<{ open: boolean; milliseconds: number }>()((request) =>
      Effect.sleep(request.milliseconds).pipe(
        Effect.andThen(Effect.sync(() => applyOpen(request.open))),
      ),
    ).pipe(Atom.setIdleTTL(0));
    get.mount(delayAtom);
    const cancelDelay = () => registry.set(delayAtom, Atom.Interrupt);
    const cancelClick = () => {
      if (active) {
        registry.update(interactionAtom, (state) => ({ ...state, click: null }));
      }
    };
    const cancelHover = () => {
      if (active) {
        cancelDelay();
        registry.update(interactionAtom, (state) => ({ ...state, hover: null }));
      }
    };
    const sync = () => {
      cancelClick();
      cancelHover();
    };
    const setOpen = (next: boolean) => {
      if (active) {
        sync();
        applyOpen(next);
      }
    };
    const schedule = (next: boolean, delay: number) => {
      cancelDelay();
      if (next === isOpen()) {
        return;
      }
      const milliseconds = Math.max(0, delay);
      if (milliseconds === 0) {
        applyOpen(next);
      } else {
        registry.set(delayAtom, { open: next, milliseconds });
      }
    };
    const measureClick = (measure: MeasurePopover, opening: boolean) => {
      const request = {};
      registry.update(interactionAtom, (state) => ({ ...state, click: request }));
      const isCurrent = () => active && registry.get(interactionAtom).click === request;
      measure(isCurrent, () => {
        if (isCurrent()) {
          cancelClick();
          if (opening) {
            setOpen(true);
          }
        }
      });
    };
    return {
      setOpen,
      sync,
      cancelClick,
      cancelHover,
      click(measure: MeasurePopover, disabled = false) {
        if (!active || disabled) {
          return;
        }
        if (isOpen() || registry.get(interactionAtom).click) {
          setOpen(false);
        } else {
          cancelHover();
          measureClick(measure, true);
        }
      },
      layout(measure: MeasurePopover, disabled = false) {
        if (active && !disabled && isOpen() && !registry.get(interactionAtom).click) {
          measureClick(measure, false);
        }
      },
      enter(measure: MeasurePopover, delay = 100) {
        if (!active || registry.get(interactionAtom).hover) {
          return;
        }
        cancelDelay();
        const request = {};
        registry.update(interactionAtom, (state) => ({ ...state, hover: request }));
        const isCurrent = () => active && registry.get(interactionAtom).hover === request;
        measure(isCurrent, () => {
          if (isCurrent()) {
            schedule(true, delay);
          }
        });
      },
      leave(delay = 100) {
        if (active) {
          cancelHover();
          schedule(false, delay);
        }
      },
      trigger(point: PopoverPoint) {
        if (active) {
          registry.set(pointAtom, point);
          setOpen(true);
        }
      },
    };
  }).pipe(Atom.setIdleTTL(0));
  return { openAtom, pointAtom, controllerAtom };
}

export type PopoverController = Atom.Type<ReturnType<typeof makePopoverState>['controllerAtom']>;
