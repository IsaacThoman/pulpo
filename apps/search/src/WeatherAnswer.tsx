import { useState } from 'react'
import { type WeatherAlerts, type WeatherPlace, type WeatherResponse } from './api'
import { safeHttpUrl } from './navigation'

const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' })
const placeLabel = ({ name, admin, country }: WeatherPlace) => [name, admin, country].filter(Boolean).join(', ')

export function WeatherAnswer({ response, alerts, onLocation, onWeb }: {
  response: Extract<WeatherResponse, { status: 'forecast' | 'ambiguous' }>
  alerts?: WeatherAlerts
  onLocation: (location: string) => void
  onWeb: () => void
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
  const alertSource = alerts?.status === 'available' ? safeHttpUrl(alerts.source.url) : undefined
  return (
    <section className="answer weather-answer" aria-label="Weather forecast">
      <div className="weather-heading">
        <div><h2>{placeLabel(place)}</h2><p>Forecast for {localTime.format(new Date(forecast.validAt))} local time</p></div>
        <div className="weather-units" aria-label="Temperature unit">
          <button className="text-button" aria-pressed={!fahrenheit} onClick={() => setFahrenheit(false)}>°C</button>
          <button className="text-button" aria-pressed={fahrenheit} onClick={() => setFahrenheit(true)}>°F</button>
        </div>
      </div>
      <output className="weather-reading">{degrees(forecast.temperatureC)}°{fahrenheit ? 'F' : 'C'}</output>
      {forecast.condition && <p className="weather-condition">{forecast.condition}</p>}
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
              <strong>{degrees(hour.temperatureC)}°</strong>
              {hour.precipitationChance !== undefined && <small aria-label={`Precipitation ${hour.precipitationChance}%`}>{hour.precipitationChance}% precip.</small>}
              {hour.condition && <small>{hour.condition}</small>}
            </li>)}</ol>
          </div>
        </div>
      )}
      {forecast.daily.length > 0 && <ul className="weather-days" aria-label="Daily forecast">
        {forecast.daily.slice(0, 7).map(day => <li key={day.date}>
          <strong>{dayLabel.format(new Date(day.date + 'T12:00:00Z'))}</strong>
          <span>{degrees(day.highC)}° <small>{degrees(day.lowC)}°</small></span>
          {day.condition && <small>{day.condition}</small>}
        </li>)}
      </ul>}
      <div className="weather-footer">
        <span>Sources {sources.map(source => {
          const url = safeHttpUrl(source.url)
          const license = safeHttpUrl(source.license)
          return url && <span key={url.href}> · <a href={url.href} rel="noreferrer">{source.name}</a>{license && <> (<a href={license.href} rel="noreferrer">license</a>)</>}</span>
        })}</span>
        <button className="text-button weather-web" onClick={onWeb}>Search the web</button>
      </div>
    </section>
  )
}
