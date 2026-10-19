import { ApiError, type Env } from './platform.ts'

// Sealed payloads use AES-256-GCM with a key derived from DELIVERY_SECRET.
// A separate HMAC fingerprint supports duplicate detection without exposing
// low-entropy card keys to offline comparison in the database.

const encoder = new TextEncoder()

function secret(env: Env) {
  const value = env.DELIVERY_SECRET ?? ''
  if (value.length < 32) throw new ApiError('发货加密尚未配置，请联系管理员。', 503)
  return value
}

function toBase64(bytes: Uint8Array) {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
}

function fromBase64(value: string) {
  const raw = atob(value)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

async function deriveKey(env: Env) {
  const material = await crypto.subtle.digest('SHA-256', encoder.encode('gptibo-delivery-v1:' + secret(env)))
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function hmacKey(env: Env) {
  return crypto.subtle.importKey('raw', encoder.encode('gptibo-fingerprint-v1:' + secret(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

export async function fingerprint(env: Env, value: string) {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(env), encoder.encode(value))
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function seal(env: Env, plaintext: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(env), encoder.encode(plaintext))
  return { ciphertext: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv), fingerprint: await fingerprint(env, plaintext) }
}

export async function unseal(env: Env, ciphertext: string, iv: string) {
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, await deriveKey(env), fromBase64(ciphertext))
    return new TextDecoder().decode(plaintext)
  } catch {
    throw new ApiError('发货资料无法解密，请联系管理员核对密钥。', 503)
  }
}
