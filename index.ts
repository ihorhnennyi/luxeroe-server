import cors from 'cors'
import 'dotenv/config'
import express, { type NextFunction, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { LRUCache } from 'lru-cache'
import { sendToTelegram, type OrderPayload } from './telegram'

const app = express()

app.set('trust proxy', 1)
app.use(cors())
app.use(express.json({ limit: '200kb' }))

const isNonEmpty = (v: any) => typeof v === 'string' && v.trim().length > 0
const isPhone = (v: any) => /^\+?\d[\d\s-]{8,}$/.test(String(v || ''))

const orderLimiter = rateLimit({
  windowMs: 2 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false
})
const leadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false
})

function honeypot(req: Request, res: Response, next: NextFunction) {
  const trap = (req.body?.company || req.body?.email2 || '').toString().trim()
  if (trap) return res.status(400).json({ ok: false, error: 'Bot rejected' })
  next()
}

const dedupe = new LRUCache<string, number>({ max: 5000, ttl: 2 * 60 * 1000 })

function dedupeGuard(req: Request, res: Response, next: NextFunction) {
  const p = req.body || {}
  const key =
    p.kind === 'order'
      ? JSON.stringify({
          k: 'order',
          phone: p.customer?.phone,
          city: p.delivery?.city,
          address: p.delivery?.address,
          items: (p.items || []).map((i: any) => ({
            t: i.title,
            l: i.label,
            q: i.qty,
            p: i.price
          })),
          total: p.total
        })
      : JSON.stringify({
          k: 'lead',
          phone: p.customer?.phone,
          name: `${p.customer?.firstName || ''}`.trim()
        })

  if (dedupe.has(key)) {
    return res.status(429).json({ ok: false, error: 'Duplicate submit' })
  }
  dedupe.set(key, Date.now())
  next()
}

function validateOrder(req: Request, res: Response, next: NextFunction) {
  const p = req.body as OrderPayload
  const bad = (m: string) => res.status(400).json({ ok: false, error: m })

  if (!isNonEmpty(p?.customer?.firstName)) return bad('firstName required')
  if (!isNonEmpty(p?.customer?.lastName)) return bad('lastName required')
  if (!isPhone(p?.customer?.phone)) return bad('phone invalid')
  if (!isNonEmpty(p?.delivery?.city)) return bad('city required')
  if (!isNonEmpty(p?.delivery?.address)) return bad('address required')
  if (!Array.isArray(p?.items) || p.items.length < 1) return bad('items required')
  if (!Number.isFinite(Number(p?.total))) return bad('total required')

  next()
}

function validateLead(req: Request, res: Response, next: NextFunction) {
  const p = req.body as OrderPayload
  const bad = (m: string) => res.status(400).json({ ok: false, error: m })

  if (!isNonEmpty(p?.customer?.firstName)) return bad('firstName required')
  if (!isPhone(p?.customer?.phone)) return bad('phone invalid')

  next()
}

app.get('/health', (_req, res) => res.json({ ok: true }))

app.post(
  '/api/telegram/order',
  orderLimiter,
  honeypot,
  validateOrder,
  dedupeGuard,
  async (req: Request, res: Response) => {
    try {
      await sendToTelegram({ ...req.body, kind: 'order' })
      res.json({ ok: true })
    } catch (e: any) {
      console.error(e)
      res.status(502).json({ ok: false, error: 'Upstream error' })
    }
  }
)

app.post(
  '/api/telegram/lead',
  leadLimiter,
  honeypot,
  validateLead,
  dedupeGuard,
  async (req: Request, res: Response) => {
    try {
      const payload: OrderPayload = {
        kind: 'lead',
        customer: {
          firstName: req.body?.customer?.firstName?.trim() || '',
          lastName: '',
          phone: String(req.body?.customer?.phone || '').trim()
        },
        items: [],
        total: 0,
        sourceUrl: req.body?.sourceUrl
      }
      await sendToTelegram(payload)
      res.json({ ok: true })
    } catch (e: any) {
      console.error(e)
      res.status(502).json({ ok: false, error: 'Upstream error' })
    }
  }
)

const PORT = Number(process.env.PORT || 5050)
app.listen(PORT, () => {
  console.log(`Telegram bridge listening on :${PORT}`)
})
