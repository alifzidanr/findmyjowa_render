//src/pages/index.js
import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { supabase } from '../lib/supabase'
import io from 'socket.io-client'
import toast, { Toaster } from 'react-hot-toast'
import { format } from 'date-fns'
import { 
  UserGroupIcon, 
  DevicePhoneMobileIcon, 
  MapPinIcon, 
  SignalIcon, 
  BatteryIcon,
  ClockIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  ExclamationTriangleIcon,
  ArrowsRightLeftIcon,
  EyeIcon,
  ListBulletIcon,
  CalculatorIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'

// Dynamically import Map component to avoid SSR issues
const MapComponent = dynamic(() => import('../components/MapComponent'), { 
  ssr: false,
  loading: () => <div className="w-full h-96 bg-gray-200 animate-pulse rounded-lg flex items-center justify-center">Loading Map...</div>
})

let socket
let watchId = null

export default function Home() {
  const [user, setUser] = useState(null)
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [loading, setLoading] = useState(true)
  
  // Auth states
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  
  // Device setup flow states
  const [deviceUUID, setDeviceUUID] = useState('')
  const [currentDevice, setCurrentDevice] = useState(null)
  const [isDeviceSetupComplete, setIsDeviceSetupComplete] = useState(false)
  const [deviceName, setDeviceName] = useState('')
  const [showDeviceNaming, setShowDeviceNaming] = useState(false)
  const [locationPermission, setLocationPermission] = useState('prompt')
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [locationStatus, setLocationStatus] = useState('checking')
  
  // Movement detection
  const [lastPosition, setLastPosition] = useState(null)
  const [movementSpeed, setMovementSpeed] = useState(0)
  const [isMovingFast, setIsMovingFast] = useState(false)
  
  // App states
  const [allDeviceLocations, setAllDeviceLocations] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [currentTab, setCurrentTab] = useState('map')
  const [searchTerm, setSearchTerm] = useState('')
  
  // Enhanced states for mobile responsiveness
  const [activeSidebar, setActiveSidebar] = useState(null) // 'devices' | 'distance' | null
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [distanceFrom, setDistanceFrom] = useState('')
  const [distanceTo, setDistanceTo] = useState('')
  const [calculatedDistance, setCalculatedDistance] = useState(null)

  // Map reference for programmatic control
  const mapRef = useRef(null)

  useEffect(() => {
    checkUser()
    generateOrGetDeviceUUID()
    checkOnlineStatus()
    socketInitializer()
    
    // Listen for online/offline events
    window.addEventListener('online', () => setIsOnline(true))
    window.addEventListener('offline', () => setIsOnline(false))
    
    return () => {
      if (socket) socket.disconnect()
      if (watchId) navigator.geolocation.clearWatch(watchId)
      window.removeEventListener('online', () => setIsOnline(true))
      window.removeEventListener('offline', () => setIsOnline(false))
    }
  }, [])

  useEffect(() => {
    if (isSignedIn && deviceUUID) {
      requestLocationPermission()
    }
  }, [isSignedIn, deviceUUID])

  useEffect(() => {
    if (isSignedIn) {
      fetchAllDeviceLocations()
      fetchAllUsers()
    }
  }, [isSignedIn])

  // Calculate distance when from/to devices change
  useEffect(() => {
    if (distanceFrom && distanceTo && distanceFrom !== distanceTo) {
      calculateDistanceBetweenDevices()
    }
  }, [distanceFrom, distanceTo, allDeviceLocations])

  // Mobile responsive sidebar handler
  const toggleSidebar = (sidebarType) => {
    if (activeSidebar === sidebarType) {
      setActiveSidebar(null)
    } else {
      setActiveSidebar(sidebarType)
    }
  }

  const generateOrGetDeviceUUID = () => {
    let uuid = localStorage.getItem('deviceUUID')
    console.log('Existing UUID from localStorage:', uuid)
    
    if (!uuid) {
      // Generate a unique device identifier
      uuid = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
      localStorage.setItem('deviceUUID', uuid)
      console.log('Generated new UUID:', uuid)
    } else {
      console.log('Using existing UUID:', uuid)
    }
    
    setDeviceUUID(uuid)
  }

  const checkOnlineStatus = () => {
    setIsOnline(navigator.onLine)
  }

  const socketInitializer = async () => {
    await fetch('/api/socket')
    socket = io('', { path: '/api/socket' })

    socket.on('connect', () => {
      console.log('Connected to server')
      socket.emit('join-global')
    })

    socket.on('location-updated', (data) => {
      setAllDeviceLocations(prev => {
        const updated = prev.filter(loc => loc.device_id !== data.deviceId)
        return [...updated, {
          device_id: data.deviceId,
          latitude: data.latitude,
          longitude: data.longitude,
          timestamp: data.timestamp,
          ...data.deviceInfo
        }]
      })
    })

    socket.on('device-status-updated', (data) => {
      console.log('Device status updated:', data)
    })
  }

  const checkUser = async () => {
    try {
      const { data: { user }, error } = await supabase.auth.getUser()
      if (user && !error) {
        setUser(user)
        setIsSignedIn(true)
      }
    } catch (error) {
      console.error('Error checking user:', error)
    }
    setLoading(false)
  }

  const requestLocationPermission = async () => {
    if (!navigator.geolocation) {
      setLocationStatus('unavailable')
      toast.error('Geolocation is not supported by this browser')
      return
    }

    setLocationStatus('checking')
    
    try {
      // First check if we already have permission
      if ('permissions' in navigator) {
        const permission = await navigator.permissions.query({name: 'geolocation'})
        console.log('Permission status:', permission.state)
        
        if (permission.state === 'denied') {
          setLocationStatus('denied')
          setLocationPermission('denied')
          toast.error('Location access denied. Please reset location permissions in your browser.')
          return
        }
      }

      // Try to get current position to check permission
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          console.log('Location permission granted successfully', position)
          setLocationStatus('granted')
          setLocationPermission('granted')
          
          // Check if device exists, if not create it
          await checkAndCreateDevice()
        },
        (error) => {
          console.error('Location error details:', error)
          setLocationStatus('denied')
          setLocationPermission('denied')
          
          let errorMessage = 'Location access failed: '
          if (error && error.code) {
            switch(error.code) {
              case 1: // PERMISSION_DENIED
                errorMessage += 'Permission denied by user'
                break
              case 2: // POSITION_UNAVAILABLE
                errorMessage += 'Position unavailable'
                break
              case 3: // TIMEOUT
                errorMessage += 'Request timeout'
                break
              default:
                errorMessage += 'Unknown error'
                break
            }
          } else {
            errorMessage += 'Geolocation not supported or blocked'
          }
          
          toast.error(errorMessage)
        },
        {
          enableHighAccuracy: false,
          timeout: 15000,
          maximumAge: 300000
        }
      )
    } catch (error) {
      console.error('Error requesting location:', error)
      setLocationStatus('denied')
      toast.error('Failed to request location permission')
    }
  }

  const checkAndCreateDevice = async () => {
    if (!user || !deviceUUID) return

    try {
      console.log('Checking for device with UUID:', deviceUUID)
      
      // Check if device already exists
      const { data: existingDevices, error: fetchError } = await supabase
        .from('devices')
        .select('*')
        .eq('device_token', deviceUUID)
        .eq('user_id', user.id)

      console.log('Device query result:', existingDevices, fetchError)

      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('Database error fetching device:', fetchError)
        toast.error('Database error: ' + fetchError.message)
        return
      }

      if (existingDevices && existingDevices.length > 0) {
        const existingDevice = existingDevices[0]
        console.log('Found existing device:', existingDevice)
        
        setCurrentDevice(existingDevice)
        setIsDeviceSetupComplete(true)
        setShowDeviceNaming(false)
        
        toast.success(`Welcome back! Using device: ${existingDevice.device_name}`)
        
        getCurrentLocationAndDisplay(existingDevice)
        startLocationTracking()
      } else {
        console.log('No existing device found, showing naming screen')
        setShowDeviceNaming(true)
        setIsDeviceSetupComplete(false)
      }
    } catch (error) {
      console.error('Unexpected error checking device:', error)
      toast.error('Error checking device: ' + error.message)
    }
  }

  const saveDeviceName = async () => {
    if (!deviceName.trim()) {
      toast.error('Please enter a device name')
      return
    }

    try {
      console.log('Saving device with name:', deviceName, 'for user:', user.id, 'with UUID:', deviceUUID)
      
      const { data, error } = await supabase
        .from('devices')
        .insert({
          user_id: user.id,
          device_name: deviceName.trim(),
          device_type: 'mobile',
          device_token: deviceUUID,
          is_online: true
        })
        .select()
        .single()

      if (error) {console.error('Error saving device:', error)
        toast.error('Error saving device: ' + error.message)
        return
      }

      console.log('Device saved successfully:', data)

      setCurrentDevice(data)
      setIsDeviceSetupComplete(true)
      setShowDeviceNaming(false)
      
      toast.success(`Device "${deviceName}" registered successfully!`)
      
      getCurrentLocationAndDisplay(data)
      startLocationTracking()
    } catch (error) {
      console.error('Unexpected error saving device:', error)
      toast.error('Unexpected error: ' + error.message)
    }
  }

  const getCurrentLocationAndDisplay = (device) => {
    if (!navigator.geolocation) return

    console.log('Getting current location for device:', device.device_name)

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        console.log('Got position:', position.coords)
        
        const locationData = {
          deviceId: device.id,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed: position.coords.speed,
          heading: position.coords.heading,
          altitude: position.coords.altitude,
          timestamp: new Date().toISOString()
        }

        console.log('Sending location data:', locationData)

        socket.emit('location-update', locationData)

        const deviceLocationData = {
          device_id: device.id,
          device_name: device.device_name,
          device_type: device.device_type,
          is_online: true,
          username: user.email,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed: position.coords.speed,
          timestamp: new Date().toISOString()
        }

        console.log('Adding to local state:', deviceLocationData)

        setAllDeviceLocations(prev => {
          const filtered = prev.filter(loc => loc.device_id !== device.id)
          const newList = [...filtered, deviceLocationData]
          console.log('Updated device locations:', newList)
          return newList
        })

        await updateDeviceStatus(true)
        
        toast.success(`Location updated! Your device "${device.device_name}" is now visible on the map.`)
      },
      (error) => {
        console.error('Error getting initial location:', error)
        toast.error('Could not get initial location: ' + error.message)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    )
  }

  const startLocationTracking = () => {
    if (!navigator.geolocation || !currentDevice) return

    console.log('Starting location tracking for device:', currentDevice.device_name)

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const currentTime = Date.now()
        const newPosition = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed: position.coords.speed,
          heading: position.coords.heading,
          altitude: position.coords.altitude,
          timestamp: new Date().toISOString()
        }

        if (lastPosition) {
          const distance = calculateDistance(
            lastPosition.latitude, lastPosition.longitude,
            newPosition.latitude, newPosition.longitude
          )
          const timeDiff = (currentTime - lastPosition.timestamp) / 1000
          const calculatedSpeed = timeDiff > 0 ? (distance / timeDiff) * 3.6 : 0

          setMovementSpeed(calculatedSpeed)
          
          const isFast = calculatedSpeed > 50
          if (isFast !== isMovingFast) {
            setIsMovingFast(isFast)
            if (isFast) {
              toast(`Moving fast: ${Math.round(calculatedSpeed)} km/h`, { icon: '⚡' })
            }
          }
        }

        setLastPosition({
          ...newPosition,
          timestamp: currentTime
        })

        const locationData = {
          deviceId: currentDevice.id,
          ...newPosition
        }

        socket.emit('location-update', locationData)
        updateDeviceStatus(true)
      },
      (error) => {
        console.error('Location tracking error:', error)
        setLocationStatus('denied')
        updateDeviceStatus(false)
        
        if (error.code === error.PERMISSION_DENIED) {
          toast.error('Location permission was revoked')
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000
      }
    )
  }

  const updateDeviceStatus = async (isOnlineStatus) => {
    if (!currentDevice) return

    try {
      const { error } = await supabase
        .from('devices')
        .update({ 
          is_online: isOnlineStatus && isOnline,
          last_seen: new Date().toISOString()
        })
        .eq('id', currentDevice.id)

      if (error) {
        console.error('Error updating device status:', error)
      }

      socket.emit('device-status', {
        deviceId: currentDevice.id,
        isOnline: isOnlineStatus && isOnline,
        batteryLevel: getBatteryLevel()
      })
    } catch (error) {
      console.error('Error updating device status:', error)
    }
  }

  const getBatteryLevel = () => {
    if ('getBattery' in navigator) {
      navigator.getBattery().then(battery => {
        return Math.round(battery.level * 100)
      })
    }
    return null
  }

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3
    const φ1 = lat1 * Math.PI/180
    const φ2 = lat2 * Math.PI/180
    const Δφ = (lat2-lat1) * Math.PI/180
    const Δλ = (lon2-lon1) * Math.PI/180

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))

    return R * c
  }

  // New function to calculate distance between two devices
  const calculateDistanceBetweenDevices = () => {
    const fromDevice = allDeviceLocations.find(d => d.device_id === distanceFrom)
    const toDevice = allDeviceLocations.find(d => d.device_id === distanceTo)
    
    if (fromDevice && toDevice) {
      const distance = calculateDistance(
        fromDevice.latitude, fromDevice.longitude,
        toDevice.latitude, toDevice.longitude
      )
      setCalculatedDistance(distance)
    } else {
      setCalculatedDistance(null)
    }
  }

  // New function to zoom to specific device
  const zoomToDevice = (deviceId) => {
    const device = allDeviceLocations.find(d => d.device_id === deviceId)
    if (device && mapRef.current) {
      // Use the correct method name
      if (typeof mapRef.current.zoomToDevice === 'function') {
        mapRef.current.zoomToDevice(deviceId)
        setSelectedDevice(device)
        // Close sidebar on mobile after selecting device
        setActiveSidebar(null)
        toast.success(`Zoomed to ${device.device_name}`)
      } else {
        console.error('zoomToDevice method not found')
        toast.error('Map not ready. Please try again.')
      }
    }
  }

  // Format distance for display
  const formatDistance = (distance) => {
    if (distance < 1000) {
      return `${Math.round(distance)} m`
    } else if (distance < 100000) {
      return `${(distance / 1000).toFixed(1)} km`
    } else {
      return `${Math.round(distance / 1000)} km`
    }
  }

  // Reverse distance calculation
  const reverseDistanceSelection = () => {
    const temp = distanceFrom
    setDistanceFrom(distanceTo)
    setDistanceTo(temp)
  }

  const fetchAllDeviceLocations = async () => {
    try {
      console.log('Fetching all device locations...')
      
      let { data, error } = await supabase
        .from('current_device_locations')
        .select('*')

      if (error) {
        console.error('Error with view, trying direct query:', error)
        
        const { data: locations, error: locError } = await supabase
          .from('location_history')
          .select(`
            *,
            devices!inner(
              id,
              device_name,
              device_type,
              is_online,
              user_id
            )
          `)
          .order('timestamp', { ascending: false })
          .limit(100)

        if (locError) {
          console.error('Error fetching locations:', locError)
          return
        }

        data = locations.map(loc => ({
          device_id: loc.device_id,
          device_name: loc.devices.device_name,
          device_type: loc.devices.device_type,
          is_online: loc.devices.is_online,
          latitude: loc.latitude,
          longitude: loc.longitude,
          accuracy: loc.accuracy,
          speed: loc.speed,
          timestamp: loc.timestamp,
          username: 'Unknown'
        }))
      }

      console.log('Fetched device locations:', data)
      setAllDeviceLocations(data || [])
    } catch (error) {
      console.error('Error fetching device locations:', error)
      setAllDeviceLocations([])
    }
  }

  const fetchAllUsers = async () => {
    try {
      const { data } = await supabase
        .from('user_profiles')
        .select('*')
        .order('created_at', { ascending: false })

      setAllUsers(data || [])
    } catch (error) {
      console.error('Error fetching users:', error)
    }
  }

  const handleAuth = async (e) => {
    e.preventDefault()
    
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        })
        
        if (error) throw error
        
        if (data.user) {
          toast.success('Check your email for verification link!')
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        
        if (error) throw error
        
        setUser(data.user)
        setIsSignedIn(true)
        toast.success('Signed in successfully!')
      }
    } catch (error) {
      toast.error(error.message)
    }
  }

  const handleSignOut = async () => {
    if (watchId) {
      navigator.geolocation.clearWatch(watchId)
      watchId = null
    }
    
    if (currentDevice) {
      await updateDeviceStatus(false)
    }

    await supabase.auth.signOut()
    setUser(null)
    setIsSignedIn(false)
    setCurrentDevice(null)
    setIsDeviceSetupComplete(false)
    toast.success('Signed out successfully!')
  }

  const filteredUsers = allUsers.filter(user =>
    user.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.full_name?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full space-y-8 p-6 sm:p-8 bg-white rounded-lg shadow-md">
          <div>
            <h2 className="mt-6 text-center text-2xl sm:text-3xl font-extrabold text-gray-900">
              GPS Tracker
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              {isSignUp ? 'Create your account' : 'Sign in to your account'}
            </p>
          </div>
          <form onSubmit={handleAuth} className="mt-8 space-y-6">
            <div>
              <input
                type="email"
                required
                className="appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <input
                type="password"
                required
                className="appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <button
                type="submit"
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                {isSignUp ? 'Sign up' : 'Sign in'}
              </button>
            </div>
            <div className="text-center">
              <button
                type="button"
                onClick={() => setIsSignUp(!isSignUp)}
                className="text-blue-600 hover:text-blue-500 text-sm"
              >
                {isSignUp ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
              </button>
            </div>
          </form>
        </div>
        <Toaster position="top-right" />
      </div>
    )
  }

  // Device naming screen
  if (showDeviceNaming) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full space-y-8 p-6 sm:p-8 bg-white rounded-lg shadow-md">
          <div>
            <DevicePhoneMobileIcon className="mx-auto h-12 w-12 text-blue-600" />
            <h2 className="mt-6 text-center text-xl sm:text-2xl font-extrabold text-gray-900">
              Name Your Device
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              Give your device a recognizable name
            </p>
            <p className="mt-1 text-center text-xs text-gray-500">
              Device ID: {deviceUUID.slice(-8)}
            </p>
          </div>
          <div className="space-y-4">
            <input
              type="text"
              placeholder="e.g., My Phone, John's iPhone, Car GPS"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              className="appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              autoFocus
            />
            <button
              onClick={saveDeviceName}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Save Device Name
            </button>
          </div>
        </div>
        <Toaster position="top-right" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-right" />
      
      {/* Header - Mobile Responsive */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-2 sm:space-x-4">
              <h1 className="text-lg sm:text-2xl font-bold text-gray-900">GPS Tracker</h1>
              {currentDevice && (
                <div className="hidden sm:flex items-center space-x-2 text-sm">
                  <DevicePhoneMobileIcon className="w-4 h-4 text-gray-500" />
                  <span className="text-gray-600">{currentDevice.device_name}</span>
                  <div className={`w-3 h-3 rounded-full ${isOnline && locationStatus === 'granted' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                </div>
              )}
            </div>
            
            <div className="flex items-center space-x-1 sm:space-x-4">
              {/* Mobile responsive control buttons */}
              <button
                onClick={() => toggleSidebar('devices')}
                className={`p-2 rounded-md ${activeSidebar === 'devices' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'} hover:bg-blue-200`}
                title="Toggle Devices List"
              >
                <ListBulletIcon className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
              
              <button
                onClick={() => toggleSidebar('distance')}
                className={`p-2 rounded-md ${activeSidebar === 'distance' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'} hover:bg-green-200`}
                title="Distance Calculator"
              >
                <CalculatorIcon className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>

              {/* Status indicators - hidden on very small screens */}
              <div className="hidden sm:flex items-center space-x-2">
                {!isOnline && (
                  <div className="flex items-center text-red-600 text-sm">
                    <ExclamationTriangleIcon className="w-4 h-4 mr-1" />
                    <span className="hidden lg:inline">Offline</span>
                  </div>
                )}
                {locationStatus === 'denied' && isOnline && (
                  <div className="flex items-center text-orange-600 text-sm">
                    <ExclamationTriangleIcon className="w-4 h-4 mr-1" />
                    <span className="hidden lg:inline">No Location</span>
                  </div>
                )}
                {isMovingFast && (
                  <div className="flex items-center text-blue-600 text-sm">
                    ⚡ <span className="hidden lg:inline">{Math.round(movementSpeed)} km/h</span>
                  </div>
                )}
              </div>
              
              <span className="hidden sm:inline text-xs sm:text-sm text-gray-600 truncate max-w-20 sm:max-w-none">
                {user?.email}
              </span>
              <button
                onClick={handleSignOut}
                className="bg-red-600 text-white px-2 sm:px-4 py-2 rounded-md text-xs sm:text-sm hover:bg-red-700"
              >
                <span className="hidden sm:inline">Sign Out</span>
                <span className="sm:hidden">Out</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Location permission request - Mobile Responsive */}
      {locationStatus === 'denied' && isOnline && (
        <div className="bg-orange-50 border-b border-orange-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between space-y-3 sm:space-y-0">
              <div className="flex items-center">
                <ExclamationTriangleIcon className="h-5 w-5 text-orange-400 mr-3 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-orange-800">
                    Location access is required for tracking
                  </p>
                  <p className="text-sm text-orange-700">
                    Please enable location permissions in your browser settings
                  </p>
                </div>
              </div>
              <button
                onClick={requestLocationPermission}
                className="bg-orange-600 text-white px-4 py-2 rounded-md text-sm hover:bg-orange-700 w-full sm:w-auto"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex relative">
        {/* Mobile Responsive Sidebar - Only one can be active */}
        {activeSidebar && (
          <div className={`
            ${activeSidebar ? 'block' : 'hidden'}
            w-full sm:w-80 bg-white border-r shadow-sm
            absolute sm:relative z-20 h-screen sm:h-auto
          `}>
            {/* Sidebar Header with Close Button */}
            <div className="p-4 border-b flex justify-between items-center">
              <div>
                <h3 className="text-lg font-medium text-gray-900">
                  {activeSidebar === 'devices' ? 'Connected Devices' : 'Distance Calculator'}
                </h3>
                <p className="text-sm text-gray-500">
                  {activeSidebar === 'devices' ? 
                    `${allDeviceLocations.length} devices online` : 
                    'Calculate distance between devices'
                  }
                </p>
              </div>
              <button
                onClick={() => setActiveSidebar(null)}
                className="p-2 hover:bg-gray-100 rounded-md sm:hidden"
              >
                <XMarkIcon className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Devices List Content */}
            {activeSidebar === 'devices' && (
              <div className="divide-y divide-gray-200 max-h-screen sm:max-h-96 overflow-y-auto">
                {allDeviceLocations.map((device) => {
                  const timeDiff = (new Date() - new Date(device.timestamp)) / 1000 / 60
                  const isRecent = timeDiff < 5
                  const isStale = timeDiff >= 5 && timeDiff < 30
                  
                  return (
                    <div
                      key={device.device_id}
                      className="p-4 hover:bg-gray-50 cursor-pointer"
                      onClick={() => zoomToDevice(device.device_id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className={`w-3 h-3 rounded-full ${
                            device.is_online && isRecent ? 'bg-green-500' :
                            device.is_online && isStale ? 'bg-yellow-500' : 'bg-red-500'
                          }`}></div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {device.device_name}
                            </p>
                            <p className="text-xs text-gray-500 truncate">
                              {device.username} • {device.device_type}
                            </p>
                          </div>
                        </div>
                        <button className="p-1 hover:bg-gray-200 rounded flex-shrink-0">
                          <EyeIcon className="w-4 h-4 text-gray-400" />
                        </button>
                      </div>
                      
                      <div className="mt-2 text-xs text-gray-500 space-y-1">
                        <div>Last seen: {timeDiff < 1 ? 'Just now' : 
                                        timeDiff < 60 ? `${Math.round(timeDiff)}m ago` :
                                        timeDiff < 1440 ? `${Math.round(timeDiff/60)}h ago` :
                                        `${Math.round(timeDiff/1440)}d ago`}</div>
                        
                        {device.speed && device.speed > 0 && (
                          <div>Speed: {Math.round(device.speed * 10) / 10} km/h</div>
                        )}
                        
                        <div className="truncate">
                          📍 {parseFloat(device.latitude).toFixed(4)}, {parseFloat(device.longitude).toFixed(4)}
                        </div>
                      </div>
                    </div>
                  )
                })}
                
                {allDeviceLocations.length === 0 && (
                  <div className="p-8 text-center text-gray-500">
                    <DevicePhoneMobileIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                    <p>No devices online</p>
                  </div>
                )}
              </div>
            )}

            {/* Distance Calculator Content */}
            {activeSidebar === 'distance' && (
              <div className="p-4 space-y-4 max-h-screen overflow-y-auto">
                {/* From Device */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">From Device</label>
                  <select
                    value={distanceFrom}
                    onChange={(e) => setDistanceFrom(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select device...</option>
                    {allDeviceLocations.map(device => (
                      <option key={device.device_id} value={device.device_id}>
                        {device.device_name} ({device.username})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Reverse Button */}
                <div className="flex justify-center">
                  <button
                    onClick={reverseDistanceSelection}
                    disabled={!distanceFrom || !distanceTo}
                    className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Reverse selection"
                  >
                    <ArrowsRightLeftIcon className="w-4 h-4 text-gray-600" />
                  </button>
                </div>

                {/* To Device */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">To Device</label>
                  <select
                    value={distanceTo}
                    onChange={(e) => setDistanceTo(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select device...</option>
                    {allDeviceLocations.map(device => (
                      <option key={device.device_id} value={device.device_id}>
                        {device.device_name} ({device.username})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Distance Result */}
                {calculatedDistance !== null && distanceFrom && distanceTo && distanceFrom !== distanceTo && (
                  <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="text-sm font-medium text-blue-900 mb-1">Distance</div>
                    <div className="text-2xl font-bold text-blue-600">
                      {formatDistance(calculatedDistance)}
                    </div>
                    
                    {/* Additional info */}
                    <div className="mt-2 text-xs text-blue-700 space-y-1">
                      <div>As the crow flies</div>
                      {calculatedDistance > 100000 && (
                        <div>Long distance - consider flight time</div>
                      )}
                      {calculatedDistance < 100 && (
                        <div>Very close proximity</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Show selected devices info */}
                {distanceFrom && distanceTo && distanceFrom === distanceTo && (
                  <div className="mt-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                    <p className="text-sm text-yellow-800">Please select two different devices</p>
                  </div>
                )}

                {/* Quick actions */}
                {calculatedDistance !== null && distanceFrom && distanceTo && distanceFrom !== distanceTo && (
                  <div className="mt-4 space-y-2">
                    <button
                      onClick={() => {
                        console.log('Show Both on Map clicked')
                        console.log('mapRef.current:', mapRef.current)
                        
                        const fromDevice = allDeviceLocations.find(d => d.device_id === distanceFrom)
                        const toDevice = allDeviceLocations.find(d => d.device_id === distanceTo)
                        
                        console.log('fromDevice:', fromDevice)
                        console.log('toDevice:', toDevice)
                        
                        if (fromDevice && toDevice && mapRef.current) {
                          // Check if the method exists
                          if (typeof mapRef.current.showBothDevices === 'function') {
                            console.log('Calling showBothDevices with:', [distanceFrom, distanceTo])
                            mapRef.current.showBothDevices([distanceFrom, distanceTo])
                            
                            // Also clear any single device selection to show both
                            setSelectedDevice(null)
                            
                            // Close sidebar on mobile after action
                            setActiveSidebar(null)
                            
                            // Determine zoom level message based on distance
                            let zoomMessage = ''
                            if (calculatedDistance < 100) {
                              zoomMessage = 'Zooming in - devices are very close'
                            } else if (calculatedDistance < 1000) {
                              zoomMessage = 'Adjusting zoom for nearby devices'
                            } else if (calculatedDistance < 10000) {
                              zoomMessage = 'Zooming out to show both devices'
                            } else {
                              zoomMessage = 'Wide view - devices are far apart'
                            }
                            
                            toast.success(`${zoomMessage}: ${fromDevice.device_name} and ${toDevice.device_name}`)
                          } else {
                            console.error('showBothDevices method not found on mapRef.current')
                            console.log('Available methods:', Object.keys(mapRef.current || {}))
                            toast.error('Map method not available. Please try refreshing the page.')
                          }
                        } else {
                          console.log('Missing required data:', {
                            fromDevice: !!fromDevice,
                            toDevice: !!toDevice,
                            mapRef: !!mapRef.current
                          })
                          toast.error('Please ensure both devices are selected and the map is loaded.')
                        }
                      }}
                      className="w-full bg-blue-600 text-white py-2 px-4 rounded-md text-sm hover:bg-blue-700"
                    >
                      Show Both on Map
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Mobile Overlay */}
        {activeSidebar && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 z-10 sm:hidden"
            onClick={() => setActiveSidebar(null)}
          />
        )}

        {/* Main Content Area */}
        <div className="flex-1">
          {/* Navigation Tabs - Mobile Responsive */}
          <div className="bg-white border-b">
            <div className="px-3 sm:px-6">
              <nav className="flex space-x-4 sm:space-x-8">
                {['map', 'users'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setCurrentTab(tab)}
                    className={`py-4 px-1 border-b-2 font-medium text-xs sm:text-sm capitalize ${
                      currentTab === tab
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab === 'map' && <MapPinIcon className="w-4 h-4 sm:w-5 sm:h-5 inline mr-1" />}
                    {tab === 'users' && <UserGroupIcon className="w-4 h-4 sm:w-5 sm:h-5 inline mr-1" />}
                    <span className="hidden sm:inline">{tab}</span>
                  </button>
                ))}
              </nav>
            </div>
          </div>

          <main className="p-3 sm:p-6">
            {/* Map Tab - Mobile Responsive */}
            {currentTab === 'map' && (
              <div className="space-y-4 sm:space-y-6">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center space-y-2 sm:space-y-0">
                  <h2 className="text-lg sm:text-xl font-semibold">Live GPS Tracking</h2>
                  <div className="text-xs sm:text-sm text-gray-600">
                    {allDeviceLocations.length} devices online
                  </div>
                </div>
                <MapComponent 
                  ref={mapRef}
                  devices={allDeviceLocations} 
                  height="400px"
                  showAllDevices={true}
                  selectedDevice={selectedDevice}
                  onDeviceSelect={setSelectedDevice}
                />
              </div>
            )}

            {/* Users Tab - Mobile Responsive */}
            {currentTab === 'users' && (
              <div className="space-y-4 sm:space-y-6">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center space-y-3 sm:space-y-0">
                  <h2 className="text-lg sm:text-xl font-semibold">All Users</h2>
                  <div className="relative">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 sm:h-5 sm:w-5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search users..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9 sm:pl-10 pr-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-auto text-sm"
                    />
                  </div>
                </div>

                {/* Users Grid - Mobile Responsive */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                  {filteredUsers.map((user) => (
                    <div key={user.id} className="bg-white p-4 sm:p-6 rounded-lg shadow-md border">
                      <div className="flex items-center space-x-3 sm:space-x-4">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-white font-medium text-sm sm:text-base">
                            {user.username?.charAt(0)?.toUpperCase() || '?'}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-base sm:text-lg font-medium truncate">{user.username}</h3>
                          {user.full_name && (
                            <p className="text-xs sm:text-sm text-gray-600 truncate">{user.full_name}</p>
                          )}
                        </div>
                      </div>
                      
                      <div className="mt-3 sm:mt-4 text-xs text-gray-500">
                        Joined {format(new Date(user.created_at), 'MMM yyyy')}
                      </div>
                    </div>
                  ))}
                </div>

                {filteredUsers.length === 0 && (
                  <div className="text-center py-8 sm:py-12">
                    <UserGroupIcon className="mx-auto h-10 w-10 sm:h-12 sm:w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">No users found</h3>
                    <p className="mt-1 text-sm text-gray-500">Try adjusting your search terms.</p>
                  </div>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}