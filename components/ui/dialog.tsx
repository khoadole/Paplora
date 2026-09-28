"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { IconClose } from "../icons";

/**
 * Radix supplies the parts that are easy to get wrong by hand: focus trap,
 * Escape, aria wiring, scroll lock. Everything here is presentation.
 */

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/35" />
        <RadixDialog.Content
          className={`card fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-5 shadow-xl ${
            wide ? "sm:w-[46rem]" : "sm:w-[28rem]"
          }`}
        >
          <RadixDialog.Title className="text-[15px] font-semibold">{title}</RadixDialog.Title>
          {description ? (
            <RadixDialog.Description className="mt-1 text-[13px]" style={{ color: "var(--text-2)" }}>
              {description}
            </RadixDialog.Description>
          ) : (
            // Radix warns without a description; keep it for screen readers only.
            <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
          )}
          <div className="mt-4">{children}</div>
          {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
          <RadixDialog.Close className="btn btn-quiet btn-icon absolute right-3 top-3" aria-label="Close">
            <IconClose />
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const DialogClose = RadixDialog.Close;
