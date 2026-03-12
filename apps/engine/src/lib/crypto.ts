import crypto from 'crypto'

/**
 * Decrypt a string produced by the web app's encryptField().
 * Expects "iv:authTag:ciphertext" format (all hex-encoded).
 * Uses AES-256-GCM with the APP_SECRET env var.
 */
export function decryptField(encrypted: string): string {
  const secret = process.env.APP_SECRET ?? process.env.SESSION_SECRET
  if (!secret) {
    throw new Error('APP_SECRET (or SESSION_SECRET) env var is required for decryption')
  }

  const parts = encrypted.split(':')
  if (parts.length < 3) {
    throw new Error('Invalid encrypted field format')
  }
  const [ivHex, authTagHex, ...rest] = parts
  const ciphertext = rest.join(':') // ciphertext may be empty for empty string input
  if (!ivHex || !authTagHex) {
    throw new Error('Invalid encrypted field format')
  }

  const key = crypto.scryptSync(secret, 'lead-routing-field-enc', 32)
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivHex, 'hex'),
  )
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}
