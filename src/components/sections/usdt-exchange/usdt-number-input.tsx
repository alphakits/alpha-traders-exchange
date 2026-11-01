"use client";

import { useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore, type InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";

export type GroupedDecimalInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  maxFractionDigits: number;
  maxIntegerDigits?: number;
};

function normalizeDigits(value: string) {
  return value.replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/٫/g, ".").replace(/٬/g, ",");
}

function group(value: string) {
  const [integer, fraction] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

function ungroup(value: string) { return normalizeDigits(value).replace(/,/g, ""); }

// A comma is always a thousands separator here. Never reinterpret malformed
// pasted grouping (for example 1,23) as either 123 or 1.23.
function parseDisplay(value: string) {
  const normalized = normalizeDigits(value.trim());
  if (/^\d*(?:\.\d*)?$/.test(normalized)) return normalized;
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(normalized)) return normalized.replace(/,/g, "");
  return null;
}

function insertedText(before: string, after: string) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let oldEnd = before.length; let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd -= 1; newEnd -= 1; }
  return after.slice(start, newEnd);
}

function displayPosition(displayed: string, rawPosition: number) {
  let raw = 0;
  for (let index = 0; index < displayed.length; index += 1) {
    if (raw === rawPosition) return index;
    if (displayed[index] !== ",") raw += 1;
  }
  return displayed.length;
}

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

/** A grouped editing surface; only valid, ungrouped decimal text reaches its owner.
 * Invalid pasted text stays visible and blocks native form submission instead
 * of being silently truncated or converted to a different monetary amount. */
export function GroupedDecimalInput({ value, onValueChange, maxFractionDigits, maxIntegerDigits = 12, ...props }: GroupedDecimalInputProps) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef<{ start: number; end: number; raw: boolean } | null>(null);
  const previousSelection = useRef<{ start: number; end: number } | null>(null);
  const [invalidDraft, setInvalidDraft] = useState<{ value: string; text: string; error: string } | null>(null);
  const [, refreshSelection] = useReducer(revision => revision + 1, 0);
  const draft = invalidDraft?.value === value ? invalidDraft : null;
  const displayed = draft?.text ?? group(value);
  const error = draft?.error ?? "";

  useEffect(() => { setInvalidDraft(null); }, [value]);
  useLayoutEffect(() => {
    if (!input.current) return;
    input.current.setCustomValidity(error);
    if (!selection.current) return;
    const { start, end, raw } = selection.current;
    input.current.setSelectionRange(raw ? start : displayPosition(displayed, start), raw ? end : displayPosition(displayed, end));
    selection.current = null;
  });

  function applyEdit(edited: string, start: number, end: number, candidate: string | null) {
    let message = candidate === null ? "Use digits, a decimal point, and correctly grouped thousands." : "";
    let canonical = candidate ?? "";
    const [integer, fraction] = canonical.split(".");
    const whole = integer.replace(/^0+(?=\d)/, "") || (fraction !== undefined ? "0" : "");
    if (whole.length > maxIntegerDigits) message = `Use at most ${maxIntegerDigits} digits before the decimal point.`;
    if (fraction !== undefined && (maxFractionDigits === 0 || fraction.length > maxFractionDigits)) {
      message = maxFractionDigits === 0 ? "Use a whole number." : `Use at most ${maxFractionDigits} decimal places.`;
    }
    if (message) {
      setInvalidDraft({ value, text: edited, error: message });
      selection.current = { start, end, raw: true };
    } else {
      canonical = fraction === undefined ? whole : `${whole}.${fraction}`;
      // Account for normalized leading zeros and an inserted zero before a
      // leading decimal point when translating the cursor to canonical text.
      const adjustment = whole.length - integer.length;
      const position = (offset: number) => Math.max(0, Math.min(canonical.length,
        ungroup(edited.slice(0, offset)).trimStart().length + adjustment));
      selection.current = { start: position(start), end: position(end), raw: false };
      setInvalidDraft(null);
      onValueChange(canonical);
    }
    refreshSelection();
  }

  function pasteText(text: string, element: HTMLInputElement) {
    const start = element.selectionStart ?? displayed.length;
    const end = element.selectionEnd ?? start;
    const fragment = parseDisplay(text);
    // Parse the clipboard independently before combining with the existing
    // decimal. A middle paste must not inherit shifting generated commas.
    const before = draft ? displayed.slice(0, start) : ungroup(displayed.slice(0, start));
    const after = draft ? displayed.slice(end) : ungroup(displayed.slice(end));
    if (fragment === null) {
      const edited = displayed.slice(0, start) + text + displayed.slice(end);
      applyEdit(edited, start + text.length, start + text.length, null);
      return;
    }
    const edited = before + fragment + after;
    const caret = before.length + fragment.length;
    applyEdit(edited, caret, caret, parseDisplay(edited));
  }

  return <Input
    {...props}
    ref={input}
    defaultValue={undefined}
    type="text"
    inputMode="decimal"
    dir="ltr"
    value={displayed}
    disabled={props.disabled || !ready}
    aria-invalid={error ? true : props["aria-invalid"]}
    onSelect={event => {
      previousSelection.current = { start: event.currentTarget.selectionStart ?? 0, end: event.currentTarget.selectionEnd ?? 0 };
      props.onSelect?.(event);
    }}
    onKeyDown={event => {
      previousSelection.current = { start: event.currentTarget.selectionStart ?? 0, end: event.currentTarget.selectionEnd ?? 0 };
      props.onKeyDown?.(event);
    }}
    onBlur={event => {
      props.onBlur?.(event);
      if (error && !event.defaultPrevented) event.currentTarget.reportValidity();
    }}
    onPaste={event => {
      props.onPaste?.(event);
      if (event.defaultPrevented || props.readOnly || props.disabled) return;
      event.preventDefault();
      pasteText(event.clipboardData.getData("text"), event.currentTarget);
    }}
    onDrop={event => {
      props.onDrop?.(event);
      if (event.defaultPrevented || props.readOnly || props.disabled) return;
      event.preventDefault();
      pasteText(event.dataTransfer.getData("text"), event.currentTarget);
    }}
    onChange={event => {
      if (props.readOnly || props.disabled) return;
      let edited = event.currentTarget.value;
      let start = event.currentTarget.selectionStart ?? edited.length;
      let end = event.currentTarget.selectionEnd ?? start;
      const inputType = (event.nativeEvent as InputEvent).inputType ?? "";
      const collapsed = !previousSelection.current || previousSelection.current.start === previousSelection.current.end;
      // Removing only a generated comma must not trap a mobile keyboard's
      // backspace/delete key. Preserve explicit selected-range deletion.
      if (!draft && collapsed && edited.length === displayed.length - 1 && ungroup(edited) === value) {
        if (inputType === "deleteContentBackward" && start > 0) {
          edited = edited.slice(0, start - 1) + edited.slice(start); start -= 1; end = start;
        } else if (inputType === "deleteContentForward") {
          edited = edited.slice(0, start) + edited.slice(start + 1); end = start;
        }
      }
      const newText = normalizeDigits(insertedText(displayed, edited));
      const ordinaryEdit = !draft && !/paste|drop|replacement/i.test(inputType) && /^[\d.]*$/.test(newText);
      const candidate = parseDisplay(ordinaryEdit ? ungroup(edited) : edited);
      applyEdit(edited, start, end, candidate);
      previousSelection.current = null;
    }}
  />;
}
