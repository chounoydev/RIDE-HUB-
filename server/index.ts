import { config } from 'dotenv'
import { createConfiguredApp } from './configure.js'

config({ path: ['.env.local', '.env'] })

const port = Number(process.env.PORT ?? 3000)
const app = createConfiguredApp()

app.listen(port, '0.0.0.0', () => {
  console.info(`RideHub API listening on port ${port}.`)
  console.info(
    process.env.WEATHER_API_KEY
      ? 'Weather forecast and official-warning provider configured.'
      : 'Weather API is disabled until WEATHER_API_KEY is configured.',
  )
  console.info('Background weather monitoring and push delivery are not active.')
})
