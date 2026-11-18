import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'

await build({ mode: 'production' })
await rm(resolve(process.cwd(), 'dist', 'downloads', 'ridehub-android.apk'), { force: true })
