import { MapPin, Star } from 'lucide-react'
import { useState } from 'react'
import braveLight from './assets/brave-logo-light.png'
import braveDark from './assets/brave-logo-dark.png'
import { safeHttpUrl } from './navigation'
import type { PlaceResponse, PlaceResult } from './places'

function directionsFor(place: PlaceResult) {
  const url = new URL('https://www.google.com/maps/dir/')
  url.search = new URLSearchParams({ api: '1', destination: [place.name, place.address].filter(Boolean).join(', ') }).toString()
  return url.href
}

const formatRating = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

export function PlacesAnswer({ response, openNow, onWeb }: {
  response: PlaceResponse
  openNow: boolean
  onWeb: () => void
}) {
  const [onlyOpen, setOnlyOpen] = useState(false)
  const places = onlyOpen ? response.results.filter(place => place.openNow) : response.results
  const canFilterHours = !openNow && response.results.some(place => place.openNow !== undefined)
  return (
    <section className="places-answer" aria-label="Local places">
      <div className="places-header">
        <h2>Places{openNow && ' open now'}</h2>
        <button className="text-button" onClick={onWeb}>Search the web</button>
      </div>
      {response.correction && <p className="places-note">Showing places for {response.correction}</p>}
      {canFilterHours && (
        <button className="secondary-button place-open-filter" aria-pressed={onlyOpen} onClick={() => setOnlyOpen(!onlyOpen)}>Open now</button>
      )}
      {places.length ? (
        <ol className="place-list">
          {places.map(place => {
            const website = safeHttpUrl(place.website)
            const [number, extension] = place.phone?.split(/\s*(?:ext\.?|x)\s*/i) ?? []
            const telephone = number?.replace(/[^\d+]/g, '')
            const hours = place.todayHours?.join(', ')
            return (
              <li className="place-card" key={place.name + '\n' + place.address}>
                <h3>{place.name}</h3>
                {place.category && <p className="place-category">{place.category}</p>}
                <p>{place.address}</p>
                <div className="place-details">
                  {place.openNow !== undefined && <strong data-open={place.openNow}>{place.openNow ? 'Open now' : 'Closed'}</strong>}
                  {hours && <span>Today {hours}</span>}
                  {place.rating && (
                    <span className="place-rating" aria-label={'Rated ' + place.rating.value + ' out of ' + place.rating.max}>
                      <Star size={13} aria-hidden="true" />{formatRating.format(place.rating.value)}{place.rating.count ? ' (' + place.rating.count.toLocaleString() + ')' : ''}
                    </span>
                  )}
                </div>
                <div className="place-actions">
                  <a className="secondary-button result-link" href={directionsFor(place)} target="_blank" rel="noreferrer">
                    <MapPin size={14} aria-hidden="true" /> Directions
                  </a>
                  {website && <a className="secondary-button" href={website.href} rel="noreferrer">Website</a>}
                  {telephone && /^\+?\d{7,15}$/.test(telephone) && <a className="secondary-button"
                    href={'tel:' + telephone + (extension && /^\d{1,8}$/.test(extension) ? ';ext=' + extension : '')}>Call</a>}
                </div>
              </li>
            )
          })}
        </ol>
      ) : <p className="places-note">{onlyOpen || openNow ? 'No matches with listed hours showing they’re open.' : 'No places found.'}</p>}
      {!!response.unverifiedHours && <p className="places-note">Some places are missing usable opening hours.</p>}
      <a className="place-source" href="https://brave.com/search/api/" rel="noreferrer">
        Powered by <img className="brave-logo-light" src={braveLight} width={61} height={19} alt="Brave" />
        <img className="brave-logo-dark" src={braveDark} width={61} height={19} alt="Brave" />
      </a>
    </section>
  )
}

export function PlacesLocation({ onLocation, onWeb }: { onLocation: (area: string) => void; onWeb: () => void }) {
  const [area, setArea] = useState('')
  return (
    <section className="answer places-answer" aria-label="Choose a search area">
      <h2>Search near a location</h2>
      <form className="place-location-form" onSubmit={event => {
        event.preventDefault()
        if (area.trim()) onLocation(area.trim())
      }}>
        <input aria-label="City or neighborhood" placeholder="City or neighborhood" value={area}
          maxLength={150} onChange={event => setArea(event.target.value)} />
        <button className="secondary-button" disabled={!area.trim()} type="submit">Find places</button>
      </form>
      <button className="text-button" onClick={onWeb}>Search the web</button>
    </section>
  )
}
