import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

interface Branding {
  productName: string
  contactEmail: string | null
  vendorName: string | null
}

const NAME_MAX = 80
const CONTROL_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]/u
const EMAIL_SHAPE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/
const KNOWN_KEYS = ['productName', 'contactEmail', 'vendorName']

function fail(file: string, message: string): never {
  throw new Error(`Invalid branding file ${file}: ${message}`)
}

function checkName(file: string, key: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') fail(file, `"${key}" must be a non-empty string`)
  if (value.length > NAME_MAX) fail(file, `"${key}" must be at most ${NAME_MAX} characters`)
  if (CONTROL_CHARS.test(value)) fail(file, `"${key}" must not contain control characters`)
  return value
}

function loadBranding(): Branding {
  const file = resolve(__dirname, process.env.BRANDING_FILE || 'branding/default.json')
  let data: unknown
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`Cannot read branding file ${file}: ${(err as Error).message}`)
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) fail(file, 'expected a JSON object')
  const obj = data as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.includes(key)) fail(file, `unknown key "${key}" (allowed: ${KNOWN_KEYS.join(', ')})`)
  }
  const productName = checkName(file, 'productName', obj.productName)
  const contactEmail = obj.contactEmail ?? null
  if (contactEmail !== null && (typeof contactEmail !== 'string' || contactEmail.length > 254 || !EMAIL_SHAPE.test(contactEmail))) {
    fail(file, '"contactEmail" must be null or an email address')
  }
  const vendorName = obj.vendorName === undefined || obj.vendorName === null ? null : checkName(file, 'vendorName', obj.vendorName)
  return { productName, contactEmail, vendorName }
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const branding = loadBranding()

// Replaces %PRODUCT_NAME% in index.html with the HTML-escaped product name.
function brandingHtml(): Plugin {
  return {
    name: 'branding-html',
    transformIndexHtml: (html) => html.split('%PRODUCT_NAME%').join(escapeHtml(branding.productName)),
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), brandingHtml()],
  define: {
    __BRANDING__: JSON.stringify(branding),
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.API_TARGET || 'http://localhost:8080',
        changeOrigin: true,

      },
    },
  },
})
