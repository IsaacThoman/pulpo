import { cloneElement, isValidElement, type ReactNode } from "react";
import { useTranslation } from "./useAppTranslation";

/** Re-evaluates source-keyed UI copy without remounting the application. */
export function LocaleBoundary({ children }: { children: ReactNode }) {
  useTranslation();

  // A fresh element makes source-keyed `ui()` calls render again. Keeping its
  // type and key stable preserves component state and avoids re-running mount
  // effects such as settings hydration.
  return isValidElement(children) ? cloneElement(children) : children;
}
