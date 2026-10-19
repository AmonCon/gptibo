import { useStorefrontI18n } from '@/lib/storefront-i18n'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CopyButton } from '@/components/copy-button'
import { Feedback } from '@/components/workspace-loading'
import { api, errorMessage } from '@/lib/api'
import { formatCatalogPrice } from '@/lib/catalog-display'
import { useResource } from '@/lib/use-resource'
import type { SupportContacts, SupportContactsSettings, SupportQrSettings } from '../../shared/support-contacts'
import './support-contacts.css'

async function compressQrImage(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPG 或 WebP 图片。')
  if (file.size > 8 * 1024 * 1024) throw new Error('图片不能超过 8MB。')
  const bitmap = await createImageBitmap(file)
  try {
    let limit = 640
    let data = ''
    for (let attempt = 0; attempt < 4; attempt++) {
      const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('当前浏览器无法处理图片。')
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      data = canvas.toDataURL('image/webp', 0.86)
      if (data.length <= 380_000) break
      limit = Math.round(limit * 0.75)
    }
    if (!data || data.length > 400_000) throw new Error('二维码图片过大，请换一张更小的图片。')
    return data
  } finally { bitmap.close() }
}

function WechatQrField({ endpoint }: { endpoint: string }) {
  const [revision, setRevision] = useState(0)
  const { data, error, loading } = useResource<SupportQrSettings>(endpoint, revision)
  const [busy, setBusy] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [notice, setNotice] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const url = data?.url ?? ''
  async function upload(file: File | undefined) {
    if (!file || busy) return
    setBusy(true); setUploadError(''); setNotice('')
    try {
      const image = await compressQrImage(file)
      await api(endpoint, { image })
      setNotice('客服二维码已保存')
      setRevision(value => value + 1)
    } catch (e) { setUploadError(errorMessage(e)) }
    finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  async function remove() {
    if (busy) return
    setBusy(true); setUploadError(''); setNotice('')
    try {
      await api(endpoint, { image: '' })
      setNotice('客服二维码已移除')
      setRevision(value => value + 1)
    } catch (e) { setUploadError(errorMessage(e)) }
    finally { setBusy(false) }
  }
  return <div className="support-qr-field">
    <div className="support-qr-preview">{url ? <img src={url} alt="客服微信二维码" /> : <span>未设置二维码</span>}</div>
    <div className="support-qr-copy">
      <strong>客服微信二维码</strong>
      <p>客户在商品页点击购买时会看到这张二维码。建议上传微信「加我为朋友」的二维码。</p>
      <div className="support-qr-actions">
        <Button type="button" variant="outline" onClick={() => input.current?.click()} disabled={busy || loading}>{busy ? '处理中…' : url ? '更换二维码' : '上传二维码'}</Button>
        {url && <Button type="button" variant="ghost" onClick={() => void remove()} disabled={busy}>移除</Button>}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => void upload(event.target.files?.[0])} />
      {!url && loading && <span className="support-qr-status">正在读取…</span>}
      <Feedback error={uploadError || error} shape="compact" />
      {notice && <p className="support-qr-notice" role="status"><Check size={14} />{notice}</p>}
    </div>
  </div>
}

