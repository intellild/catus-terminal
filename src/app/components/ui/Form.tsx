import { Button } from './Button';
import type { ButtonProps } from './Button';
import { cn } from '../../lib/utils';
import { createContext, useContext } from '@lynx-js/react';
import type { ReactNode } from '@lynx-js/react';
import type { TextProps, ViewProps } from '@lynx-js/types';

// RHF-style field bindings without DOM refs or browser submit events.
export interface FormControl {
  values: Readonly<Record<string, string | boolean>>;
  errors?: Readonly<Record<string, string>>;
  disabled?: boolean;
  onChange(name: string, value: string): void;
  onSubmit(): void;
}
const FormContext = createContext<FormControl | null>(null);
const FieldContext = createContext<{ name: string; error: string }>({ name: '', error: '' });
export function Form({ control, children }: { control: FormControl; children: ReactNode }) {
  return <FormContext.Provider value={control}>{children}</FormContext.Provider>;
}
export function FormField({
  name,
  render,
}: {
  name: string;
  render(props: {
    field: { name: string; value: string; disabled: boolean; onChange(value: string): void };
    fieldState: { error: string };
  }): ReactNode;
}) {
  const control = useContext(FormContext);
  if (!control) throw new Error('FormField requires Form');
  const error = control.errors?.[name] ?? '';
  return (
    <FieldContext.Provider value={{ name, error }}>
      {render({
        field: {
          name,
          value: String(control.values[name] ?? ''),
          disabled: !!control.disabled,
          onChange: (value) => {
            'background only';
            if (!control.disabled) control.onChange(name, value);
          },
        },
        fieldState: { error },
      })}
    </FieldContext.Provider>
  );
}
export function FormItem({ children, className, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <view {...props} className={cn('flex flex-col mb-[16px] min-w-0', className)}>
      {children}
    </view>
  );
}
export function FormLabel({ children, className, ...props }: TextProps & { children?: ReactNode }) {
  return (
    <text {...props} className={cn('text-[12px] text-[#c3cdd6] mb-[8px]', className)}>
      {children}
    </text>
  );
}
export function FormControl({
  children,
  className,
  ...props
}: ViewProps & { children?: ReactNode }) {
  return (
    <view {...props} className={cn('w-full', className)}>
      {children}
    </view>
  );
}
export function FormDescription({
  children,
  className,
  ...props
}: TextProps & { children?: ReactNode }) {
  return (
    <text
      {...props}
      className={cn('text-[10px] text-[#8c99a7] leading-[17px] mt-[6px]', className)}
    >
      {children}
    </text>
  );
}
export function FormMessage({ className, ...props }: TextProps = {}) {
  const { error } = useContext(FieldContext);
  return error ? (
    <text {...props} className={cn('text-[11px] text-[#e4a4a4] mt-[6px]', className)}>
      {error}
    </text>
  ) : null;
}
export function FormSubmit({
  children,
  className,
  ...props
}: Omit<ButtonProps, 'disabled' | 'bindtap'>) {
  const control = useContext(FormContext);
  return (
    <Button
      {...props}
      disabled={control?.disabled}
      className={cn('h-auto py-[10px] rounded-[7px] font-bold', className)}
      bindtap={() => {
        'background only';
        if (!control?.disabled) control?.onSubmit();
      }}
    >
      {children}
    </Button>
  );
}
