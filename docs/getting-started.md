# Getting started

Pulpo is an AI workspace for conversations, files, and agent-assisted work. You can use the hosted service at [pulpo.baby](https://pulpo.baby) or connect to another compatible Pulpo instance.

## Sign in

Open your instance in a browser and create or sign in to your account. On a new self-hosted installation, the first visitor is guided through creating the initial administrator; no default login is created.

Passkeys work on HTTPS instances and during local development on `localhost`. A self-hosted instance should keep a stable `PUBLIC_URL`, because passkeys are bound to its hostname.

## Start a conversation

Choose an available model, enter a message, and send it. Your instance administrator controls which providers, labs, models, prices, and optional agent tools are available.

Pulpo keeps recent conversations and drafts locally. Cached chats open immediately, while changes made during a short interruption are queued and reconciled after the connection returns.

## Work across devices

Use the browser from any supported device. The [Pulpo iPhone app](/guides/iphone) connects to `pulpo.baby` by default and can switch to another HTTPS Pulpo instance.

## Get help

Report a problem or request help in the [Pulpo issue tracker](https://github.com/IsaacThoman/pulpo/issues). Never include passwords, bearer tokens, provider keys, or private conversation content in a public issue.
