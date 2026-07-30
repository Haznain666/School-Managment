/**
 * Cities the platform currently serves. Schools and branches pick from this
 * list rather than typing free text, so filtering and reporting stay clean.
 */
export const PAKISTANI_CITIES = [
  'Karachi',
  'Lahore',
  'Islamabad',
  'Rawalpindi',
  'Faisalabad',
  'Multan',
  'Peshawar',
  'Quetta',
  'Sialkot',
  'Gujranwala',
  'Hyderabad',
] as const;

export type PakistaniCity = (typeof PAKISTANI_CITIES)[number];

export function isPakistaniCity(value: unknown): value is PakistaniCity {
  return (
    typeof value === 'string' && (PAKISTANI_CITIES as readonly string[]).includes(value)
  );
}
