import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Rendered above the body, separated by a hairline. */
  header?: ReactNode;
  /** Rendered below the body on a tinted strip. */
  footer?: ReactNode;
  children: ReactNode;
}

/** Surface container with optional header and footer slots. */
export function Card({ header, footer, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-card border border-line bg-surface-raised shadow-card',
        className,
      )}
      {...rest}
    >
      {header !== undefined ? (
        <div className="border-b border-line px-5 py-4">{header}</div>
      ) : null}

      <div className="px-5 py-4">{children}</div>

      {footer !== undefined ? (
        <div className="border-t border-line bg-surface-sunken px-5 py-3">{footer}</div>
      ) : null}
    </div>
  );
}

export interface CardTitleProps {
  title: string;
  description?: string;
  /** Right-aligned slot for actions such as a button or menu. */
  action?: ReactNode;
}

/** Conventional header content: title, optional description, optional action. */
export function CardTitle({ title, description, action }: CardTitleProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description !== undefined ? (
          <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
