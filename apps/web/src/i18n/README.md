# Web localization

Pulpo ships English (`en-US`) and Spanish (`es-ES`) in the web bundle. English is the fallback locale.

## Updating copy

1. Add or update the key in `locales/en-US.ts`.
2. Make the matching change in `locales/es-ES.ts`.
3. Replace hard-coded component copy with `t('section.key')` from `useAppTranslation`.
4. Run `npm run test -w @pulpo/web` and `npm run build -w @pulpo/web`.

The Spanish catalog must satisfy the English catalog's TypeScript shape, and `catalogs.test.ts` also checks key parity. Use i18next interpolation for dynamic values:

```ts
// locale
greeting: 'Hello, {{name}}!'

// component
t('profile.greeting', { name: user.name })
```

Keep user-generated content, model/provider names, and server error messages unchanged. Add application-authored interface copy to the catalogs.

## Leaf-level UI copy

Reusable product concepts and workflows should continue to use named keys from
`en-US.ts` and `es-ES.ts`. One-off labels, status text, admin copy, validation
messages, and accessibility text use their English source as the key:

```tsx
import { ui, uit } from '@/i18n/ui'

<Button>{ui('Refresh workspaces')}</Button>
<span>{uit`${count} active users`}</span>
```

Add matching Spanish text to `locales/es-ES-ui.ts`. The localization coverage
test rejects missing Spanish source keys, mismatched template placeholders,
hard-coded JSX text, and hard-coded visible attributes.

Use `activeLocale()` for direct `Intl` or `toLocaleString` formatting so dates
and numbers follow the in-app language instead of the operating-system locale.
