import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { type WeatherAlerts, type WeatherPlace, type WeatherResponse } from './api'
import { safeHttpUrl } from './navigation'

const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' })
const fullDayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
const placeLabel = ({ name, admin, country }: WeatherPlace) => [name, admin, country].filter(Boolean).join(', ')

function WeatherSymbol({ condition, size = 19 }: { condition: string | undefined; size?: number }) {
  const description = condition?.toLowerCase() ?? ''
  const Icon = description.includes('thunder') ? CloudLightning
    : /sleet|snow|ice/.test(description) ? CloudSnow
    : /rain|drizzle|showers/.test(description) ? CloudRain
    : /fog|mist/.test(description) ? CloudFog
    : /fair|partly/.test(description) ? CloudSun
    : /clear|sunny/.test(description) ? Sun : Cloud
  return <Icon className="weather-symbol" size={size} strokeWidth={1.55} aria-hidden="true" />
}

export function WeatherAnswer({ response, alerts, onLocation, onWeb, webExpanded }: {
  response: Extract<WeatherResponse, { status: 'forecast' | 'ambiguous' }>
  alerts?: WeatherAlerts
  onLocation: (location: string) => void
  onWeb: () => void
  webExpanded?: boolean
}) {
  const [fahrenheit, setFahrenheit] = useState(() => /^en-US$/i.test(navigator.language))
  const degrees = (celsius: number) => Math.round(fahrenheit ? celsius * 9 / 5 + 32 : celsius)
  if (response.status === 'ambiguous') {
    return (
      <section className="answer weather-answer" aria-label="Choose a weather location">
        <h2>Choose a location</h2>
        <ul className="weather-choices">
          {response.places.map(place => <li key={place.query}>
            <button className="secondary-button" onClick={() => onLocation(place.query)}>{placeLabel(place)}</button>
          </li>)}
        </ul>
        <button className="text-button weather-web" onClick={onWeb}>Search the web</button>
      </section>
    )
  }
  const { place, forecast, sources } = response
  const localTime = new Intl.DateTimeFormat(undefined, { timeZone: place.timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit' })
  const localHour = new Intl.DateTimeFormat(undefined, { timeZone: place.timeZone, hour: 'numeric', minute: '2-digit' })
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: place.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const alertSource = alerts?.status === 'available' ? safeHttpUrl(alerts.source.url) : undefined
  const dailyLow = Math.min(...forecast.daily.map(day => day.lowC))
  const dailyHigh = Math.max(...forecast.daily.map(day => day.highC))
  const dailySpan = Math.max(dailyHigh - dailyLow, 1)
  return (
    <section className="answer weather-answer" aria-label="Weather forecast">
      <div className="weather-heading">
        <div><h2>{placeLabel(place)}</h2><p>Forecast for {localTime.format(new Date(forecast.validAt))} local time</p></div>
        <div className="weather-units" aria-label="Temperature unit">
          <button className="text-button" aria-pressed={!fahrenheit} onClick={() => setFahrenheit(false)}>°C</button>
          <button className="text-button" aria-pressed={fahrenheit} onClick={() => setFahrenheit(true)}>°F</button>
        </div>
      </div>
      <div className="weather-current">
        {forecast.condition && <WeatherSymbol condition={forecast.condition} size={49} />}
        <div>
          <output className="weather-reading">{degrees(forecast.temperatureC)}°{fahrenheit ? 'F' : 'C'}</output>
          {forecast.condition && <p className="weather-condition">{forecast.condition}</p>}
        </div>
      </div>
      <ul className="weather-details">
        {forecast.windKph !== undefined && <li>Wind {Math.round(fahrenheit ? forecast.windKph / 1.609344 : forecast.windKph)} {fahrenheit ? 'mph' : 'km/h'}</li>}
        {forecast.precipitationChance !== undefined && <li>Precipitation {forecast.precipitationChance}%</li>}
        {forecast.precipitationChance === undefined && forecast.precipitationMm !== undefined && <li>Precipitation {forecast.precipitationMm.toFixed(1)} mm</li>}
      </ul>
      {alerts?.status === 'available' && alerts.alerts.length > 0 && <ul className="weather-alerts" aria-label="Weather alerts">
        {alerts.alerts.map(alert => {
          const url = safeHttpUrl(alert.url) ?? alertSource
          return <li key={[alert.event, alert.effectiveAt, alert.expiresAt].join(':')}>
            {url ? <a href={url.href} rel="noreferrer">{alert.event}</a> : <strong>{alert.event}</strong>}
            <small>Until {localTime.format(new Date(alert.expiresAt))} local time</small>
          </li>
        })}
      </ul>}
      {!!forecast.hourly?.length && (
        <div className="weather-hourly">
          <h3>Hourly</h3>
          <div className="weather-hourly-scroll" role="region" aria-label="Hourly forecast" tabIndex={0}>
            <ol>{forecast.hourly.map(hour => <li key={hour.validAt}>
              <time dateTime={hour.validAt}>{localHour.format(new Date(hour.validAt))}</time>
              <span className="weather-hour-reading">
                {hour.condition && <WeatherSymbol condition={hour.condition} />}
                <strong>{degrees(hour.temperatureC)}°</strong>
              </span>
              {hour.precipitationChance !== undefined && <small aria-label={`Precipitation ${hour.precipitationChance}%`}>{hour.precipitationChance}% precip.</small>}
              {hour.condition && <small>{hour.condition}</small>}
            </li>)}</ol>
          </div>
        </div>
      )}
      {forecast.daily.length > 0 && <div className="weather-outlook">
        <h3>{forecast.daily.length}-day outlook</h3>
        <ul className="weather-days" role="list" aria-label="Daily forecast">
          {forecast.daily.map(day => {
            const date = new Date(day.date + 'T12:00:00Z')
            const remaining = day.date === today
            return <li key={day.date}>
              <time dateTime={day.date} title={fullDayLabel.format(date)} aria-label={remaining ? 'Rest of today' : undefined}>{remaining ? 'Today' : dayLabel.format(date)}</time>
              {day.condition && <WeatherSymbol condition={day.condition} />}
              <span className="weather-range">
                <strong><span className="sr-only">High </span>{degrees(day.highC)}°</strong>
                <span><span className="sr-only">Low </span>{degrees(day.lowC)}°</span>
              </span>
              <span className="weather-range-track" aria-hidden="true" style={{
                '--range-start': (day.lowC - dailyLow) / dailySpan * 100 + '%',
                '--range-end': (dailyHigh - day.highC) / dailySpan * 100 + '%',
              } as CSSProperties} />
              {day.condition && <small className="weather-day-condition">{day.condition}</small>}
            </li>
          })}
        </ul>
      </div>}
      <div className="weather-footer">
        <span>Sources {sources.map(source => {
          const url = safeHttpUrl(source.url)
          const license = safeHttpUrl(source.license)
          return url && <span key={url.href}> · <a href={url.href} rel="noreferrer">{source.name}</a>
            {license && <> (<a href={license.href} rel="noreferrer">license</a>)</>}
            {source.note && <> {source.note}</>}</span>
        })}</span>
        <button className="text-button weather-web" aria-expanded={webExpanded} onClick={onWeb}>
          {webExpanded ? 'Hide web results' : 'Show web results'}
        </button>
      </div>
    </section>
  )
}
