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

export async function sendTwoFactorResetNotice(email: string): Promise<boolean> {
  const config = getConfig()
  if (!config.SMTP_URL) return false
  const transport = nodemailer.createTransport(config.SMTP_URL)
  await transport.sendMail({
    from: config.SMTP_FROM,
    to: email,
    subject: 'Your Pulpo two-factor authentication was reset',
    text: 'An administrator reset two-factor authentication for your Pulpo account. Your active sessions were signed out. Sign in and set up two-factor authentication again. If you did not expect this, contact your administrator.',
    html: '<p>An administrator reset two-factor authentication for your Pulpo account. Your active sessions were signed out.</p><p>Sign in and set up two-factor authentication again. If you did not expect this, contact your administrator.</p>',
  })
  return true
}
