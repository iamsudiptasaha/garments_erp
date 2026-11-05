import * as Scroll from '@radix-ui/react-scroll-area';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
} from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border bg-background', className)} {...props} />;
}
export const ScrollArea = forwardRef<
  ElementRef<typeof Scroll.Root>,
  ComponentPropsWithoutRef<typeof Scroll.Root>
>(({ children, className, ...props }, ref) => (
  <Scroll.Root ref={ref} className={cn('relative', className)} {...props}>
    <Scroll.Viewport className="h-full w-full rounded-[inherit]">{children}</Scroll.Viewport>
    <Scroll.Corner />
  </Scroll.Root>
));
ScrollArea.displayName = 'ScrollArea';
export const ScrollBar = forwardRef<
  ElementRef<typeof Scroll.Scrollbar>,
  ComponentPropsWithoutRef<typeof Scroll.Scrollbar>
>(({ className, orientation = 'vertical', ...props }, ref) => (
  <Scroll.Scrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      'flex touch-none select-none p-0.5',
      orientation === 'vertical' ? 'h-full w-2.5' : 'h-2.5 flex-col',
      className,
    )}
    {...props}
  >
    <Scroll.Thumb className="relative flex-1 rounded-full bg-slate-300" />
  </Scroll.Scrollbar>
));
ScrollBar.displayName = 'ScrollBar';
