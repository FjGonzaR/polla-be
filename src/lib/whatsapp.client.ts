import { rm } from 'node:fs/promises'
import type { WASocket } from '@whiskeysockets/baileys'
import { createPacedQueue } from './paced-queue.js'

const SESSION_DIR = process.env.BAILEYS_SESSION_DIR ?? '.baileys-session'
const ENABLED = process.env.WHATSAPP_ENABLED === 'true'
// Backoff before reconnecting after a dropped connection. Prevents a repeated
// failure (e.g. a 403 block) from hammering WhatsApp and escalating to a ban.
const RECONNECT_DELAY_MS = Number(process.env.WHATSAPP_RECONNECT_DELAY_MS ?? 5000)

// --- Outbound rate limiting --------------------------------------------------
// WhatsApp bans numbers that send too fast (ours was blocked once). Every
// outbound message is serialized through a single queue and paced: a randomized
// delay between messages, plus a longer pause after each batch. This throttles
// ALL send paths (crons, broadcasts, welcome/invite messages) regardless of the
// caller, including concurrent fire-and-forget sends.
const SEND_DELAY_MS = Number(process.env.WHATSAPP_SEND_DELAY_MS ?? 4000)
const SEND_JITTER_MS = Number(process.env.WHATSAPP_SEND_JITTER_MS ?? 2000)
const BATCH_SIZE = Number(process.env.WHATSAPP_BATCH_SIZE ?? 10)
const BATCH_PAUSE_MS = Number(process.env.WHATSAPP_BATCH_PAUSE_MS ?? 60_000)

// --- Delivery tracking -------------------------------------------------------
// A resolved sendMessage() only means WhatsApp accepted the message into the
// socket, NOT that it reached the recipient's device. A restricted/banned number
// sees sends "succeed" while no delivery receipt ever arrives. We record every
// outbound message id and warn if no delivery ack shows up within this window —
// that missing ack is the clearest signal the number is being throttled/banned.
const DELIVERY_TIMEOUT_MS = Number(process.env.WHATSAPP_DELIVERY_TIMEOUT_MS ?? 60_000)
const pendingDeliveries = new Map<string, { phone: string; timer: ReturnType<typeof setTimeout> }>()

function trackDelivery(msgId: string, phone: string): void {
  const timer = setTimeout(() => {
    if (!pendingDeliveries.delete(msgId)) return
    console.warn(
      `[whatsapp-client] NO delivery receipt for ${phone} (msg=${msgId}) after ${DELIVERY_TIMEOUT_MS}ms — ` +
        'message likely NOT delivered (number possibly restricted/banned by WhatsApp)',
    )
  }, DELIVERY_TIMEOUT_MS)
  pendingDeliveries.set(msgId, { phone, timer })
}

let sock: WASocket | null = null
let isConnected = false
let lastQr: string | null = null

