import { emptySupportContacts, type SupportContacts, type SupportContactsSettings, type SupportQrSettings } from '../shared/support-contacts.ts'
import { ApiError, body, json, type Env } from './platform.ts'
import { emailValue, type Partner } from './partner-auth.ts'

export async function supportContactsSettings(env: Env, owner = 'platform'): Promise<SupportContactsSettings> {
  const row = await env.INTEREST_DB.prepare('SELECT wechat,qq,email,version FROM support_contacts WHERE owner=?').bind(owner).first<SupportContacts & { version: number }>()
  return { contacts: row ? { wechat: row.wechat, qq: row.qq, email: row.email } : { ...emptySupportContacts }, version: row?.version ?? 0 }
}

function contactText(value: unknown, max: number, name: string) {
  if (typeof value !== 'string' || value.length > max || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new ApiError(`请填写有效的${name}，或留空。`)
  return value.trim()
}

export async function supportContactsRoute(request: Request, env: Env, partner?: Partner) {
  const owner = partner?.id ?? 'platform'
  if (request.method === 'GET') return json(await supportContactsSettings(env, owner))
  if (request.method !== 'POST') throw new ApiError('请通过联系方式表单保存。', 405)
  const data = await body(request)
  const wechat = contactText(data.wechat, 64, '微信号')
  const qq = contactText(data.qq, 20, 'QQ 号')
  const emailText = contactText(data.email, 254, '邮箱')
  const email = emailText ? emailValue(emailText) : ''
  if (qq && !/^\d{5,20}$/.test(qq)) throw new ApiError('QQ 号需为 5–20 位数字，或留空。')
  if (!Number.isSafeInteger(data.version) || Number(data.version) < 0) throw new ApiError('联系方式版本无效，请刷新重试。')
  const current = await supportContactsSettings(env, owner)
  if (data.version !== current.version) throw new ApiError('联系方式已更新，请刷新后再保存。', 409)
  const id = crypto.randomUUID(); const now = Date.now()
  const columns = 'owner,partner_id,wechat,qq,email,version,change_id,updated_at'
  const conflict = ' ON CONFLICT(owner) DO UPDATE SET wechat=excluded.wechat,qq=excluded.qq,email=excluded.email,version=support_contacts.version+1,change_id=excluded.change_id,updated_at=excluded.updated_at WHERE support_contacts.version=?'
  const write = partner
    ? env.INTEREST_DB.prepare(`INSERT INTO support_contacts(${columns}) SELECT ?,id,?,?,?,1,?,? FROM partners WHERE id=? AND active=1 AND auth_version=?${conflict}`).bind(owner, wechat, qq, email, id, now, partner.id, partner.auth_version, current.version)
    : env.INTEREST_DB.prepare(`INSERT INTO support_contacts(${columns}) VALUES (?,NULL,?,?,?,1,?,?)${conflict}`).bind(owner, wechat, qq, email, id, now, current.version)
  await env.INTEREST_DB.batch([
    write,
    env.INTEREST_DB.prepare("INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,owner,'support-contacts',?,? FROM support_contacts WHERE owner=? AND change_id=?").bind(id, partner ? '代理修改商店联系方式' : env.ADMIN_USERNAME + '：修改平台联系方式', now, owner, id),
  ])
  if (!await env.INTEREST_DB.prepare('SELECT id FROM admin_audit WHERE id=?').bind(id).first()) throw new ApiError('账号或联系方式已更新，请刷新后再保存。', 409)
  return json(await supportContactsSettings(env, owner))
}

const QR_IMAGE_TYPES = [
  { prefix: 'data:image/png;base64,', type: 'image/png' },
  { prefix: 'data:image/jpeg;base64,', type: 'image/jpeg' },
  { prefix: 'data:image/webp;base64,', type: 'image/webp' },
] as const
const MAX_QR_BYTES = 300_000
type QrRow = { wechat_qr: string; updated_at: number }

function qrRow(env: Env, owner: string) {
  return env.INTEREST_DB.prepare('SELECT wechat_qr,updated_at FROM support_contacts WHERE owner=?').bind(owner).first<QrRow>()
}

function qrImage(qr: string) {
  const kind = QR_IMAGE_TYPES.find(item => qr.startsWith(item.prefix))
  if (!kind) return null
  let binary: string
  try { binary = atob(qr.slice(kind.prefix.length)) } catch { return null }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  if (!bytes.byteLength || bytes.byteLength > MAX_QR_BYTES) return null
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const webp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  if ((kind.type === 'image/png' && !png) || (kind.type === 'image/jpeg' && !jpeg) || (kind.type === 'image/webp' && !webp)) return null
  return { bytes, type: kind.type }
}

export async function supportQrSettings(env: Env, owner = 'platform', partnerSlug = ''): Promise<SupportQrSettings> {
  const row = await qrRow(env, owner)
  return { url: row?.wechat_qr ? `/api/support-qr?v=${row.updated_at}${partnerSlug ? '&partner=' + encodeURIComponent(partnerSlug) : ''}` : '' }
}

export async function supportQrImageRoute(request: Request, env: Env, url: URL) {
  if (url.pathname !== '/api/support-qr' || request.method !== 'GET') return null
  const slug = url.searchParams.get('partner') ?? ''
  let owner = 'platform'
  if (slug) {
    const partner = await env.INTEREST_DB.prepare('SELECT id FROM partners WHERE slug=? AND active=1').bind(slug).first<{ id: string }>()
    if (!partner) return json({ error: '未找到客服二维码。' }, 404)
    owner = partner.id
  }
  const row = await qrRow(env, owner)
  const image = row?.wechat_qr ? qrImage(row.wechat_qr) : null
  if (!row || !image) return json({ error: '未设置客服二维码。' }, 404)
  return new Response(image.bytes, { headers: {
    'Content-Type': image.type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  } })
}

export async function supportQrRoute(request: Request, env: Env, partner?: Partner) {
  const owner = partner?.id ?? 'platform'
  if (request.method === 'GET') return json(await supportQrSettings(env, owner, partner?.slug))
  if (request.method !== 'POST') throw new ApiError('请通过二维码上传保存。', 405)
  const data = await body(request, 500_000)
  if (typeof data.image !== 'string') throw new ApiError('请选择客服二维码图片。')
  const image = data.image
  if (image && !qrImage(image)) throw new ApiError('请上传 300KB 以内的 PNG、JPG 或 WebP 微信二维码。')
  const now = Date.now(), id = crypto.randomUUID()
  const action = image ? '更新' : '移除'
  const note = partner ? `代理${action}商店客服二维码` : `${env.ADMIN_USERNAME}：${action}客服二维码`
  const write = partner
    ? env.INTEREST_DB.prepare("INSERT INTO support_contacts(owner,partner_id,wechat_qr,updated_at,change_id) SELECT ?,id,?,?,? FROM partners WHERE id=? AND active=1 ON CONFLICT(owner) DO UPDATE SET wechat_qr=excluded.wechat_qr,updated_at=excluded.updated_at,change_id=excluded.change_id").bind(owner, image, now, id, partner.id)
    : env.INTEREST_DB.prepare("INSERT INTO support_contacts(owner,wechat_qr,updated_at,change_id) VALUES ('platform',?,?,?) ON CONFLICT(owner) DO UPDATE SET wechat_qr=excluded.wechat_qr,updated_at=excluded.updated_at,change_id=excluded.change_id").bind(image, now, id)
  await env.INTEREST_DB.batch([
    write,
    env.INTEREST_DB.prepare("INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,owner,'support-qr',?,? FROM support_contacts WHERE owner=? AND change_id=?").bind(id, note, now, owner, id),
  ])
  if (!await env.INTEREST_DB.prepare('SELECT id FROM admin_audit WHERE id=?').bind(id).first()) throw new ApiError('联系方式已更新，请刷新后再保存。', 409)
  return json(await supportQrSettings(env, owner, partner?.slug))
}
