import { Fragment, type ReactNode } from "react";
import { useTranslation } from "./useAppTranslation";

/** Re-evaluates source-keyed UI copy whenever the active catalog changes. */
export function LocaleBoundary({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  return (
    <Fragment key={i18n.resolvedLanguage ?? i18n.language}>{children}</Fragment>
  );
}
