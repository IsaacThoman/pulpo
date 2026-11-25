import { ChevronDown, Map as MapIcon, MapPin, Star } from 'lucide-react'
import { lazy, Suspense, useId, useMemo, useState } from 'react'
import braveLight from './assets/brave-logo-light.png'
import braveDark from './assets/brave-logo-dark.png'
import { safeHttpUrl } from './navigation'
import type { PlaceResponse, PlaceResult } from './places'
import type { PlaceMapPin } from './PlacesMap'

const PlacesMap = lazy(() => import('./PlacesMap').catch(() => ({
  default: () => <p className="places-note" role="status">Couldn’t load the map. Use the listings below.</p>,
})))

function googleMapsUrl(place: PlaceResult, action: 'directions' | 'listing') {
  const directions = action === 'directions'
  const url = new URL(directions ? 'https://www.google.com/maps/dir/' : 'https://www.google.com/maps/search/')
  const parameter = directions ? 'destination' : 'query'
  url.searchParams.set('api', '1')
  url.searchParams.set(parameter, [place.name, place.address].filter(Boolean).join(', '))
  if (place.googlePlaceId) url.searchParams.set(`${parameter}_place_id`, place.googlePlaceId)
  return url.href
}

const formatRating = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const initialPlaceCount = 6

function PlaceLocations({ pins }: { pins: PlaceMapPin[] }) {
  const gridId = useId()
  const [originLongitude, originLatitude] = pins[0]!.coordinates
  const longitudeScale = Math.cos(originLatitude * Math.PI / 180)
  const points = pins.map(({ coordinates: [longitude, latitude] }) => ({
    x: (((longitude - originLongitude + 540) % 360) - 180) * longitudeScale,
    y: originLatitude - latitude,
  }))
  const minimumX = Math.min(...points.map(point => point.x))
  const maximumX = Math.max(...points.map(point => point.x))
  const minimumY = Math.min(...points.map(point => point.y))
  const maximumY = Math.max(...points.map(point => point.y))
  const scale = Math.min(230 / Math.max(maximumX - minimumX, .0005), 108 / Math.max(maximumY - minimumY, .0005))
  const groups: Array<{ x: number; y: number; count: number }> = []
  for (const point of points) {
    const x = 150 + (point.x - (minimumX + maximumX) / 2) * scale
    const y = 78 + (point.y - (minimumY + maximumY) / 2) * scale
    const group = groups.find(dot => Math.hypot(dot.x - x, dot.y - y) < 18)
    if (group) group.count += 1
    else groups.push({ x, y, count: 1 })
  }
  return <figure className="place-locations">
    <svg viewBox="0 0 300 156" aria-hidden="true">
      <defs><pattern id={gridId} width="26" height="26" patternUnits="userSpaceOnUse">
        <path d="M26 0H0V26" fill="none" stroke="var(--line)" strokeWidth=".75" />
      </pattern></defs>
      <rect width="300" height="156" fill={`url(#${gridId})`} />
      <g className="place-locations-north">
        <text x="279" y="18">N</text>
        <path d="M279 23l-4 8 4-2 4 2z" />
      </g>
      {groups.map(({ x, y, count }) => <g key={`${x},${y}`} transform={`translate(${x},${y})`}>
        <circle r={count > 1 ? 10 : 5.5} />
        {count > 1 && <text className="place-locations-count" y=".35em">{count}</text>}
      </g>)}
    </svg>
    <figcaption>{pins.length} {pins.length === 1 ? 'place' : 'places'} · Relative locations</figcaption>
  </figure>
}

