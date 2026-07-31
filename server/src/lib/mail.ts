import nodemailer from 'nodemailer'
import { getConfig } from '../config.js'

export async function sendPasswordReset(email: string, token: string): Promise<boolean> {
  const config = getConfig()
  if (!config.SMTP_URL) return false
  const link = `${config.PUBLIC_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`
  const transport = nodemailer.createTransport(config.SMTP_URL)
  await transport.sendMail({
    from: config.SMTP_FROM,
    to: email,
    subject: 'Reset your Pulpo password',
    text: `Use this one-time link within one hour to reset your Pulpo password:\n\n${link}`,
    html: `<p>Use this one-time link within one hour to reset your Pulpo password:</p><p><a href="${link}">Reset password</a></p>`,
  })
  return true
}
