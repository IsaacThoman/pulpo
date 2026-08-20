# Pulpo for iPhone

The native Pulpo client targets iPhone and connects to `https://pulpo.baby` by default. You can switch it to any compatible HTTPS Pulpo instance.

## Connect to an instance

Enter the instance origin without an extra path, query string, or credentials. Production and preview builds require HTTPS.

Native passkeys are available for domains included when the app is signed. Other HTTPS instances use a protected Safari handoff for authentication, because runtime-discovered domains cannot be added to an already-signed app's entitlements.

## Local development

Start the local Compose gateway, then launch the mobile workspace with a development-only HTTP URL:

```bash
docker compose up --build -d
EXPO_PUBLIC_DEFAULT_INSTANCE_URL=http://localhost:8080 npm run dev:mobile
```

Open the project in an iOS simulator through Expo CLI. Local HTTP is accepted only by development builds. See the repository's [mobile development notes](https://github.com/IsaacThoman/pulpo/blob/main/apps/mobile/README.md) for build and TestFlight details.
