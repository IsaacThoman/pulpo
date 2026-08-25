import i18n from "./index";
import esUi from "./locales/es-ES-ui";

export type UiValues = Record<string, string | number>;

export function activeLocale(): "en-US" | "es-ES" {
  return (i18n.resolvedLanguage ?? i18n.language) === "es-ES" ? "es-ES" : "en-US";
}

function interpolate(value: string, values?: UiValues): string {
  if (!values) return value;
  return value.replace(/{{\s*([^}\s]+)\s*}}/g, (match, key: string) => {
    const replacement = values[key];
    return replacement === undefined ? match : String(replacement);
  });
}

/**
 * Translate application-authored UI copy that uses its English source as the key.
 * Named catalog keys remain preferred for reusable product concepts and workflows;
 * this helper keeps leaf-level labels, status text, and admin copy auditable.
 */
export function ui(source: string, values?: UiValues): string {
  const translated = activeLocale() === "es-ES" ? (esUi[source] ?? source) : source;
  return interpolate(translated, values);
}

/** Translate template copy while preserving and reordering its dynamic values. */
export function uit(strings: TemplateStringsArray, ...values: Array<string | number>): string {
  const source = strings.reduce((result, part, index) => (
    `${result}${part}${index < values.length ? `{{${index}}}` : ''}`
  ), '')
  return ui(source, Object.fromEntries(values.map((value, index) => [String(index), value])))
}