export function PlacesAnswer({ response, openNow, webExpanded, onWeb }: {
  response: PlaceResponse
  openNow: boolean
  webExpanded: boolean
  onWeb: () => void
}) {
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [ratingOrder, setRatingOrder] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [showMap, setShowMap] = useState(false)
  const mapId = useId()
  const configuredStyle = import.meta.env.VITE_SEARCH_PLACES_MAP_STYLE_URL?.trim() ?? ''
  const mapStyleUrl = /^https:\/\/tiles\.openfreemap\.org\/styles\/(?:positron|bright|liberty|dark|fiord)$/.test(configuredStyle) ? configuredStyle : undefined
  const places = useMemo(() => {
    const visible = onlyOpen ? response.results.filter(place => place.openNow) : response.results
    return ratingOrder ? [...visible].sort((left, right) => {
      const a = left.rating ? left.rating.value / left.rating.max : -1
      const b = right.rating ? right.rating.value / right.rating.max : -1
      return b - a || (right.rating?.count ?? 0) - (left.rating?.count ?? 0)
    }) : visible
  }, [onlyOpen, ratingOrder, response.results])
  const { visiblePlaces, pins } = useMemo(() => {
    const pins: PlaceMapPin[] = []
    const visiblePlaces = places.slice(0, showAll ? places.length : initialPlaceCount).map((place, index) => {
      const id = `${mapId}-listing-${response.results.indexOf(place)}`
      const coordinates = place.coordinates
      if (coordinates && Math.abs(coordinates[0]) <= 85.051129 && Math.abs(coordinates[1]) <= 180) {
        const rank = index + 1
        pins.push({ id, rank, name: place.name, address: place.address, coordinates: [coordinates[1], coordinates[0]] })
        return { id, rank, place }
      }
      return { id, place }
    })
    return { visiblePlaces, pins }
  }, [mapId, places, response.results, showAll])
  const canFilterHours = !openNow && response.results.some(place => place.openNow !== undefined)
  const canSortRatings = response.results.filter(place => place.rating).length > 1
  const hasLocations = pins.length > 0 || showMap
  return (
    <section className="places-answer" aria-label="Local places" data-location-overview={hasLocations || undefined}>
      <div className="places-header">
        <h2>Places{openNow && ' open now'}</h2>
        <div className="places-header-actions">
          <button className="text-button" aria-expanded={webExpanded} onClick={onWeb}>
            {webExpanded ? 'Hide web results' : 'Show web results'}
          </button>
        </div>
      </div>
      {response.correction && <p className="places-note">Showing places for {response.correction}</p>}
      {(canFilterHours || canSortRatings) && <div className="place-refinements">
        {canFilterHours && (
          <button className="secondary-button place-open-filter" aria-pressed={onlyOpen} onClick={() => setOnlyOpen(!onlyOpen)}>Open now</button>
        )}
        {canSortRatings && <span className="filter-select"><select aria-label="Order places" value={ratingOrder ? 'ratings' : 'relevance'}
          onChange={event => setRatingOrder(event.target.value === 'ratings')}>
          <option value="relevance">Relevance</option>
          <option value="ratings">Highest rated</option>
        </select><ChevronDown size={14} aria-hidden="true" /></span>}
      </div>}
      <div className="places-map-and-list">
        {hasLocations && <div className="place-map-rail">
          {mapStyleUrl && <button className="text-button place-map-toggle" aria-controls={mapId} aria-expanded={showMap}
            title={showMap ? undefined : 'Load map tiles from OpenFreeMap'} onClick={event => {
              event.currentTarget.focus()
              setShowMap(!showMap)
            }}><MapIcon size={15} aria-hidden="true" />{showMap ? 'Hide map' : 'Show map'}</button>}
          {!showMap && <PlaceLocations pins={pins} />}
          {mapStyleUrl && <div id={mapId} className="place-map-panel" hidden={!showMap}>
            {showMap && (pins.length ? (
              <Suspense fallback={<p className="places-note" role="status">Loading map…</p>}>
                <PlacesMap pins={pins} styleUrl={mapStyleUrl} />
              </Suspense>
            ) : <p className="places-note">No mapped places in these results.</p>)}
          </div>}
        </div>}
        {places.length ? (
          <ol className="place-list">
            {visiblePlaces.map(({ id, rank, place }) => {
              const website = safeHttpUrl(place.website)
              const [number, extension] = place.phone?.split(/\s*(?:ext\.?|x)\s*/i) ?? []
              const telephone = number?.replace(/[^\d+]/g, '')
              const hours = place.todayHours?.join(', ')
              return (
                <li className="place-card" key={place.name + '\n' + place.address}>
                  <h3 id={id} tabIndex={showMap ? -1 : undefined}>
                    {showMap && rank !== undefined && <span className="place-map-number" aria-hidden="true">{rank}</span>}
                    {place.name}
                  </h3>
                  {(place.category || place.priceLevel) && <p className="place-category">{[place.category, place.priceLevel].filter(Boolean).join(' · ')}</p>}
                  <p>{place.address}</p>
                  {place.summary && <p>{place.summary}</p>}
                  <div className="place-details">
                    {place.openNow !== undefined && <strong data-open={place.openNow}>{place.openNow ? 'Open now' : 'Closed'}</strong>}
                    {hours && <span>Today {hours}</span>}
                    {place.rating && (
                      <span className="place-rating" aria-label={'Rated ' + place.rating.value + ' out of ' + place.rating.max}>
                        <Star size={13} aria-hidden="true" />{formatRating.format(place.rating.value)}{place.rating.count ? ' (' + place.rating.count.toLocaleString() + ')' : ''}
                      </span>
                    )}
                  </div>
                  {!!place.weeklyHours?.length && (
                    <details className="place-hours">
                      <summary>Weekly hours</summary>
                      <dl>
                        {place.weeklyHours.map(({ day, hours }) => (
                          <div key={day}><dt>{day}</dt><dd>{hours}</dd></div>
                        ))}
                      </dl>
                    </details>
                  )}
                  <div className="place-actions">
                    <a className="secondary-button result-link" href={googleMapsUrl(place, 'directions')} target="_blank" rel="noreferrer">
                      <MapPin size={14} aria-hidden="true" /> Directions
                    </a>
                    {website && <a className="secondary-button" href={website.href} rel="noreferrer">Website</a>}
                    {place.googlePlaceId && <a className="secondary-button" href={googleMapsUrl(place, 'listing')} target="_blank" rel="noreferrer">Map listing</a>}
                    {telephone && /^\+?\d{7,15}$/.test(telephone) && <a className="secondary-button"
                      href={'tel:' + telephone + (extension && /^\d{1,8}$/.test(extension) ? ';ext=' + extension : '')}>Call</a>}
                  </div>
                </li>
              )
            })}
          </ol>
        ) : <p className="places-note">{onlyOpen || openNow ? 'No matches with listed hours showing they’re open.' : 'No places found.'}</p>}
      </div>
      {places.length > initialPlaceCount && (
        <button className="secondary-button place-show-more" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer places' : `Show all ${places.length} places`}
        </button>
      )}
      {!!response.unverifiedHours && <p className="places-note">Some places have unverified open status.</p>}
      {response.provider === 'brave' ? (
        <a className="place-source" href="https://brave.com/search/api/" rel="noreferrer">
          Powered by <img className="brave-logo-light" src={braveLight} width={61} height={19} alt="Brave" />
          <img className="brave-logo-dark" src={braveDark} width={61} height={19} alt="Brave" />
        </a>
      ) : (
        <a className="place-source" href="https://alexandria.firecrawl.dev/providers/firecrawl-maps" rel="noreferrer">Firecrawl Maps</a>
      )}
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
