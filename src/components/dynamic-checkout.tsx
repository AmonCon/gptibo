import { useEffect, useRef, useState } from 'react'
import { toString as qrToString } from 'qrcode'
import { ArrowRight, Check, Clock3, Copy, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Feedback } from '@/components/workspace-loading'
import { EmailAutocomplete } from './email-autocomplete'
import { OrderVerification } from './order-verification'
import { orderEmailProblem } from '@/lib/email'
import { api, errorMessage } from '@/lib/api'
import { visiblePolling } from '@/lib/visible-polling'
import type { ServerOrder } from '@/lib/use-store'
import type { CatalogPlan } from '@/lib/api'
import { ORDER_LABELS } from '@/lib/demo-orders'
import { FULFILLMENT_LABELS, type DynamicProduct, type InputField } from '../../shared/dynamic-products'
import './dynamic-checkout.css'

type Props = {
  product?: DynamicProduct
  plan?: CatalogPlan
  existingOrder?: ServerOrder
  open: boolean
  onOpenChange: (open: boolean) => void
  onOrders: () => void
  onCreate?: (planId: string, price: number, email: string, inputs: Record<string, string>) => Promise<ServerOrder | undefined>
  onOrderUpdated: (order: ServerOrder) => void
}

function parseFields(raw: string | undefined): InputField[] {
  try { const parsed: unknown = JSON.parse(raw ?? '[]'); return Array.isArray(parsed) ? parsed as InputField[] : [] } catch { return [] }
}

