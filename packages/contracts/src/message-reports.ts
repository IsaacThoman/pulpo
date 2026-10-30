import { z } from 'zod'

export const MESSAGE_REPORT_CONTEXT_MAX_LENGTH = 2_000
/** How much of the reported message's text a report keeps, so admins can tell which message it was. */
export const MESSAGE_REPORT_EXCERPT_MAX_LENGTH = 500

/**
 * A user's report of one message. `messageId` is the client message id: a response id for a
 * response, or `<response id>:input` for the user message that started it. Reporting shares the
 * whole chat with administrators, who open it through the audited admin chat viewer.
 */
export const messageReportInputSchema = z.object({
  messageId: z.string().refine((value) => z.uuid().safeParse(value.replace(/:input$/, '')).success, 'Invalid message id'),
  context: z.string().trim().max(MESSAGE_REPORT_CONTEXT_MAX_LENGTH).default(''),
})
export type MessageReportInput = z.infer<typeof messageReportInputSchema>

export const messageReportRoleSchema = z.enum(['user', 'assistant'])
export type MessageReportRole = z.infer<typeof messageReportRoleSchema>

export const adminMessageReportSchema = z.object({
  id: z.uuid(),
  chatId: z.uuid(),
  chatTitle: z.string(),
  responseId: z.uuid(),
  messageRole: messageReportRoleSchema,
  /** The start of the message's text when it was reported. */
  excerpt: z.string(),
  context: z.string(),
  reporter: z.object({
    id: z.uuid(),
    name: z.string(),
    username: z.string(),
    email: z.string(),
  }),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
})
export type AdminMessageReport = z.infer<typeof adminMessageReportSchema>

export const adminMessageReportStatusSchema = z.enum(['open', 'resolved'])
export type AdminMessageReportStatus = z.infer<typeof adminMessageReportStatusSchema>
