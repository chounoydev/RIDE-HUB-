import dotenv from 'dotenv'
import { defineConfig, env } from 'prisma/config'

dotenv.config({ path: '.env.local' })
dotenv.config()

const isGenerateCommand = process.argv.includes('generate')

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  ...(isGenerateCommand ? {} : { datasource: { url: env('DATABASE_URL_UNPOOLED') } }),
})