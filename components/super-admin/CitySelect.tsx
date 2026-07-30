'use client';

import { Select } from '@/components/ui/Select';
import { PAKISTANI_CITIES } from '@/lib/cities';

export interface CitySelectProps {
  value: string;
  onChange: (city: string) => void;
  label?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
}

const CITY_OPTIONS = PAKISTANI_CITIES.map((city) => ({ value: city, label: city }));

/** City picker restricted to the cities the platform serves. */
export function CitySelect({
  value,
  onChange,
  label = 'City',
  error,
  disabled = false,
  required = false,
}: CitySelectProps) {
  return (
    <Select
      label={label}
      options={CITY_OPTIONS}
      placeholder="Select a city"
      value={value}
      required={required}
      disabled={disabled}
      error={error}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  );
}