export function DynamicCheckout({ product, plan, existingOrder, open, onOpenChange, onOrders, onCreate, onOrderUpdated }: Props) {
  const fields = plan ? parseFields(plan.input_fields) : []
  const [email, setEmail] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [verification, setVerification] = useState({ ready: false, token: '' })
  const [verificationRevision, setVerificationRevision] = useState(0)
  const [order, setOrder] = useState<ServerOrder | null>(null)
  const [payment, setPayment] = useState<{ status: string; qr: string | null; expiresAt: number } | null>(null)
  const [qrImage, setQrImage] = useState('')
  const [delivery, setDelivery] = useState<{ kind: string; payload: Record<string, string>; note: string } | null>(null)
  const [showDelivery, setShowDelivery] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [touched, setTouched] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)
  const emailProblem = orderEmailProblem(email)

  useEffect(() => {
    if (!open) return
    setOrder(existingOrder ?? null); setPayment(null); setDelivery(null); setShowDelivery(false); setError(''); setTouched(false)
    setValues({}); setVerification({ ready: false, token: '' }); setVerificationRevision(v => v + 1)
    // Reset whenever a different order or plan opens the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan?.id, existingOrder?.id])

  async function submit() {
    if (busy || submitting.current || !plan) return
    setTouched(true)
    if (emailProblem) { emailRef.current?.focus(); return }
    for (const field of fields) {
      if (field.required && !values[field.key]?.trim()) { setError(`请填写${field.label}。`); return }
    }
    if (!verification.ready) { setError('请先完成人机验证。'); return }
    submitting.current = true; setBusy(true); setError('')
    try {
      const created = await onCreate?.(plan.id, plan.price_cents / 100, email.trim().toLowerCase(), Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()])))
      if (created) { setOrder(created); setVerification({ ready: false, token: '' }) }
    } catch (e) { setError(errorMessage(e)) } finally { submitting.current = false; setBusy(false) }
  }

  async function pay(command: 'create' | 'query') {
    if (!order || busy) return
    setBusy(true); setError('')
    try {
      const result = await api<{ payment: { status: string; qr: string | null; expiresAt: number } | null }>(`/api/orders/${order.id}/payment`, { action: command })
      setPayment(result.payment)
      const refreshed = await api<{ order: ServerOrder }>(`/api/orders/${order.id}`)
      setOrder(refreshed.order); onOrderUpdated(refreshed.order)
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  const paid = order?.paymentStatus === 'paid' || order?.status !== 'pending'
  useEffect(() => {
    if (!payment?.qr) return
    let active = true
    void qrToString(payment.qr, { type: 'svg', width: 180, margin: 2 }).then(svg => { if (active) setQrImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`) }).catch(() => { if (active) setQrImage('') })
    return () => { active = false }
  }, [payment?.qr])

  useEffect(() => {
    if (!open || !order || paid) return
    return visiblePolling(async () => { await pay('query') }, 5000)
    // Polling only depends on the order's current stage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id, order?.status, order?.paymentStatus])

  useEffect(() => {
    if (!order?.fulfillmentMode || !['success', 'processing'].includes(order.status)) return
    let active = true
    void api<{ delivery: { kind: string; payload: Record<string, string>; note: string } | null }>(`/api/orders/${order.id}/delivery`)
      .then(result => { if (active) setDelivery(result.delivery) })
      .catch(() => { /* keep the status card; the buyer can retry */ })
    return () => { active = false }
  }, [order?.id, order?.status, order?.fulfillmentMode])

  const status = order ? ORDER_LABELS[order.status] ?? order.status : ''
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value) }}>
    <DialogContent className="motion-dialog dynamic-checkout" showCloseButton={!busy}>
      <DialogHeader>
        <DialogTitle>{order ? `${product?.name ?? order.planName} · ${plan?.name ?? order.planName}` : `购买 ${product?.name ?? ''}`}</DialogTitle>
        <DialogDescription>{order ? '订单状态会自动更新，也可以稍后在「我的订单」查看。' : '填写接收通知的邮箱；需要买家资料的商品会在此一并提交。'}</DialogDescription>
      </DialogHeader>
      {!order ? <form className="dynamic-checkout-form" noValidate onSubmit={event => { event.preventDefault(); void submit() }}>
        <label htmlFor="dynamic-email">下单邮箱 <span>必填</span></label>
        <EmailAutocomplete ref={emailRef} id="dynamic-email" required maxLength={254} value={email} onValueChange={setEmail} onBlur={() => setTouched(true)} disabled={busy} placeholder="you@qq.com" />
        {touched && emailProblem && <p className="dynamic-field-error" role="alert">{emailProblem}</p>}
        {fields.map(field => <div key={field.key} className="dynamic-input-field">
          <label htmlFor={`dynamic-${field.key}`}>{field.label}{field.required && <span> 必填</span>}</label>
          {field.type === 'textarea'
            ? <textarea id={`dynamic-${field.key}`} value={values[field.key] ?? ''} onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))} maxLength={field.maxLength} rows={3} disabled={busy} placeholder={field.placeholder} />
            : <Input id={`dynamic-${field.key}`} type={field.type === 'email' ? 'email' : 'text'} value={values[field.key] ?? ''} onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))} maxLength={field.maxLength} disabled={busy} placeholder={field.placeholder} autoComplete="off" />}
          {field.help && <p className="dynamic-field-help">{field.help}</p>}
        </div>)}
        {plan?.purchase_note && <details className="dynamic-purchase-note"><summary>购买说明</summary><p>{plan.purchase_note}</p></details>}
        <div className="dynamic-summary"><span>应付金额</span><strong>¥{((plan?.price_cents ?? 0) / 100).toFixed(2)}</strong></div>
        <OrderVerification key={verificationRevision} onChange={setVerification} />
        <Feedback error={error} />
        <Button className="primary-action" type="submit" disabled={busy || !verification.ready}>{busy ? '正在创建订单…' : '提交订单并付款'} <ArrowRight size={16} /></Button>
        <p className="dynamic-safe-note"><ShieldCheck size={13} />资料仅用于本订单交付，加密保存。</p>
      </form> : <>
        <div className="dynamic-order-summary"><span>订单号</span><strong>{order.id}</strong><span>状态</span><strong>{status}</strong><span>金额</span><strong>¥{order.price.toFixed(2)}</strong><span>交付</span><strong>{FULFILLMENT_LABELS[(order.fulfillmentMode ?? 'manual') as keyof typeof FULFILLMENT_LABELS]}</strong></div>
        {order.status === 'pending' && !paid && <section className="dynamic-payment" aria-label="付款">
          <p>使用支付宝扫码付款，付款结果会自动确认。</p>
          {payment?.qr ? <div className="dynamic-qr">
            {qrImage ? <img src={qrImage} width={180} height={180} alt="支付宝付款二维码" /> : <span className="dynamic-qr-loading">正在生成二维码…</span>}
            <a href={payment.qr} target="_blank" rel="noopener noreferrer">在支付宝中打开 <ExternalLink size={13} /></a>
          </div> : <Button variant="outline" disabled={busy} onClick={() => void pay('create')}>{busy ? '正在生成…' : '生成付款二维码'}</Button>}
          <Button variant="ghost" disabled={busy} onClick={() => void pay('query')}><RefreshCw size={14} />{busy ? '正在确认…' : '我已付款，确认状态'}</Button>
        </section>}
        {order.status !== 'pending' && <section className="dynamic-status" aria-live="polite">
          <div className="dynamic-status-icon">{order.status === 'success' ? <Check size={26} /> : <Clock3 size={26} />}</div>
          <h3>{order.status === 'success' ? '已完成' : order.status === 'failed' ? '处理遇到问题' : '正在处理'}</h3>
          <p>{order.status === 'success' ? '交付内容已生成，请妥善保管。' : order.status === 'failed' ? '请在原订单联系支持，无需重新付款。' : '工作人员处理后会更新这里，无需重复下单。'}</p>
        </section>}
        {delivery && (showDelivery ? <section className="dynamic-delivery" aria-label="交付内容">
          <h3>交付内容</h3>
          <dl>{Object.entries(delivery.payload).map(([key, value]) => <div key={key}><dt>{key}</dt><dd><code>{value}</code><button type="button" onClick={() => void navigator.clipboard.writeText(value)} aria-label={`复制 ${key}`}><Copy size={13} /></button></dd></div>)}</dl>
          {delivery.note && <p>{delivery.note}</p>}
          <p className="dynamic-safe-note">请勿转发给他人；如遇问题请在原订单联系支持。</p>
        </section> : <Button variant="outline" onClick={() => setShowDelivery(true)}>查看交付内容</Button>)}
        <Feedback error={error} />
        <Button className="primary-action" onClick={onOrders}>查看我的订单 <ArrowRight size={16} /></Button>
      </>}
    </DialogContent>
  </Dialog>
}
