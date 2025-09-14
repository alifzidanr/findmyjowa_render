// src/components/MapComponent.js
import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix for default markers in Leaflet
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

const MapComponent = forwardRef(({ 
  devices = [], 
  height = '400px', 
  showAllDevices = false, 
  selectedDevice = null,
  onDeviceSelect = null 
}, ref) => {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markersRef = useRef({})

  // Expose map control methods to parent
  useImperativeHandle(ref, () => ({
    zoomToDevice: (deviceId) => {
      console.log('zoomToDevice called with:', deviceId)
      const device = devices.find(d => d.device_id === deviceId)
      if (device && mapInstanceRef.current) {
        const lat = parseFloat(device.latitude)
        const lng = parseFloat(device.longitude)
        mapInstanceRef.current.setView([lat, lng], 16)
        
        // Open popup for the device
        const marker = markersRef.current[deviceId]
        if (marker) {
          marker.openPopup()
        }
      }
    },
    showBothDevices: (deviceIds) => {
      console.log('showBothDevices called with:', deviceIds)
      if (!mapInstanceRef.current || !deviceIds.length) {
        console.log('Early return: no map or device IDs')
        return
      }
      
      const validDevices = devices.filter(d => 
        deviceIds.includes(d.device_id) && d.latitude && d.longitude
      )
      
      console.log('Valid devices found:', validDevices.length)
      
      if (validDevices.length === 0) return
      
      if (validDevices.length === 1) {
        const device = validDevices[0]
        mapInstanceRef.current.setView([parseFloat(device.latitude), parseFloat(device.longitude)], 16)
      } else {
        const bounds = L.latLngBounds()
        validDevices.forEach(device => {
          bounds.extend([parseFloat(device.latitude), parseFloat(device.longitude)])
        })
        
        // Calculate distance between devices to determine optimal zoom
        const device1 = validDevices[0]
        const device2 = validDevices[1]
        const lat1 = parseFloat(device1.latitude)
        const lng1 = parseFloat(device1.longitude)
        const lat2 = parseFloat(device2.latitude)
        const lng2 = parseFloat(device2.longitude)
        
        // Calculate distance using Haversine formula
        const R = 6371e3 // Earth's radius in meters
        const φ1 = lat1 * Math.PI/180
        const φ2 = lat2 * Math.PI/180
        const Δφ = (lat2-lat1) * Math.PI/180
        const Δλ = (lng2-lng1) * Math.PI/180

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ/2) * Math.sin(Δλ/2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
        const distance = R * c // Distance in meters
        
        console.log('Calculated distance:', distance)
        
        // Determine zoom level and padding based on distance
        let maxZoom, padding
        
        if (distance < 50) {
          // Very close devices - high zoom with minimal padding
          maxZoom = 18
          padding = [10, 10]
        } else if (distance < 200) {
          // Close devices - medium-high zoom
          maxZoom = 17
          padding = [15, 15]
        } else if (distance < 1000) {
          // Nearby devices - medium zoom
          maxZoom = 15
          padding = [20, 20]
        } else if (distance < 5000) {
          // Moderate distance - lower zoom
          maxZoom = 13
          padding = [30, 30]
        } else if (distance < 25000) {
          // Far devices - city level zoom
          maxZoom = 11
          padding = [40, 40]
        } else {
          // Very far devices - regional zoom
          maxZoom = 9
          padding = [50, 50]
        }
        
        console.log('Using maxZoom:', maxZoom, 'padding:', padding)
        
        mapInstanceRef.current.fitBounds(bounds, { 
          padding: padding,
          maxZoom: maxZoom
        })
      }
    }
  }))

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

  // Handle selectedDevice changes
  useEffect(() => {
    if (selectedDevice && mapInstanceRef.current) {
      const lat = parseFloat(selectedDevice.latitude)
      const lng = parseFloat(selectedDevice.longitude)
      
      // Zoom to selected device
      mapInstanceRef.current.setView([lat, lng], 16)
      
      // Open popup for selected device
      const marker = markersRef.current[selectedDevice.device_id]
      if (marker) {
        marker.openPopup()
      }
    }
  }, [selectedDevice])

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

      // Check if this is the selected device
      const isSelected = selectedDevice && selectedDevice.device_id === device.device_id

      // Create custom marker with device name label
      const customIcon = L.divIcon({
        html: `
          <div style="display: flex; flex-direction: column; align-items: center;">
            <div style="
              background-color: ${markerColor};
              width: ${isSelected ? '20px' : '16px'};
              height: ${isSelected ? '20px' : '16px'};
              border-radius: 50%;
              border: 3px solid ${isSelected ? '#3b82f6' : 'white'};
              box-shadow: 0 2px 6px rgba(0,0,0,0.3);
              position: relative;
              ${isSelected ? 'animation: pulse 2s infinite;' : ''}
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
              background: ${isSelected ? '#3b82f6' : 'rgba(0,0,0,0.8)'};
              color: white;
              padding: 2px 6px;
              border-radius: 4px;
              font-size: ${isSelected ? '12px' : '11px'};
              font-weight: 500;
              white-space: nowrap;
              margin-top: 4px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            ">
              ${device.device_name || 'Unknown Device'}
            </div>
          </div>
          <style>
            @keyframes pulse {
              0% { transform: scale(1); }
              50% { transform: scale(1.1); }
              100% { transform: scale(1); }
            }
          </style>
        `,
        className: 'custom-device-marker',
        iconSize: [120, 60],
        iconAnchor: [60, 30]
      })

      // Create marker
      const marker = L.marker([lat, lng], { icon: customIcon })
        .addTo(mapInstanceRef.current)

      // Add click handler to marker
      marker.on('click', () => {
        if (onDeviceSelect) {
          onDeviceSelect(device)
        }
      })

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
            ${isSelected ? '<span style="margin-left: 8px; color: #3b82f6; font-size: 12px;">● SELECTED</span>' : ''}
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
          
          ${onDeviceSelect ? `
            <div style="margin-top: 8px;">
              <button 
                onclick="window.selectDevice && window.selectDevice('${device.device_id}')"
                style="
                  background: #3b82f6;
                  color: white;
                  border: none;
                  padding: 4px 8px;
                  border-radius: 4px;
                  font-size: 12px;
                  cursor: pointer;
                "
              >
                ${isSelected ? 'Selected' : 'Select Device'}
              </button>
            </div>
          ` : ''}
        </div>
      `

      marker.bindPopup(popupContent)
      
      // Store marker reference
      markersRef.current[device.device_id || device.id] = marker

      // Add to bounds
      bounds.extend([lat, lng])
    })

    // Set up global function for popup button clicks
    if (onDeviceSelect) {
      window.selectDevice = (deviceId) => {
        const device = devices.find(d => d.device_id === deviceId)
        if (device) {
          onDeviceSelect(device)
        }
      }
    }

    // Fit map to show all markers (only if no specific device is selected)
    if (hasValidCoordinates && devices.length > 0 && !selectedDevice) {
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

  }, [devices, selectedDevice, onDeviceSelect])

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
          {selectedDevice && (
            <div className="flex items-center border-t pt-1 mt-1">
              <div className="w-3 h-3 rounded-full bg-blue-600 border border-white mr-2"></div>
              <span className="text-xs font-medium">Selected</span>
            </div>
          )}
        </div>
      </div>

      {/* Device count indicator */}
      {devices.length > 0 && (
        <div className="absolute top-4 right-4 bg-white bg-opacity-95 px-3 py-2 rounded-lg shadow-md z-10">
          <div className="text-sm font-medium text-gray-900">
            {devices.length} device{devices.length !== 1 ? 's' : ''} visible
            {selectedDevice && (
              <div className="text-xs text-blue-600 mt-1">
                Selected: {selectedDevice.device_name}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Clear selection button */}
      {selectedDevice && onDeviceSelect && (
        <div className="absolute top-4 left-4 bg-white bg-opacity-95 px-3 py-2 rounded-lg shadow-md z-10">
          <button
            onClick={() => onDeviceSelect(null)}
            className="text-xs text-gray-600 hover:text-gray-800"
          >
            ✕ Clear selection
          </button>
        </div>
      )}
    </div>
  )
})

MapComponent.displayName = 'MapComponent'

export default MapComponent