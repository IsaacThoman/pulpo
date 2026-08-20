# Welcome to Pulpo

Pulpo is a self-hostable, local-first AI workspace and OpenAI-compatible gateway for the web and iPhone.

It keeps recent conversations, drafts, and pending changes on your device so the interface stays responsive through brief network interruptions. Server-side workers continue model responses independently of browser connections, while PostgreSQL remains authoritative.

## Start here

- If you use Pulpo, begin with [Getting started](/getting-started).
- To connect from iOS, read [Pulpo for iPhone](/guides/iphone).
- To run your own instance, follow [Self-hosting Pulpo](/self-hosting).
- To automate administration, install the [Pulpo management CLI](/operations/cli).
- To build an integration, use the [OpenAI-compatible API](/api).

## Learn how Pulpo works

Read the [architecture overview](/concepts/architecture) for the major services and repository layout. [Local-first and realtime behavior](/concepts/realtime) explains caching, queued mutations, event recovery, and background response ownership.

## Contribute

Pulpo's source and documentation are maintained in the [GitHub repository](https://github.com/IsaacThoman/pulpo). See [Development and contributing](/contributing) to set up a local checkout, validate changes, and understand the release process.

Report problems in the [issue tracker](https://github.com/IsaacThoman/pulpo/issues). Do not include passwords, API keys, provider credentials, or private conversation content in a public issue.
