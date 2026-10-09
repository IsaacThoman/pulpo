# Pulpo for Apple TV

An Expo app for tvOS built on [react-native-tvos](https://github.com/react-native-tvos/react-native-tvos),
which npm installs as this workspace's `react-native`.

## Shared code

The data layer comes from the iPhone app. `@/…` imports resolve to `apps/mobile/src`:

- session, accounts, and the API client
- the SQLite cache and React Query queries
- the realtime socket, stream reducer, and optimistic turns
- transcript projection and preferences

This app only adds the TV interface in `src/`. `metro.config.js` makes every
`react-native` import resolve to the TV fork. It also replaces phone-only native
modules (passkeys, the share sheet, the web browser) with stubs from `src/stubs`.

## Run

```sh
npm run prebuild -w @pulpo/tv   # generates ios/ for tvOS (EXPO_TV=1)
npm run tvos -w @pulpo/tv       # builds and opens a tvOS simulator
```

Debug builds may sign in to `http://localhost` instances. Set
`EXPO_PUBLIC_DEFAULT_INSTANCE_URL` when you start Metro to change the default server.

## Tests

- `npm test -w @pulpo/tv` runs the unit tests.
- `scripts/e2e.sh <simulator-udid>` runs the Siri Remote UI tests in `e2e/` against
  the app installed on that simulator. It needs `xcodegen`, plus `PULPO_EMAIL` and
  `PULPO_PASSWORD` for an account on the server the app uses.
