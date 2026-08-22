import { cn } from '@/lib/utils';
import {
  subcategoryStyle,
  SUBCATEGORY_EMPTY,
  type SubcategoryLike,
} from '@/lib/result-subcategories';

/**
 * The one place a performance descriptor is drawn.
 *
 * Marks sheet, promotion screen, report card, print, both portals — all of them
 * render a descriptor through here, and that is the whole point. The school's
 * colour-coding switch is read at render time and never stored, so it is
 * retroactive across every sheet ever issued; two implementations of this
 * component would mean the switch is honoured on three screens out of five and
 * nothing on any screen would say which.
 *
 * ── Colour off means no styling, not a grey chip ─────────────────────────
 * `subcategoryStyle` returns an empty object when the school has switched
 * colour coding off or chose no colour for this descriptor, and an empty style
 * is what makes this render the plain label with no pill around it. A
 * colourless version of the same pill would still be a decoration a school
 * asked not to have.
 *
 * A server component: it holds no state and every one of its callers is a
 * sheet. Keeping it out of the client bundle keeps the print routes — which
 * draw hundreds of these — free of hydration for a `<span>`.
 */

export interface SubcategoryBadgeProps {
  /** Null renders the em dash. A blank cell on a report card is a question. */
  subcategory: SubcategoryLike | null;
  colorCoded: boolean;
  className?: string;
}

export function SubcategoryBadge({
  subcategory,
  colorCoded,
  className,
}: SubcategoryBadgeProps) {
  if (subcategory === null) {
    return <span className={cn('text-ink-muted', className)}>{SUBCATEGORY_EMPTY}</span>;
  }

  const style = subcategoryStyle(subcategory, colorCoded);
  const isPainted = style.backgroundColor !== undefined;

  if (!isPainted) {
    return <span className={cn('text-ink', className)}>{subcategory.label}</span>;
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        className,
      )}
      style={style}
    >
      {subcategory.label}
    </span>
  );
}