function ContactsForm({ endpoint, settings, loading, readOnly, onSaved, onEditing }: { endpoint: string; settings: SupportContactsSettings; loading: boolean; readOnly: boolean; onSaved: () => void; onEditing: () => void }) {
  const [contacts, setContacts] = useState(settings.contacts)
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const changed = Object.keys(contacts).some(key => contacts[key as keyof SupportContacts] !== settings.contacts[key as keyof SupportContacts])
  function edit(key: keyof SupportContacts, value: string) { setContacts(previous => ({ ...previous, [key]: value })); setError(''); onEditing() }
  async function save() {
    if (busy || loading || readOnly || !changed) return
    setBusy(true); setError('')
    try { await api<SupportContactsSettings>(endpoint, { ...contacts, version: settings.version }); onSaved() }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return <form className="support-settings-form" onSubmit={e => { e.preventDefault(); void save() }}>
    <FieldGroup>
      <Field><FieldLabel htmlFor="support-wechat">微信</FieldLabel><Input id="support-wechat" value={contacts.wechat} onChange={e => edit('wechat', e.target.value)} maxLength={64} autoComplete="off" placeholder="微信号" disabled={busy || readOnly} /></Field>
      <Field><FieldLabel htmlFor="support-qq">QQ</FieldLabel><Input id="support-qq" value={contacts.qq} onChange={e => edit('qq', e.target.value)} maxLength={20} inputMode="numeric" autoComplete="off" placeholder="QQ 号" disabled={busy || readOnly} /></Field>
      <Field><FieldLabel htmlFor="support-email">联系邮箱</FieldLabel><Input id="support-email" type="email" value={contacts.email} onChange={e => edit('email', e.target.value)} maxLength={254} autoComplete="off" placeholder="用于客户咨询的邮箱" disabled={busy || readOnly} /><FieldDescription>留空的联系方式不会显示。此邮箱仅用于联系支持。</FieldDescription></Field>
    </FieldGroup>
    <Feedback error={error} />
    {!readOnly && <Button type="submit" disabled={busy || loading || !changed}>{busy ? '保存中…' : '保存联系方式'}</Button>}
  </form>
}

export function SupportContactsPanel({ endpoint, qrEndpoint, revision = 0, title = '平台联系方式', description = '显示在平台商店的“联系支持”中。', readOnly = false, onSummaryChange }: { endpoint: string; qrEndpoint?: string; revision?: number; title?: string; description?: string; readOnly?: boolean; onSummaryChange?: (summary: string) => void }) {
  const [localRevision, setLocalRevision] = useState(0); const [message, setMessage] = useState('')
  const { data, error, loading } = useResource<SupportContactsSettings>(endpoint, revision + localRevision)
  useEffect(() => {
    const channels = data ? [data.contacts.wechat && '微信', data.contacts.qq && 'QQ', data.contacts.email && '邮箱'].filter(Boolean) : []
    onSummaryChange?.(error ? '读取失败，展开后重试' : data ? channels.length ? `已设置${channels.join('、')}` : '未设置 · 添加客户联系渠道' : '正在读取…')
  }, [data, error, onSummaryChange])
  return <section className="admin-panel support-settings-panel">
    <div className="admin-panel-title"><h2>{title}</h2><Button type="button" variant="ghost" size="icon" aria-label="刷新联系方式" disabled={loading} onClick={() => { setMessage(''); setLocalRevision(value => value + 1) }}><RefreshCw size={15} /></Button></div>
    <p className="support-settings-description">{description}</p>
    {qrEndpoint && <WechatQrField endpoint={qrEndpoint} />}
    <Feedback error={error} loading={loading} data={data} shape="compact" />
    {data && <ContactsForm key={endpoint + ':' + data.version} endpoint={endpoint} settings={data} loading={loading} readOnly={readOnly} onEditing={() => setMessage('')} onSaved={() => { setMessage('联系方式已保存'); setLocalRevision(value => value + 1) }} />}
    {message && <p className="support-settings-success" role="status"><Check size={14} />{message}</p>}
  </section>
}

function ContactChannels({ contacts }: { contacts: SupportContacts }) {
  const { t } = useStorefrontI18n()
  const channels = [{ key: 'wechat', label: '微信', value: contacts.wechat }, { key: 'qq', label: 'QQ', value: contacts.qq }, { key: 'email', label: '邮箱', value: contacts.email }].filter(item => item.value)
  if (!channels.length) return null
  return <dl className="support-contact-list">{channels.map(item => <div className="support-contact-row" key={item.key}>
    <dt>{t(item.label)}</dt>
    <dd>{item.key === 'email' ? <a href={'mailto:' + encodeURIComponent(item.value)}>{item.value}</a> : item.value}</dd>
    <CopyButton className="support-contact-copy" variant="ghost" size="icon" iconOnly label={t('复制{channel}', { channel: t(item.label) })} title={t('复制{channel}', { channel: t(item.label) })} value={item.value} />
  </div>)}</dl>
}

export function SupportContactsDialog({ open, onOpenChange, contacts, wechatQr, name, error, onHelp, onRetry }: { open: boolean; onOpenChange: (open: boolean) => void; contacts?: SupportContacts; wechatQr?: string; name: string; error?: string; onHelp: () => void; onRetry: () => void }) {
  const { t } = useStorefrontI18n()
  const hasChannels = Boolean(contacts && (contacts.wechat || contacts.qq || contacts.email))
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="support-contacts-dialog motion-dialog">
    <DialogHeader><DialogTitle>{t('联系支持')}</DialogTitle><DialogDescription>{contacts ? name : t('正在读取商店联系方式…')}</DialogDescription></DialogHeader>
    <div className="support-contact-body">
      {wechatQr && <div className="support-qr"><img src={wechatQr} alt={t('客服微信二维码')} /><p>{t('扫码添加客服微信')}</p></div>}
      {!contacts ? <><Feedback error={error ? t(error) : undefined} loading={!error} shape="compact" />{error && <Button variant="outline" onClick={onRetry}>{t('重新读取')}</Button>}</> : hasChannels ? <ContactChannels contacts={contacts} /> : !wechatQr ? <div className="support-contact-empty"><p>{t('商店暂未提供联系方式')}</p><span>{t('已有订单可在“我的订单”查看进度或申请售后。')}</span></div> : null}
    </div>
    <DialogFooter className="support-contact-footer"><Button className="support-help-button" variant="ghost" onClick={() => { onOpenChange(false); onHelp() }}><span>{t('查看常见问题')}</span><ArrowRight data-icon="inline-end" /></Button></DialogFooter>
  </DialogContent></Dialog>
}

export type PurchaseContact = { productName: string; planName?: string; price?: number }

export function PurchaseContactDialog({ open, onOpenChange, contacts, wechatQr, name, purchase }: { open: boolean; onOpenChange: (open: boolean) => void; contacts?: SupportContacts; wechatQr?: string; name: string; purchase?: PurchaseContact }) {
  const { t } = useStorefrontI18n()
  const hasChannels = Boolean(contacts && (contacts.wechat || contacts.qq || contacts.email))
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="support-contacts-dialog purchase-contact-dialog motion-dialog">
    <DialogHeader><DialogTitle>{t('微信联系购买')}</DialogTitle><DialogDescription>{name} · {t('客服确认后付款与发货')}</DialogDescription></DialogHeader>
    <div className="support-contact-body">
      {purchase && <div className="purchase-contact-summary">
        <div><span>{t('商品')}</span><strong>{purchase.productName}{purchase.planName ? <small> · {purchase.planName}</small> : null}</strong></div>
        {purchase.price != null && <div className="purchase-contact-price"><span>{t('金额')}</span><strong>¥{formatCatalogPrice(purchase.price)}</strong></div>}
      </div>}
      {wechatQr && <div className="support-qr"><img src={wechatQr} alt={t('客服微信二维码')} /><p>{t('扫码添加客服微信')}</p></div>}
      {contacts ? <ContactChannels contacts={contacts} /> : <Feedback loading shape="compact" />}
      {contacts && !hasChannels && !wechatQr && <div className="support-contact-empty"><p>{t('商店暂未提供联系方式')}</p><span>{t('请稍后再试，或返回商品页查看其他购买方式。')}</span></div>}
      <p className="purchase-contact-note">{t('添加客服后，请发送商品和套餐名称；客服确认库存与交付时间后再付款。')}</p>
    </div>
    <DialogFooter className="purchase-contact-footer"><Button onClick={() => onOpenChange(false)}>{t('知道了')}</Button></DialogFooter>
  </DialogContent></Dialog>
}
