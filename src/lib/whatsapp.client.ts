import type { WASocket } from '@whiskeysockets/baileys'

const SESSION_DIR = process.env.BAILEYS_SESSION_DIR ?? '.baileys-session'
const ENABLED = process.env.WHATSAPP_ENABLED === 'true'

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

export async function sendWhatsappMessage(phone: string, text: string): Promise<void> {
  if (!ENABLED || !sock || !isConnected) {
    console.warn('[whatsapp-client] Not connected — skipping send to', phone)
    return
  }

  const jid = phone.replace('+', '') + '@s.whatsapp.net'
  await sock.sendMessage(jid, { text })
}

if (ENABLED) {
  initWhatsApp().catch((err: Error) =>
    console.error('[whatsapp-client] Init failed:', err.message),
  )
}
