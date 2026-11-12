import type { ComponentPropsWithoutRef, ReactElement } from 'react';

type Review = {
  busy: boolean;
  pending: unknown;
  back(): void;
  prepare<T>(
    payload: T,
    rows: readonly (readonly [string, unknown])[],
    save: (payload: T, requestId: string) => void | Promise<void>,
    title?: string,
  ): void;
};

export function useSaveReview(): Review;
export function ReviewForm(
  props: ComponentPropsWithoutRef<'form'> & { review: Review },
): ReactElement;
