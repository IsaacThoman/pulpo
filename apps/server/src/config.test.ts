import { describe, expect, it } from 'vitest'
import { getStorageCorsOrigins, getWorkspaceInstanceId, isAllowedOrigin, parseConfig } from './config.js'

describe('server configuration', () => {
  it('keeps billing disabled unless explicitly and completely configured', () => {
    expect(parseConfig({}).PULPO_BILLING_ENABLED).toBe(false)
    expect(() => parseConfig({ PULPO_BILLING_ENABLED: 'true' })).toThrow(/POLAR_ENVIRONMENT/)
    expect(parseConfig({
      PULPO_BILLING_ENABLED: 'true',
      POLAR_ENVIRONMENT: 'sandbox',
      POLAR_ACCESS_TOKEN: 'polar-token',
      POLAR_WEBHOOK_SECRET: 'polar-secret',
      POLAR_CREDIT_PRODUCT_ID: '00000000-0000-4000-8000-000000000001',
      POLAR_EIGHT_PRODUCT_ID: '00000000-0000-4000-8000-000000000002',
      POLAR_FAT_PRODUCT_ID: '00000000-0000-4000-8000-000000000003',
    }).PULPO_BILLING_ENABLED).toBe(true)
  })

  it('treats empty optional workspace controller values as unset', () => {
    const config = parseConfig({
      WORKSPACE_CONTROLLER_URL: '',
      WORKSPACE_CONTROLLER_TOKEN: '',
      WORKSPACE_CONTROLLER_CA_CERT_BASE64: '',
    })

    expect(config.WORKSPACE_CONTROLLER_URL).toBeUndefined()
    expect(config.WORKSPACE_CONTROLLER_TOKEN).toBeUndefined()
    expect(config.WORKSPACE_CONTROLLER_CA_CERT_BASE64).toBeUndefined()
  })

  it('still validates configured workspace controller values', () => {
    expect(() => parseConfig({
      WORKSPACE_CONTROLLER_URL: 'not-a-url',
      WORKSPACE_CONTROLLER_TOKEN: 'short',
    })).toThrow()
  })

  it('parses optional ci-preview bootstrap values and validates their shape', () => {
    const digest = `ghcr.io/isaacthoman/pulpo-agent-workspace@sha256:${'a'.repeat(64)}`
    const config = parseConfig({
      PULPO_BOOTSTRAP_PRESET: 'ci-preview',
      PULPO_PREVIEW_ADMIN_EMAIL: 'preview@example.com',
      PULPO_PREVIEW_ADMIN_PASSWORD: 'preview-password',
      PULPO_PREVIEW_PROVIDER_API_KEY: 'sk-preview',
      PULPO_PREVIEW_WORKSPACE_IMAGE_DIGEST: digest,
    })

    expect(config).toMatchObject({
      PULPO_BOOTSTRAP_PRESET: 'ci-preview',
      PULPO_PREVIEW_ADMIN_EMAIL: 'preview@example.com',
      PULPO_PREVIEW_WORKSPACE_IMAGE_DIGEST: digest,
    })
    expect(() => parseConfig({ PULPO_BOOTSTRAP_PRESET: 'production' })).toThrow()
    expect(() => parseConfig({ PULPO_PREVIEW_ADMIN_EMAIL: 'not-an-email' })).toThrow()
    expect(() => parseConfig({ PULPO_PREVIEW_WORKSPACE_IMAGE_DIGEST: 'ghcr.io/example/workspace:latest' })).toThrow()
  })

  it('resolves Coolify preview service names from pull request metadata', () => {
    expect(parseConfig({
      COOLIFY_BRANCH: '"pull/48/head"',
      POSTGRES_HOST: 'postgres',
      REDIS_URL: 'redis://redis:6379',
      S3_ENDPOINT: 'http://seaweed-s3:8333',
    })).toMatchObject({
      POSTGRES_HOST: 'postgres-pr-48',
      REDIS_URL: 'redis://redis-pr-48:6379',
      S3_ENDPOINT: 'http://seaweed-s3-pr-48:8333',
    })

    expect(parseConfig({ COOLIFY_BRANCH: 'main' })).toMatchObject({
      POSTGRES_HOST: 'localhost',
      REDIS_URL: 'redis://localhost:6379',
      S3_ENDPOINT: 'http://localhost:8333',
    })
  })

  it('resolves an explicit workspace instance id before deployment metadata', () => {
    const config = parseConfig({ PUBLIC_URL: 'https://pulpo.example.com', PULPO_INSTANCE_ID: 'production' })
    expect(getWorkspaceInstanceId(config, { SERVICE_FQDN_WEB: '42.preview.example.com' })).toBe('production')
  })

  it('uses a Coolify service FQDN as the preview workspace instance id', () => {
    const config = parseConfig({ PUBLIC_URL: 'https://pulpo.example.com' })
    expect(getWorkspaceInstanceId(config, { SERVICE_FQDN_WEB: 'https://42.preview.example.com' })).toBe('42.preview.example.com')
    expect(getWorkspaceInstanceId(config, {})).toBe('pulpo.example.com')
  })

  it('keeps arbitrary localhost ports disabled by default', () => {
    const config = parseConfig({
      NODE_ENV: 'development',
      PUBLIC_URL: 'https://pulpo.example.com',
    })

    expect(config.ALLOW_ANY_LOCALHOST_PORT).toBe(false)
    expect(isAllowedOrigin('http://localhost:5173', config)).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:5173', config)).toBe(true)
    expect(isAllowedOrigin('http://localhost:4173', config)).toBe(false)
  })

  it('allows any loopback port only when explicitly enabled in development', () => {
    const config = parseConfig({
      NODE_ENV: 'development',
      PUBLIC_URL: 'https://pulpo.example.com',
      ALLOW_ANY_LOCALHOST_PORT: 'true',
    })

    expect(isAllowedOrigin('http://localhost:4173', config)).toBe(true)
    expect(isAllowedOrigin('https://localhost:9443', config)).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:8081', config)).toBe(true)
    expect(isAllowedOrigin('http://[::1]:6006', config)).toBe(true)
    expect(isAllowedOrigin('http://localhost.evil.example:4173', config)).toBe(false)
    expect(isAllowedOrigin('ftp://localhost:4173', config)).toBe(false)
    expect(isAllowedOrigin('not an origin', config)).toBe(false)
  })

  it('ignores the localhost-port flag outside development', () => {
    const config = parseConfig({
      NODE_ENV: 'production',
      PUBLIC_URL: 'https://pulpo.example.com',
      ALLOW_ANY_LOCALHOST_PORT: 'true',
    })

    expect(isAllowedOrigin('https://pulpo.example.com', config)).toBe(true)
    expect(isAllowedOrigin('http://localhost:4173', config)).toBe(false)
    expect(getStorageCorsOrigins(config)).toEqual(['https://pulpo.example.com'])
  })

  it('adds loopback wildcard origins to development object-storage CORS', () => {
    const config = parseConfig({
      NODE_ENV: 'development',
      PUBLIC_URL: 'http://localhost:8080',
      ALLOW_ANY_LOCALHOST_PORT: 'true',
    })

    expect(getStorageCorsOrigins(config)).toEqual([
      'http://localhost:8080',
      'http://localhost:*',
      'https://localhost:*',
      'http://127.0.0.1:*',
      'https://127.0.0.1:*',
      'http://[::1]:*',
      'https://[::1]:*',
    ])
  })
})
