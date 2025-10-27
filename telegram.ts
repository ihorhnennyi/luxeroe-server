import fetch from 'node-fetch'

export type OrderItem = { title: string; label?: string; qty: number; price: number }

export type OrderPayload = {
  kind: 'order' | 'lead'
  customer: { firstName: string; lastName: string; phone: string }
  delivery?: { city?: string; address?: string }
  items: OrderItem[]
  total: number
  sourceUrl?: string
  company?: string
  email2?: string
}

const BOT = process.env.TELEGRAM_BOT_TOKEN!
const ORDERS_CHAT = process.env.TELEGRAM_ORDERS_CHAT_ID!
const ORDERS_THREAD = Number(process.env.TELEGRAM_ORDERS_THREAD_ID || 0)
const LEADS_CHAT = process.env.TELEGRAM_LEADS_CHAT_ID || ORDERS_CHAT
const LEADS_THREAD = Number(process.env.TELEGRAM_LEADS_THREAD_ID || 0)
const TG = `https://api.telegram.org/bot${BOT}`

function escMD(s: string = '') {
  return s
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/~/g, '\\~')
    .replace(/`/g, '\\`')
    .replace(/>/g, '\\>')
    .replace(/#/g, '\\#')
    .replace(/\+/g, '\\+')
    .replace(/-/g, '\\-')
    .replace(/=/g, '\\=')
    .replace(/\|/g, '\\|')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\./g, '\\.')
    .replace(/!/g, '\\!')
}

function formatUAH(n: number) {
  return new Intl.NumberFormat('uk-UA').format(Math.round(n)) + ' ₴'
}

export function composeMessage(p: OrderPayload) {
  const { customer, delivery, items, total, sourceUrl, kind } = p

  const head = kind === 'order' ? '*Новий заказ*' : '*Нова заявка*'
  const name = `${customer.lastName ?? ''} ${customer.firstName ?? ''}`.trim()
  const phone = customer.phone?.trim() ?? ''

  const lines: string[] = []
  lines.push(head, '')

  lines.push(`👤 *Клієнт:* \`${escMD(name)}\``)
  lines.push(`📞 *Телефон:* \`${escMD(phone)}\``)

  if (kind === 'order') {
    const city = delivery?.city ?? '—'
    const addr = delivery?.address ?? '—'
    lines.push(`🚚 *Місто/Відділення:* \`${escMD(city)} / ${escMD(addr)}\``)
  }

  if (kind === 'order' && items?.length) {
    lines.push('', `*Позиції:*`)
    for (const it of items) {
      const title = `${it.title}${it.label ? ` — ${it.label}` : ''}`
      lines.push(`• ${escMD(title)} × ${it.qty} — \`${escMD(formatUAH(it.price))}\``)
    }
  }

  if (kind === 'order') {
    lines.push('', `💰 *Разом:* \`${escMD(formatUAH(total))}\``)
  }

  if (sourceUrl) {
    lines.push(`🔗 *Джерело:* ${escMD(sourceUrl)}`)
  }

  return lines.join('\n')
}

export async function sendToTelegram(payload: OrderPayload) {
  const chat_id = payload.kind === 'order' ? ORDERS_CHAT : LEADS_CHAT
  const message_thread_id = payload.kind === 'order' ? ORDERS_THREAD : LEADS_THREAD
  const text = composeMessage(payload)

  const baseBody: any = {
    chat_id,
    text,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true
  }

  const bodyWithThread = message_thread_id ? { ...baseBody, message_thread_id } : baseBody

  let res = await fetch(`${TG}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyWithThread)
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    if (errText.includes('message thread not found')) {
      res = await fetch(`${TG}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baseBody)
      })
    } else {
      throw new Error(`Telegram error: ${res.status} ${errText}`)
    }
  }

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Telegram error: ${res.status} ${err}`)
  }

  console.log(`[OK] Message sent (${payload.kind})`)
}
