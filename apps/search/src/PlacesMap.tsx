import { LngLatBounds, Map as LibreMap, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef, useState } from 'react'
import './places-map.css'

export interface PlaceMapPin {
  id: string
  rank: number
  name: string
  address: string
  coordinates: [longitude: number, latitude: number]
}

interface MapMarker {
  marker: Marker
  button: HTMLButtonElement
  ids: string[]
}

const tileOrigin = 'https://tiles.openfreemap.org'
setWorkerUrl(workerUrl)

function mapStyle(styleUrl: string) {
  const theme = document.documentElement.dataset.theme
  const dark = theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)
  return dark ? `${tileOrigin}/styles/dark` : styleUrl
}

export default function PlacesMap({ pins, styleUrl }: { pins: PlaceMapPin[]; styleUrl: string }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<LibreMap | null>(null)
  const initialCenter = useRef(pins[0]!.coordinates)
  const markers = useRef<MapMarker[]>([])
  const selectedIds = useRef<string[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [activeIds, setActiveIds] = useState<string[]>([])
  const active = pins.filter(pin => activeIds.includes(pin.id))

  useEffect(() => {
    if (!container.current) return
    let instance: LibreMap
    let style = mapStyle(styleUrl)
    try {
      instance = new LibreMap({
        container: container.current, style, center: initialCenter.current, zoom: 14,
        attributionControl: false, dragRotate: false, touchPitch: false, cooperativeGestures: true,
        transformRequest(url) {
          if (new URL(url).origin !== tileOrigin) throw new Error('Unexpected map resource origin')
          return { url, credentials: 'same-origin', referrerPolicy: 'no-referrer' }
        },
      })
    } catch {
      setStatus('unavailable')
      return
    }
    map.current = instance
    instance.keyboard.disableRotation()
    instance.touchZoomRotate.disableRotation()
    instance.addControl(new NavigationControl({ showCompass: false }))
    instance.getCanvas().setAttribute('aria-label', 'Interactive map of listed places')
    const observer = new MutationObserver(() => {
      const next = mapStyle(styleUrl)
      if (next === style) return
      style = next
      instance.setStyle(style)
    })
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] })
    const deadline = window.setTimeout(() => {
      destroy()
      setStatus('unavailable')
    }, 12_000)
    instance.once('load', () => {
      window.clearTimeout(deadline)
      setStatus('ready')
    })
    function destroy() {
      window.clearTimeout(deadline)
      observer.disconnect()
      if (map.current !== instance) return
      map.current = null
      instance.remove()
    }
    return destroy
  }, [styleUrl])

  useEffect(() => {
    const instance = map.current
    if (!instance) return
    const center = pins[0]!.coordinates
    const bounds = new LngLatBounds(center, center)
    const wrappedPins = pins.map(pin => {
      const [longitude, latitude] = pin.coordinates
      const coordinates: PlaceMapPin['coordinates'] = [center[0] + ((longitude - center[0] + 540) % 360) - 180, latitude]
      bounds.extend(coordinates)
      return { pin, coordinates }
    })
    const updateMarkers = () => {
      const groups: Array<{ first: PlaceMapPin; coordinates: PlaceMapPin['coordinates']; x: number; y: number; ids: string[] }> = []
      for (const { pin, coordinates } of wrappedPins) {
        const { x, y } = instance.project(coordinates)
        const group = groups.find(other => Math.hypot(other.x - x, other.y - y) < 33)
        if (group) group.ids.push(pin.id)
        else groups.push({ first: pin, coordinates, x, y, ids: [pin.id] })
      }
      if (groups.length === markers.current.length && groups.every((group, index) =>
        group.ids.join() === markers.current[index]?.ids.join())) return
      markers.current.forEach(({ marker }) => marker.remove())
      markers.current = groups.map(({ first, coordinates, ids }) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'places-map-pin'
        if (ids.length > 1) button.dataset.cluster = 'true'
        button.textContent = ids.length > 1 ? `+${ids.length}` : String(first.rank)
        button.setAttribute('aria-label', ids.length > 1 ? `${ids.length} places close together` : `${first.rank}. ${first.name}, ${first.address}`)
        button.setAttribute('aria-pressed', String(ids.some(id => selectedIds.current.includes(id))))
        button.addEventListener('click', () => setActiveIds(ids))
        const marker = new Marker({ element: button, anchor: 'center' }).setLngLat(coordinates).addTo(instance)
        return { marker, button, ids }
      })
    }
    instance.fitBounds(bounds, { maxZoom: 16, padding: 42, duration: 0 })
    updateMarkers()
    instance.on('zoomend', updateMarkers)
    return () => {
      instance.off('zoomend', updateMarkers)
      markers.current.forEach(({ marker }) => marker.remove())
      markers.current = []
    }
  }, [pins])

  useEffect(() => {
    selectedIds.current = activeIds
    for (const { button, ids } of markers.current) button.setAttribute('aria-pressed', String(ids.some(id => activeIds.includes(id))))
  }, [activeIds, pins])

  if (status === 'unavailable') return <p className="places-note" role="status">Couldn’t load the map. Use the listings below.</p>
  return (
    <section className="places-map" aria-label="Map of listed places" onKeyDown={event => {
      if (event.key.startsWith('Arrow')) event.stopPropagation()
    }}>
      <div className="places-map-frame">
        <div className="places-map-canvas" ref={container} data-loading={status === 'loading' || undefined} />
        {status === 'loading' && <p className="places-map-loading" role="status">Loading map…</p>}
      </div>
      <div className="sr-only" role="status">{active.map(pin => `${pin.name}, ${pin.address}`).join('. ')}</div>
      {status === 'ready' && active.length > 0 && <ul className="places-map-selections">
        {active.map(pin => <li className="places-map-selection" key={pin.id}>
          <div><strong>{pin.name}</strong><p>{pin.address}</p></div>
          <button className="text-button" aria-label={`Go to listing for ${pin.name}`} onClick={() => document.getElementById(pin.id)?.focus()}>Go to listing</button>
        </li>)}
      </ul>}
      <div className="places-map-attribution">
        <a href="https://openfreemap.org/" rel="noreferrer" target="_blank">OpenFreeMap</a>
        <a href="https://openmaptiles.org/" rel="noreferrer" target="_blank">© OpenMapTiles</a>
        <span>Data from <a href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">OpenStreetMap</a></span>
      </div>
    </section>
  )
}
