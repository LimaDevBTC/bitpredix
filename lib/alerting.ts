/**
 * Alerting — Discord webhook + console.error by severity.
 * Severities: INFO, WARN, CRITICAL
 */

const DISCORD_WEBHOOK = process.env.DISCORD_ALERT_WEBHOOK

type Severity = 'INFO' | 'WARN' | 'CRITICAL'

export async function alert(severity: Severity, message: string, context?: Record<string, unknown>): Promise<void> {
  const prefix = `[${severity}]`
  const full = context ? `${prefix} ${message} ${JSON.stringify(context)}` : `${prefix} ${message}`

  // Always log to console
  if (severity === 'CRITICAL') {
    console.error(full)
  } else if (severity === 'WARN') {
    console.warn(full)
  } else {
    console.info(full)
  }

  // Send to Discord if webhook configured and severity >= WARN
  if (DISCORD_WEBHOOK && severity !== 'INFO') {
    try {
      const emoji = severity === 'CRITICAL' ? '🚨' : '⚠️'
      await fetch(DISCORD_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `${emoji} **${severity}** — ${message}${context ? '\n```json\n' + JSON.stringify(context, null, 2) + '\n```' : ''}`,
        }),
      })
    } catch {
      // Discord send failed — don't throw, just log
      console.error(`[ALERT] Failed to send Discord alert: ${message}`)
    }
  }
}
