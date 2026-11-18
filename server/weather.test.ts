import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchWeatherSnapshot, normalizeWeatherResponse, WeatherProviderError } from './weather.js'

function providerResponse(now: Date) {
  const nextHour = Math.floor(now.getTime() / 3_600_000) * 3_600 + 3_600
  const hour = (offset: number, overrides: Record<string, unknown> = {}) => ({
    time_epoch: nextHour + offset * 3_600,
    time: new Date((nextHour + offset * 3_600) * 1000).toISOString(),
    temp_c: 30,
    condition: { text: 'Partly cloudy', icon: '//cdn.weatherapi.com/weather/64x64/day/116.png', code: 1003 },
    wind_kph: 10,
    gust_kph: 15,
    precip_mm: 0,
    chance_of_rain: 0,
    heatindex_c: 32,
    ...overrides,
  })

  return {
    location: { name: 'Test area', region: '', country: 'PH', lat: 14.6, lon: 121.0 },
    current: {
      temp_c: 30,
      feelslike_c: 32,
      condition: { text: 'Partly cloudy', icon: '//cdn.weatherapi.com/weather/64x64/day/116.png', code: 1003 },
      wind_kph: 10,
      gust_kph: 15,
      humidity: 70,
      last_updated: now.toISOString(),
    },
    forecast: {
      forecastday: [{
        hour: [
          hour(0),
          hour(1, { precip_mm: 9.2 }),
          hour(2, { gust_kph: 67 }),
          hour(3, { heatindex_c: 43 }),
          hour(4, { condition: { text: 'Thunderstorm', icon: '', code: 1087 } }),
        ],
      }],
    },
    alerts: {
      alert: [{
        headline: 'Flood Warning issued for the test area',
        severity: 'Severe',
        urgency: 'Expected',
        areas: 'Test area',
        event: 'Flood Warning',
        effective: now.toISOString(),
        expires: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        desc: 'Official warning text from the provider.',
        instruction: 'Avoid flooded roads.',
      }],
    },
  }
}

test('preserves official warnings and labels them as official', () => {
  const now = new Date('2026-11-15T00:00:00.000Z')
  const result = normalizeWeatherResponse(providerResponse(now), now)
  const floodWarning = result.alerts.find((alert) => alert.category === 'FLOODING_RISK')

  assert.ok(floodWarning)
  assert.equal(floodWarning.official, true)
  assert.equal(floodWarning.severity, 'SEVERE')
  assert.equal(floodWarning.instruction, 'Avoid flooded roads.')
})

test('only derives riding alerts from measured provider forecast values', () => {
  const now = new Date('2026-11-15T00:00:00.000Z')
  const result = normalizeWeatherResponse(providerResponse(now), now)
  const categories = result.alerts.filter((alert) => !alert.official).map((alert) => alert.category)

  assert.deepEqual(categories.sort(), ['EXTREME_HEAT', 'HEAVY_RAIN', 'STRONG_WIND', 'THUNDERSTORM'])
  assert.equal(result.alerts.filter((alert) => !alert.official && alert.category === 'LIGHTNING').length, 0)
})

test('ignores expired official warnings', () => {
  const now = new Date('2026-11-15T00:00:00.000Z')
  const payload = providerResponse(now)
  payload.alerts.alert[0]!.expires = new Date(now.getTime() - 1000).toISOString()

  const result = normalizeWeatherResponse(payload, now)
  assert.equal(result.alerts.some((alert) => alert.official), false)
})

test('reports provider timeouts with an actionable message', async () => {
  const timeout = new Error('The operation was aborted due to timeout')
  timeout.name = 'TimeoutError'

  await assert.rejects(
    fetchWeatherSnapshot(14.6, 121, {
      apiKey: 'test-key',
      fetchImpl: async () => {
        throw timeout
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof WeatherProviderError)
      assert.equal(error.statusCode, 502)
      assert.equal(
        error.message,
        'The weather provider did not respond within 10 seconds. Check the internet connection and retry.',
      )
      return true
    },
  )
})
