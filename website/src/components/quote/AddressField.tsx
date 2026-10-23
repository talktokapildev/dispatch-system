"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { fetchSuggestions, type PlaceChoice, type Suggestion } from "@/lib/quote";
import { PinIcon } from "../Icons";

/**
 * Address box with suggestions (UK). Suggestions come from our backend (Google Places via the
 * backend key), so no Google script or key is loaded on the website. The visitor must pick a
 * suggestion: free text is not quotable.
 */
export default function AddressField({
  label,
  placeholder,
  value,
  onChange,
  session,
  pinColor,
  labelAside,
}: {
  label: string;
  placeholder: string;
  value: PlaceChoice | null;
  onChange: (v: PlaceChoice | null) => void;
  session: string;
  pinColor: string;
  /** Shown at the right of the label row (e.g. the swap button). */
  labelAside?: ReactNode;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState(value?.label ?? "");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Parent can set the value (swap, area-page preset). To clear it, the parent remounts us (key).
  useEffect(() => {
    if (value) setText(value.label);
  }, [value]);

  // Debounced suggestions while typing (only when the text isn't the chosen place).
  useEffect(() => {
    const q = text.trim();
    if (value && text === value.label) return;
    if (q.length < 3) {
      setItems([]);
      return;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const list = await fetchSuggestions(q, session, ctrl.signal);
        setItems(list);
        setActive(list.length ? 0 : -1);
        setOpen(true);
      } catch {
        // aborted or offline: keep what we had
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [text, session, value]);

  // Close when tapping elsewhere.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const choose = (s: Suggestion) => {
    const label = s.secondaryText ? `${s.mainText}, ${s.secondaryText}` : s.mainText;
    onChange({ placeId: s.placeId, label });
    setText(label);
    setItems([]);
    setOpen(false);
    // Close the phone keyboard, so iOS doesn't jump straight into the next field (the date picker).
    inputRef.current?.blur();
  };

  const showList = open && text.trim().length >= 3 && (!value || text !== value.label);

  return (
    <div ref={wrapRef} className="relative flex flex-col gap-[6px]">
      <div className="flex min-h-[24px] items-center justify-between gap-2">
        <label htmlFor={id} className="text-[14px] font-bold text-soft">
          {label}
        </label>
        {labelAside}
      </div>
      <div className="flex min-h-[52px] items-center gap-[10px] rounded-[14px] border-[1.5px] border-[#d1d5db] bg-[#f8fafc] px-[14px] transition-colors focus-within:border-amber focus-within:bg-white">
        <PinIcon color={pinColor} />
        <input
          ref={inputRef}
          enterKeyHint="done"
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (value) onChange(null);
          }}
          onFocus={() => items.length && setOpen(true)}
          onKeyDown={(e) => {
            if (!showList || !items.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % items.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
            } else if (e.key === "Enter" && active >= 0) {
              e.preventDefault();
              choose(items[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="min-w-0 flex-1 bg-transparent py-3 text-[16px] text-ink outline-none placeholder:text-muted"
        />
        {loading && (
          <span className="h-4 w-4 flex-none animate-spin rounded-full border-2 border-line border-t-amber" aria-hidden />
        )}
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-30 m-0 mt-1 list-none overflow-hidden rounded-[14px] border border-line bg-white p-1 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.35)]"
        >
          {items.length === 0 && !loading ? (
            <li className="px-3 py-3 text-[14.5px] text-muted">No matches. Try a postcode or street name.</li>
          ) : (
            items.map((s, i) => (
              <li
                key={s.placeId}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // Keep focus in the box on press (so the list stays open), but choose on the
                // click itself. Choosing on press let the rest of the tap fall through the closing
                // list onto the field underneath, which opened the iPhone's time picker.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(s)}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer rounded-[10px] px-3 py-[10px] ${i === active ? "bg-[#fffbeb]" : ""}`}
              >
                <span className="block text-[15px] font-bold text-ink">{s.mainText}</span>
                {s.secondaryText && <span className="block text-[13px] text-muted">{s.secondaryText}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