async function initWhatsApp(): Promise<void> {
  // Dynamic import so Node.js loads Baileys (ESM) from this CJS module correctly
  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = await import(
    '@whiskeysockets/baileys'
  )
  const { Boom } = await import('@hapi/boom')

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR)

  const { default: pino } = await import('pino')
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
  })

  sock.ev.on('creds.update', saveCreds)

  // Delivery receipts. status >= 2 (DELIVERY_ACK) means the message reached the
  // recipient's device; anything less never leaves WhatsApp's servers.
  sock.ev.on('messages.update', (updates) => {
    for (const { key, update } of updates) {
      if (!key.id || update.status == null) continue
      const pending = pendingDeliveries.get(key.id)
      if (!pending) continue
      if (update.status >= 2) {
        clearTimeout(pending.timer)
        pendingDeliveries.delete(key.id)
        console.info(
          `[whatsapp-client] Delivered to ${pending.phone} (msg=${key.id}, status=${update.status})`,
        )
      }
    }
  })

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      lastQr = qr
      console.info('[whatsapp-client] QR generated — waiting for scan')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('qrcode-terminal').generate(qr, { small: true })
    }
    if (connection === 'open') {
      isConnected = true
      lastQr = null
      console.info('[whatsapp-client] Connected')
    } else if (connection === 'connecting') {
      console.info('[whatsapp-client] Connecting...')
    } else if (connection === 'close') {
      isConnected = false
      const boom = lastDisconnect?.error as InstanceType<typeof Boom>
      const statusCode = boom?.output?.statusCode
      const message = boom?.message ?? 'unknown'
      console.warn(`[whatsapp-client] Connection closed — statusCode=${statusCode} message="${message}"`)

      if (statusCode === DisconnectReason.loggedOut) {
        // WhatsApp invalidated the session. The stale creds keep failing with
        // 401 forever, so wipe them before re-init — otherwise no fresh QR is
        // ever produced and /whatsapp/qr is stuck reporting "initializing".
        console.error('[whatsapp-client] Logged out — clearing session to regenerate QR')
        await rm(SESSION_DIR, { recursive: true, force: true }).catch((err: Error) =>
          console.error('[whatsapp-client] Failed to clear session dir:', err.message),
        )
      } else {
        console.warn('[whatsapp-client] Reconnecting...')
      }

      // Reconnect with a fresh session if we just cleared it. Backoff avoids
      // hammering WhatsApp on a repeated failure.
      setTimeout(() => {
        initWhatsApp().catch((err: Error) =>
          console.error('[whatsapp-client] Reconnect failed:', err.message),
        )
      }, RECONNECT_DELAY_MS)
    }
  })
}

export function getWhatsappStatus(): { connected: boolean; qrPending: boolean } {
  return { connected: isConnected, qrPending: lastQr !== null }
}

export function getLastQr(): string | null {
  return lastQr
}

export function waitUntilConnected(timeoutMs = 90_000): Promise<void> {
  if (!ENABLED) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (isConnected) return resolve()
    const interval = setInterval(() => {
      if (isConnected) {
        clearInterval(interval)
        clearTimeout(timer)
        resolve()
      }
    }, 500)
    const timer = setTimeout(() => {
      clearInterval(interval)
      reject(new Error('WhatsApp connection timed out — did you scan the QR?'))
    }, timeoutMs)
  })
}

async function rawSend(phone: string, text: string): Promise<void> {
  const jid = phone.replace('+', '') + '@s.whatsapp.net'
  const result = await sock!.sendMessage(jid, { text })
  if (result?.key?.id) trackDelivery(result.key.id, phone)
}

// Single serialized, rate-limited queue for ALL outbound sends. Pacing logic lives
// in ./paced-queue.ts (unit-tested) — see that file for why gap-based pacing matters.
const queue = createPacedQueue({
  send: rawSend,
  delayMs: SEND_DELAY_MS,
  jitterMs: SEND_JITTER_MS,
  batchSize: BATCH_SIZE,
  batchPauseMs: BATCH_PAUSE_MS,
  onBatchPause: (queued) =>
    console.info(
      `[whatsapp-client] Sent batch of ${BATCH_SIZE} — pausing ${BATCH_PAUSE_MS}ms (${queued} queued)`,
    ),
})

export function sendWhatsappMessage(phone: string, text: string): Promise<void> {
  // Disabled by config (dev/test) — intentional silent no-op.
  if (!ENABLED) return Promise.resolve()

  // Enabled but not connected: reject so callers count it as failed and, crucially,
  // do NOT persist a dedup/reminder row for it. A silent resolve here made
  // notifications record as "sent" while nothing went out, permanently suppressing
  // the retry.
  if (!sock || !isConnected) {
    console.warn('[whatsapp-client] Not connected — send to', phone, 'will fail (retried next run)')
    return Promise.reject(new Error(`WhatsApp not connected — cannot send to ${phone}`))
  }

  return queue.enqueue(phone, text)
}

if (ENABLED) {
  initWhatsApp().catch((err: Error) =>
    console.error('[whatsapp-client] Init failed:', err.message),
  )
}
