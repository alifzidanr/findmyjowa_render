import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix for default markers in Leaflet
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

const MapComponent = ({ devices = [], height = '400px', showAllDevices = false }) => {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markersRef = useRef({})

  useEffect(() => {
    if (!mapRef.current) return

    // Initialize map
    if (!mapInstanceRef.current) {
      mapInstanceRef.current = L.map(mapRef.current).setView([-6.2088, 106.8456], 13) // Jakarta center

      // Add OpenStreetMap tiles
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(mapInstanceRef.current)
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!mapInstanceRef.current) return

    // Clear existing markers
    Object.values(markersRef.current).forEach(marker => {
      mapInstanceRef.current.removeLayer(marker)
    })
    markersRef.current = {}

    if (!devices.length) return

    // Add markers for each device
    const bounds = L.latLngBounds()
    let hasValidCoordinates = false

    devices.forEach(device => {
      if (!device.latitude || !device.longitude) return

      hasValidCoordinates = true
      const lat = parseFloat(device.latitude)
      const lng = parseFloat(device.longitude)

      // Determine marker color based on device status and recency
      let markerColor = 'gray'
      const now = new Date()
      const lastUpdate = new Date(device.timestamp || device.last_seen)
      const timeDiff = (now - lastUpdate) / 1000 / 60 // minutes

      if (device.is_online && timeDiff < 5) {
        markerColor = '#22c55e' // Green - online and recent
      } else if (device.is_online && timeDiff < 30) {
        markerColor = '#eab308' // Yellow - online but not very recent
      } else {
        markerColor = '#ef4444' // Red - offline or stale
      }

      // Create custom marker with device name label
      const customIcon = L.divIcon({
        html: `
          <div style="display: flex; flex-direction: column; align-items: center;">
            <div style="
              background-color: ${markerColor};
              width: 16px;
              height: 16px;
              border-radius: 50%;
              border: 3px solid white;
              box-shadow: 0 2px 6px rgba(0,0,0,0.3);
              position: relative;
            ">
              ${device.speed && device.speed > 10 ? `
                <div style="
                  position: absolute;
                  top: -2px;
                  right: -2px;
                  width: 8px;
                  height: 8px;
                  background: #3b82f6;
                  border-radius: 50%;
                  border: 1px solid white;
                "></div>
              ` : ''}
            </div>
            <div style="
              background: rgba(0,0,0,0.8);
              color: white;
              padding: 2px 6px;
              border-radius: 4px;
              font-size: 11px;
              font-weight: 500;
              white-space: nowrap;
              margin-top: 4px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            ">
              ${device.device_name || 'Unknown Device'}
            </div>
          </div>
        `,
        className: 'custom-device-marker',
        iconSize: [100, 50],
        iconAnchor: [50, 25]
      })

      // Create marker
      const marker = L.marker([lat, lng], { icon: customIcon })
        .addTo(mapInstanceRef.current)

      // Create detailed popup content
      const timeSinceUpdate = timeDiff < 1 ? 'Just now' : 
                             timeDiff < 60 ? `${Math.round(timeDiff)}m ago` :
                             timeDiff < 1440 ? `${Math.round(timeDiff/60)}h ago` :
                             `${Math.round(timeDiff/1440)}d ago`

      const popupContent = `
        <div style="min-width: 220px;">
          <div style="display: flex; align-items: center; margin-bottom: 8px;">
            <div style="
              width: 12px;
              height: 12px;
              border-radius: 50%;
              background-color: ${markerColor};
              margin-right: 8px;
            "></div>
            <h3 style="margin: 0; font-weight: bold; font-size: 16px;">
              ${device.device_name || 'Unknown Device'}
            </h3>
          </div>
          
          ${device.username ? `
            <p style="margin: 4px 0; color: #666; font-size: 14px;">
              <strong>Owner:</strong> ${device.username}
              ${device.full_name ? ` (${device.full_name})` : ''}
            </p>
          ` : ''}
          
          <p style="margin: 4px 0; color: #666; font-size: 14px;">
            <strong>Type:</strong> ${(device.device_type || 'mobile').charAt(0).toUpperCase() + (device.device_type || 'mobile').slice(1)}
          </p>
          
          <p style="margin: 4px 0; font-size: 14px;">
            <strong>Status:</strong> 
            <span style="color: ${markerColor}; font-weight: 500;">
              ${device.is_online ? 'Online' : 'Offline'}
            </span>
          </p>
          
          <p style="margin: 4px 0; color: #666; font-size: 14px;">
            <strong>Last Update:</strong> ${timeSinceUpdate}
          </p>
          
          ${device.speed !== null && device.speed !== undefined && device.speed > 0 ? `
            <p style="margin: 4px 0; color: #666; font-size: 14px;">
              <strong>Speed:</strong> ${Math.round(device.speed * 10) / 10} km/h
              ${device.speed > 50 ? ' ⚡' : device.speed > 10 ? ' 🚗' : ' 🚶'}
            </p>
          ` : ''}
          
          ${device.accuracy ? `
            <p style="margin: 4px 0; color: #666; font-size: 14px;">
              <strong>Accuracy:</strong> ±${Math.round(device.accuracy)}m
            </p>
          ` : ''}
          
          ${device.battery_level ? `
            <p style="margin: 4px 0; color: #666; font-size: 14px;">
              <strong>Battery:</strong> ${device.battery_level}%
              ${device.battery_level < 20 ? ' 🔋' : device.battery_level < 50 ? ' 🔋' : ' 🔋'}
            </p>
          ` : ''}
          
          <hr style="margin: 8px 0; border: none; border-top: 1px solid #eee;">
          <p style="margin: 0; color: #888; font-size: 12px;">
            📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}
          </p>
        </div>
      `

      marker.bindPopup(popupContent)
      
      // Store marker reference
      markersRef.current[device.device_id || device.id] = marker

      // Add to bounds
      bounds.extend([lat, lng])
    })

    // Fit map to show all markers
    if (hasValidCoordinates && devices.length > 0) {
      if (devices.length === 1) {
        // Single device - center on it with good zoom level
        const device = devices[0]
        mapInstanceRef.current.setView([parseFloat(device.latitude), parseFloat(device.longitude)], 16)
      } else {
        // Multiple devices - fit bounds with padding
        mapInstanceRef.current.fitBounds(bounds, { 
          padding: [20, 20],
          maxZoom: 16
        })
      }
    }

  }, [devices])

  return (
    <div className="rounded-lg overflow-hidden shadow-md border relative">
      <div 
        ref={mapRef} 
        style={{ height, width: '100%' }}
        className="z-0"
      />
      
      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-white bg-opacity-95 p-3 rounded-lg shadow-md z-10">
        <h4 className="text-sm font-medium text-gray-900 mb-2">Device Status</h4>
        <div className="space-y-1 text-xs">
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full bg-green-500 mr-2"></div>
            <span>Online (recent)</span>
          </div>
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full bg-yellow-500 mr-2"></div>
            <span>Online (stale)</span>
          </div>
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full bg-red-500 mr-2"></div>
            <span>Offline</span>
          </div>
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full bg-blue-500 mr-2"></div>
            <span className="text-xs">Moving fast</span>
          </div>
        </div>
      </div>

      {/* Device count indicator */}
      {devices.length > 0 && (
        <div className="absolute top-4 right-4 bg-white bg-opacity-95 px-3 py-2 rounded-lg shadow-md z-10">
          <div className="text-sm font-medium text-gray-900">
            {devices.length} device{devices.length !== 1 ? 's' : ''} visible
          </div>
        </div>
      )}
    </div>
  )
}

export default MapComponent