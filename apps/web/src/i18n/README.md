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
