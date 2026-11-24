"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/codelit/input";
import { Label } from "@/components/ui/codelit/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/codelit/select";
import { type PostalAddressForm, postalCountryOptions } from "@/lib/postal-address";

const TEXT_FIELDS: {
  key: Exclude<keyof PostalAddressForm, "country">;
  label: string;
  autoComplete: string;
  maxLength: number;
  wide?: boolean;
}[] = [
  {
    key: "line1",
    label: "Street address",
    autoComplete: "address-line1",
    maxLength: 200,
    wide: true,
  },
  {
    key: "line2",
    label: "Address line 2 (optional)",
    autoComplete: "address-line2",
    maxLength: 200,
    wide: true,
  },
  { key: "city", label: "City", autoComplete: "address-level2", maxLength: 100 },
  {
    key: "region",
    label: "State or region (optional)",
    autoComplete: "address-level1",
    maxLength: 100,
  },
  {
    key: "postalCode",
    label: "Postal code",
    autoComplete: "postal-code",
    maxLength: 20,
  },
];

/** The team's mailing address as separate fields, for the managed footer. */
export function PostalAddressFields({
  value,
  onChange,
  idPrefix = "postal-address",
}: {
  value: PostalAddressForm;
  onChange: (value: PostalAddressForm) => void;
  idPrefix?: string;
}) {
  const countries = useMemo(() => postalCountryOptions(), []);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {TEXT_FIELDS.map((field) => (
        <div
          key={field.key}
          className={field.wide ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}
        >
          <Label htmlFor={`${idPrefix}-${field.key}`}>{field.label}</Label>
          <Input
            id={`${idPrefix}-${field.key}`}
            value={value[field.key]}
            onChange={(e) => onChange({ ...value, [field.key]: e.target.value })}
            autoComplete={field.autoComplete}
            maxLength={field.maxLength}
          />
        </div>
      ))}
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-country`}>Country</Label>
        <Select
          value={value.country}
          onValueChange={(country) => onChange({ ...value, country })}
        >
          <SelectTrigger id={`${idPrefix}-country`}>
            <SelectValue placeholder="Select a country" />
          </SelectTrigger>
          <SelectContent>
            {countries.map((country) => (
              <SelectItem key={country.code} value={country.code}>
                {country.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
