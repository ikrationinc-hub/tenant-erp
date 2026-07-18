import type { ChangeEvent, ReactElement } from "react";
import { Input } from "antd";
import { isPartialNumericString } from "../numeric-string";

interface NumericStringInputProps {
  id: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  suffix?: string;
}

/** Backs Decimal/Currency/Percentage - a plain text input, never AntD's InputNumber (which converts to a JS number internally). The value in and out is always a string (frontend rule 3). */
export function NumericStringInput({ id, ariaLabel, value, onChange, onBlur, suffix }: NumericStringInputProps): ReactElement {
  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const next = event.target.value;
    if (next === "" || isPartialNumericString(next)) {
      onChange(next);
    }
  }

  return (
    <Input
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={handleChange}
      onBlur={onBlur}
      suffix={suffix}
      inputMode="decimal"
    />
  );
}
