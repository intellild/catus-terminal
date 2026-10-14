import { Button } from './Button';
import type { ButtonProps } from './Button';
import { cn } from '../../lib/utils';
import { createContext, useContext } from '@lynx-js/react';
import type { ReactNode } from '@lynx-js/react';
import type { TextProps, ViewProps } from '@lynx-js/types';
import { useController } from 'react-hook-form';
import type { Control, FieldValues } from 'react-hook-form';

interface FormBindings {
  control: Control;
  disabled?: boolean;
  onChange(name: string, value: string): void;
  onSubmit(): void | Promise<void>;
}
const FormContext = createContext<FormBindings | null>(null);
const FieldContext = createContext<{ name: string; error: string }>({ name: '', error: '' });
export function Form<Values extends FieldValues, Output>({
  control,
  children,
  ...bindings
}: Omit<FormBindings, 'control'> & {
  control: Control<Values, unknown, Output>;
  children: ReactNode;
}) {
  // Field names are typed by the caller; the context erases the form's value type.
  return (
    <FormContext.Provider value={{ ...bindings, control: control as unknown as Control }}>
      {children}
    </FormContext.Provider>
  );
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
  const bindings = useContext(FormContext);
  if (!bindings) {
    throw new Error('FormField requires Form');
  }
  const { field, fieldState } = useController({ name, control: bindings.control });
  const error = fieldState.error?.message ?? '';
  return (
    <FieldContext.Provider value={{ name, error }}>
      {render({
        field: {
          name,
          value: String(field.value ?? ''),
          disabled: !!bindings.disabled,
          onChange: (value) => {
            'background only';
            if (!bindings.disabled) {
              field.onChange(value);
              bindings.onChange(name, value);
            }
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
        if (!control?.disabled) {
          control?.onSubmit();
        }
      }}
    >
      {children}
    </Button>
  );
}
