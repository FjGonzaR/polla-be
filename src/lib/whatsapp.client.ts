import type { WASocket } from '@whiskeysockets/baileys'

const SESSION_DIR = process.env.BAILEYS_SESSION_DIR ?? '.baileys-session'
const ENABLED = process.env.WHATSAPP_ENABLED === 'true'

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

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
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
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      if (shouldReconnect) {
        console.warn('[whatsapp-client] Reconnecting...')
        initWhatsApp().catch((err: Error) =>
          console.error('[whatsapp-client] Reconnect failed:', err.message),
        )
      } else {
        console.error('[whatsapp-client] Logged out — re-scan QR to reconnect')
      }
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface QueuedSend {
  phone: string
  text: string
  resolve: () => void
  reject: (err: Error) => void
}

const sendQueue: QueuedSend[] = []
let queueRunning = false
let sentSinceBatchPause = 0

async function rawSend(phone: string, text: string): Promise<void> {
  const jid = phone.replace('+', '') + '@s.whatsapp.net'
  await sock!.sendMessage(jid, { text })
}

// Drains the queue one message at a time, pacing sends. Never runs concurrently
// with itself (guarded by queueRunning), so all sends are strictly serialized.
async function processQueue(): Promise<void> {
  if (queueRunning) return
  queueRunning = true
  try {
    while (sendQueue.length > 0) {
      const job = sendQueue.shift()!
      try {
        await rawSend(job.phone, job.text)
        job.resolve()
      } catch (err) {
        job.reject(err as Error)
      }
      sentSinceBatchPause++

      if (sendQueue.length === 0) {
        // Queue drained — reset batch counter so the next burst starts fresh.
        sentSinceBatchPause = 0
        break
      }

      if (BATCH_SIZE > 0 && sentSinceBatchPause >= BATCH_SIZE) {
        sentSinceBatchPause = 0
        console.info(
          `[whatsapp-client] Sent batch of ${BATCH_SIZE} — pausing ${BATCH_PAUSE_MS}ms (${sendQueue.length} queued)`,
        )
        await sleep(BATCH_PAUSE_MS)
      } else {
        const jitter = SEND_JITTER_MS > 0 ? Math.floor(Math.random() * SEND_JITTER_MS) : 0
        await sleep(SEND_DELAY_MS + jitter)
      }
    }
  } finally {
    queueRunning = false
  }
}

export function sendWhatsappMessage(phone: string, text: string): Promise<void> {
  if (!ENABLED || !sock || !isConnected) {
    console.warn('[whatsapp-client] Not connected — skipping send to', phone)
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    sendQueue.push({ phone, text, resolve, reject })
    void processQueue()
  })
}

if (ENABLED) {
  initWhatsApp().catch((err: Error) =>
    console.error('[whatsapp-client] Init failed:', err.message),
  )
}
