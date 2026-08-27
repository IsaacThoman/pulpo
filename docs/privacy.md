# Pulpo software privacy policy

**Effective August 27, 2026**

::: tip Using pulpo.baby?
This policy covers the Pulpo mobile app and self-hosted Pulpo software. If you use the hosted service at [pulpo.baby](https://pulpo.baby), the [Pulpo hosted service privacy policy](./privacy-hosted) also applies to the information handled by that service.
:::

## Scope

This policy describes the privacy practices of the Pulpo mobile app and the Pulpo server, web, and command-line software made available by Isaac Thoman (collectively, the **“Pulpo software”**).

Pulpo is self-hostable. The mobile app connects to a Pulpo server selected by the user. That may be the hosted service at `pulpo.baby` or a server operated by the user or another organization.

## No developer telemetry

The Pulpo software does not send product analytics, advertising data, crash telemetry, or usage telemetry to the developer. It does not include advertising SDKs, enable cross-app tracking, or sell personal information.

The mobile app does send information needed to provide its features to the Pulpo server selected by the user. This is service traffic, not telemetry sent independently to the developer. When the selected server is `pulpo.baby`, the [hosted service privacy policy](./privacy-hosted) explains how that service handles the information.

## Information stored locally

Pulpo stores information on your device or in your browser so the software can work. This may include your login session, server address, preferences, drafts, recent or cached content, and downloaded attachments. Login credentials are stored using the operating system’s secure credential storage when available.

Signing out removes the login credential and account-specific cached data. Some general preferences and server details may remain until you clear the app or browser data. Information may also remain in backups according to your device or backup provider’s settings.

## Information handled by a Pulpo server

To provide their features, Pulpo clients send applicable account and authentication requests, conversations, prompts, attachments, preferences, administrative commands, settings, and related service requests to the Pulpo server you select. The server may store this information and may send relevant content to AI model providers, tool providers, or other services configured by the server operator to fulfill your requests.

If you use a self-hosted or third-party Pulpo instance, its operator—not the developer merely by providing the software—controls that instance’s collection, storage, access, retention, deletion, provider configuration, and security practices. Review the operator’s privacy information before using its service.

## Memories and relevant-chat recall

The Memories setting controls both saved fact memories and relevant-chat recall. Relevant-chat recall operates only when the user has enabled Memories and the instance administrator has enabled episodic memory. When both settings are on, the server automatically creates a searchable index from eligible normal conversations and enabled saved facts, including a backfill of existing eligible content. Temporary conversations, trashed or expired conversations, inactive response branches, reasoning, tool output, workspace data, and raw attachment contents are not indexed.

The default self-hosted Compose deployment generates embeddings through Ollama on the instance’s internal network. It does not send text to the configured AI model provider merely to create an embedding. An operator can override `PULPO_OLLAMA_URL`, including with a service on another host; in that case, eligible text is sent to the endpoint chosen by that operator. If Pulpo recalls a relevant excerpt while answering a request, the excerpt becomes part of the normal model context and may therefore be sent to the AI provider selected for that response.

Turning Memories off cancels outstanding indexing and deletes that user’s chat and saved-memory embedding rows across all model generations. Existing saved fact records are retained, but are no longer used while Memories is off. Turning episodic memory off at the instance level stops indexing and recall but retains the dormant index so it can resume if an administrator re-enables it. Deleting a conversation removes its derived embedding rows with it. Full instance backups include episodic-memory operational data and embeddings; ordinary chat exports contain conversations and responses, not derived embeddings.

## Your choices and deletion

The Pulpo app provides controls to edit certain profile information, enable or disable Memories, move individual or all conversations to Trash for deletion under the selected server’s retention settings, change servers, and sign out. Requests concerning an account or information held on a server must be directed to that server’s operator.

For requests involving `pulpo.baby`, see the [hosted service privacy policy](./privacy-hosted). For a different Pulpo instance, contact the organization or person operating that instance.

## Security

The production mobile app requires HTTPS for non-localhost server addresses and stores mobile session credentials using the iOS Keychain. A server operator is responsible for configuring, maintaining, and securing its deployment. No method of electronic storage or transmission is completely secure.

## Changes to this policy

This policy may be updated as the Pulpo software changes. Material revisions will be posted on this page with a new effective date.

## Contact

Questions about the Pulpo software can be sent to [support@pulpo.baby](mailto:support@pulpo.baby).

For information held by a self-hosted or third-party Pulpo instance, contact that instance’s operator.
