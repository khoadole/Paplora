"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A small dropdown menu: click to open, Escape to close, click-outside to close,
 * arrow keys to move, focus returned to the trigger on close. Used for column
 * actions, export and project overflow so those actions stop competing with the
 * everyday buttons for space.
 */

export function Menu({
  label,
  trigger,
  children,
  align = "start",
}: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        root.current?.querySelector<HTMLElement>("[data-menu-trigger] button, [data-menu-trigger]")?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Move through items with the arrow keys once the menu is open.
  useEffect(() => {
    if (!open) return;
    const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[data-menu-item]") ?? []);
    items[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "ArrowDown" ? index + 1 : index - 1;
      items[(next + items.length) % items.length]?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={root} className="relative">
      <span data-menu-trigger onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        {trigger}
      </span>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className="menu absolute z-40 mt-1"
          style={align === "end" ? { right: 0 } : { left: 0 }}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  children,
  onSelect,
  icon,
  danger,
  disabled,
}: {
  children: ReactNode;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-menu-item
      className="menu-item"
      disabled={disabled}
      style={danger ? { color: "var(--danger)" } : undefined}
      onClick={onSelect}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function MenuSeparator() {
  return <div className="menu-sep" role="separator" />;
}
