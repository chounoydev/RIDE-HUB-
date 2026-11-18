import type { Request, Response } from 'express'
import { createConfiguredApp } from '../server/configure.js'

const app = createConfiguredApp()

export default function handler(request: Request, response: Response) {
  const url = new URL(request.url, 'https://vercel.local')
  const apiPath = url.searchParams.get('__api_path')
  if (apiPath !== null) {
    url.searchParams.delete('__api_path')
    const route = apiPath.replace(/^\/+/, '')
    const query = url.searchParams.toString()
    request.url = `/api/${route}${query ? `?${query}` : ''}`
  }

  app(request, response)
}
