# Message reports

Administrators can let users report messages from **Admin → Settings → Authentication → Enable message reports**. The setting is off by default. While it is off, the report button is hidden and `POST /api/message-reports` returns `403 message_reports_disabled`.

## Reporting

When reports are on, every sent user message and finished response has a report button, except in expired temporary chats. On web it is in the message's action row. On iOS and Android it is in the long-press message menu, or the attachment's menu for a message with only attachments. The glyph is Pulpo's face from the keyboard's emoji key with its smile turned over, drawn in each platform's icon style. `assets/render-frown-icons.swift` renders the iOS images and prints the web and Android paths.

Reporting asks for optional context (up to 2,000 characters), then shares the whole chat with the instance's administrators. A report stores the chat, the reported message (its response, and whether it was the user's message or the response), the first 500 characters of that message's text, the reporter, and the context. It does not copy the rest of the conversation. Admins see the chat as it is when they open it. Users can only report messages in their own chats that are not trashed, purging, or expired. Each account can send 20 reports an hour to each API server.

Deleting the reported message withdraws its report from the admin list, and trashing the chat hides it until the chat is restored. Requesting account deletion trashes every chat, so it withdraws all of that account's reports. Reports are removed when their chat is permanently deleted and when the reporting account is deleted. They follow the chat in full backups, so reports on temporary chats are left out.

## Reviewing

**Admin → Reports** lists unresolved and resolved reports, newest first, with the reported message's excerpt. Reports whose chat has expired or is being purged are left out, since admin chat access can't open them. The list shows reported excerpts and context outside the 2FA-gated chat viewer, so each time an admin loads it, an audit event (`chat.report.list_viewed`) records which reports they saw. **Open chat** goes through the usual admin chat access, which needs the administrator's two-factor authentication and is limited to that chat. Reports can be resolved and reopened. Creating, resolving, and reopening a report each record an audit event (`chat.report.created`, `chat.report.resolved`, `chat.report.reopened`).

## Tests

`src/message-reports/routes.integration.test.ts` runs against PostgreSQL. CI runs it in the release workflow's database integration job. Locally, run it only against the disposable `pulpo_message_reports_test` database with `PULPO_MESSAGE_REPORT_TESTS=true`. It creates isolated test users and does not truncate data.
