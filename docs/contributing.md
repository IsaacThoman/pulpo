# Development and contributing

Pulpo requires Node.js 22 or newer. PostgreSQL 17 and Redis 7 are recommended for local development.

## Local setup

```bash
npm install
docker compose up -d postgres redis
npm run db:migrate
npm run dev:api
npm run dev:worker
npm run dev
```

The Vite server runs at `http://127.0.0.1:5173` and proxies API and Socket.IO traffic to port 3000.

## Validate a change

```bash
npm run build
npm test
npm run lint
docker compose config --quiet
```

Documentation can be developed and previewed separately:

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

## Releases

Pulpo uses Conventional Commits. Merges to `main` pass the test, build, and lint suites before Semantic Release determines the next version: `fix:` and `perf:` create a patch, `feat:` creates a minor, and a breaking change creates a major release.

Semantic Release creates the Git tag and GitHub release, publishes the management CLI, and dispatches the agent workspace workflow for that exact tag.

Use the [GitHub repository](https://github.com/IsaacThoman/pulpo) to report issues and propose changes. Do not include credentials or private user data in an issue.
