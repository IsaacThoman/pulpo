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
  const markerButtons = useRef<HTMLButtonElement[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [activeId, setActiveId] = useState<string>()
  const active = pins.find(pin => pin.id === activeId)

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
    const buttons: HTMLButtonElement[] = []
    const markers = pins.map(pin => {
      const element = document.createElement('button')
      element.type = 'button'
      element.className = 'places-map-pin'
      element.dataset.listing = pin.id
      element.textContent = String(pin.rank)
      element.setAttribute('aria-label', `${pin.rank}. ${pin.name}, ${pin.address}`)
      element.addEventListener('click', () => setActiveId(pin.id))
      buttons.push(element)
      const [longitude, latitude] = pin.coordinates
      const nearestLongitude = center[0] + ((longitude - center[0] + 540) % 360) - 180
      bounds.extend([nearestLongitude, latitude])
      return new Marker({ element, anchor: 'center' }).setLngLat(pin.coordinates).addTo(instance)
    })
    markerButtons.current = buttons
    instance.fitBounds(bounds, { maxZoom: 16, padding: 42, duration: 0 })
    return () => markers.forEach(marker => marker.remove())
  }, [pins])

  useEffect(() => {
    for (const button of markerButtons.current) button.setAttribute('aria-pressed', String(button.dataset.listing === active?.id))
  }, [active, pins])

  if (status === 'unavailable') return <p className="places-note" role="status">Couldn’t load the map. Use the listings below.</p>
  return (
    <section className="places-map" aria-label="Map of listed places" onKeyDown={event => {
      if (event.key.startsWith('Arrow')) event.stopPropagation()
    }}>
      <div className="places-map-frame">
        <div className="places-map-canvas" ref={container} data-loading={status === 'loading' || undefined} />
        {status === 'loading' && <p className="places-map-loading" role="status">Loading map…</p>}
      </div>
      <div className="sr-only" role="status">{active && `${active.name}, ${active.address}`}</div>
      {status === 'ready' && active && <div className="places-map-selection">
        <div><strong>{active.name}</strong><p>{active.address}</p></div>
        <button className="text-button" onClick={() => document.getElementById(active.id)?.focus()}>Go to listing</button>
      </div>}
      <div className="places-map-attribution">
        <a href="https://openfreemap.org/" rel="noreferrer" target="_blank">OpenFreeMap</a>
        <a href="https://openmaptiles.org/" rel="noreferrer" target="_blank">© OpenMapTiles</a>
        <span>Data from <a href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">OpenStreetMap</a></span>
      </div>
    </section>
  )
}
