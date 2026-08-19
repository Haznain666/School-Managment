'use client';

import { useState } from 'react';

import {
  AddressAutocomplete,
  type LocationValue,
} from '@/components/ui/AddressAutocomplete';
import { Card, CardTitle } from '@/components/ui/Card';
import { PhoneField } from '@/components/ui/PhoneField';

/**
 * The two shared contact fields, on the one route where they can be seen.
 *
 * ── Why they are here ────────────────────────────────────────────────────
 * Every real screen carrying an address or a phone is behind a session *and* a
 * tenant — the school form is Super Admin, the guardian panel is a school
 * admin, and the admissions form needs a resolved subdomain. So checking that
 * the Mapbox suggestions actually drop down, that the mask reformats as you
 * type, and that the dropdown swaps masks without losing the digits, meant
 * signing in as three different roles. That is not a check anyone runs twice,
 * which is the same reasoning that put the palettes on this page.
 *
 * It also gives the fields a home against the three hostile palettes above.
 * The suggestion list is the part that needed it: it is the only floating
 * surface either component draws, and `bg-surface-raised` on a near-black
 * palette is where a dropdown goes invisible.
 *
 * This route 404s outside development, so none of it ships to a school.
 */
export function ContactFields() {
  const [contact, setContact] = useState('');
  const [identity, setIdentity] = useState('(0321) 123-4567');
  const [landline, setLandline] = useState('(042) 35300000');
  const [place, setPlace] = useState<LocationValue>({
    address: '',
    latitude: null,
    longitude: null,
  });
  const [postal, setPostal] = useState('');

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card
        header={
          <CardTitle
            title="Phone"
            description="Mobile (xxxx) xxx-xxxx, landline (xxx) xxxxxxxxxx. Digits only, masked as you type."
          />
        }
      >
        <div className="space-y-4">
          <PhoneField label="Phone" value={contact} onChange={setContact} />

          {/*
            Pre-filled with a Lahore landline, which is eleven digits and so is
            the value that used to be mis-detected as a mobile and re-masked to
            `(0423) 530-0000`. It renders under the landline mask or the fix has
            regressed.
          */}
          <PhoneField label="Office line" value={landline} onChange={setLandline} />

          <PhoneField
            label="Guardian phone"
            identity
            value={identity}
            onChange={setIdentity}
            hint="Switch this one to Landline to see the identity refusal."
          />
        </div>
      </Card>

      <Card
        header={
          <CardTitle
            title="Address"
            description="Mapbox Search Box. Suggestions assist; the typed text is the record."
          />
        }
      >
        <div className="space-y-4">
          <AddressAutocomplete value={place} onChange={setPlace} />

          <AddressAutocomplete
            label="Home address"
            multiline
            withCoordinates={false}
            value={{ address: postal, latitude: null, longitude: null }}
            onChange={(next) => {
              setPostal(next.address);
            }}
          />
        </div>
      </Card>
    </div>
  );
}
