import { useState, useEffect } from 'react'
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
  ExclamationTriangleIcon
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
  const [locationPermission, setLocationPermission] = useState('prompt') // 'granted', 'denied', 'prompt'
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [locationStatus, setLocationStatus] = useState('checking') // 'checking', 'granted', 'denied', 'unavailable'
  
  // Movement detection
  const [lastPosition, setLastPosition] = useState(null)
  const [movementSpeed, setMovementSpeed] = useState(0)
  const [isMovingFast, setIsMovingFast] = useState(false)
  
  // App states
  const [allDeviceLocations, setAllDeviceLocations] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [currentTab, setCurrentTab] = useState('map')
  const [searchTerm, setSearchTerm] = useState('')

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
          switch(error.code) {
            case error.PERMISSION_DENIED:
              errorMessage += 'Permission denied by user'
              break
            case error.POSITION_UNAVAILABLE:
              errorMessage += 'Position unavailable'
              break
            case error.TIMEOUT:
              errorMessage += 'Request timeout'
              break
            default:
              errorMessage += 'Unknown error'
              break
          }
          
          toast.error(errorMessage)
        },
        {
          enableHighAccuracy: false, // Try with lower accuracy first
          timeout: 15000, // Increase timeout
          maximumAge: 300000 // Allow cached location up to 5 minutes
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
        .eq('user_id', user.id) // Also filter by user ID

      console.log('Device query result:', existingDevices, fetchError)

      // If there's an error that's NOT "no rows found", handle it
      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('Database error fetching device:', fetchError)
        toast.error('Database error: ' + fetchError.message)
        return
      }

      // Check if we found any existing devices for this user+UUID combination
      if (existingDevices && existingDevices.length > 0) {
        // Device exists and has a name - use it immediately
        const existingDevice = existingDevices[0]
        console.log('Found existing device:', existingDevice)
        
        setCurrentDevice(existingDevice)
        setIsDeviceSetupComplete(true)
        setShowDeviceNaming(false) // Make sure naming screen is hidden
        
        toast.success(`Welcome back! Using device: ${existingDevice.device_name}`)
        
        // Get current location and start tracking immediately
        getCurrentLocationAndDisplay(existingDevice)
        startLocationTracking()
      } else {
        // No device found for this UUID+user - need to create one
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
          device_type: 'mobile', // Default to mobile
          device_token: deviceUUID,
          is_online: true
        })
        .select()
        .single()

      if (error) {
        console.error('Error saving device:', error)
        toast.error('Error saving device: ' + error.message)
        return
      }

      console.log('Device saved successfully:', data)

      // Set the device and complete setup immediately
      setCurrentDevice(data)
      setIsDeviceSetupComplete(true)
      setShowDeviceNaming(false) // Hide naming screen
      
      toast.success(`Device "${deviceName}" registered successfully!`)
      
      // Get current location and show on map immediately
      getCurrentLocationAndDisplay(data)
      
      // Start continuous tracking
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

        // Send location update via WebSocket immediately
        socket.emit('location-update', locationData)

        // Also add to local state immediately for instant display
        const deviceLocationData = {
          device_id: device.id,
          device_name: device.device_name,
          device_type: device.device_type,
          is_online: true,
          username: user.email, // temporary until we get full user data
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

        // Update device status
        await updateDeviceStatus(true)
        
        toast.success(`📍 Location updated! Your device "${device.device_name}" is now visible on the map.`)
      },
      (error) => {
        console.error('Error getting initial location:', error)
        toast.error('Could not get initial location: ' + error.message)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0 // Force fresh location
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

        // Calculate movement if we have a previous position
        if (lastPosition) {
          const distance = calculateDistance(
            lastPosition.latitude, lastPosition.longitude,
            newPosition.latitude, newPosition.longitude
          )
          const timeDiff = (currentTime - lastPosition.timestamp) / 1000 // seconds
          const calculatedSpeed = timeDiff > 0 ? (distance / timeDiff) * 3.6 : 0 // km/h

          setMovementSpeed(calculatedSpeed)
          
          // Check if moving fast (>50 km/h)
          const isFast = calculatedSpeed > 50
          if (isFast !== isMovingFast) {
            setIsMovingFast(isFast)
            if (isFast) {
              toast(`🚗 Moving fast: ${Math.round(calculatedSpeed)} km/h`, { icon: '⚡' })
            }
          }
        }

        setLastPosition({
          ...newPosition,
          timestamp: currentTime
        })

        // Send location update via WebSocket
        const locationData = {
          deviceId: currentDevice.id,
          ...newPosition
        }

        socket.emit('location-update', locationData)

        // Update device online status
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

      // Emit status via WebSocket
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
    // Try to get battery level if available
    if ('getBattery' in navigator) {
      navigator.getBattery().then(battery => {
        return Math.round(battery.level * 100)
      })
    }
    return null
  }

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3 // Earth's radius in meters
    const φ1 = lat1 * Math.PI/180
    const φ2 = lat2 * Math.PI/180
    const Δφ = (lat2-lat1) * Math.PI/180
    const Δλ = (lon2-lon1) * Math.PI/180

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))

    return R * c // Distance in meters
  }

  const fetchAllDeviceLocations = async () => {
    try {
      console.log('Fetching all device locations...')
      
      // Try fetching from the view first
      let { data, error } = await supabase
        .from('current_device_locations')
        .select('*')

      if (error) {
        console.error('Error with view, trying direct query:', error)
        
        // If view fails, try direct query
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

        // Transform the data to match expected format
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
          username: 'Unknown' // We'll get this later
        }))
      }

      console.log('Fetched device locations:', data)
      setAllDeviceLocations(data || [])
    } catch (error) {
      console.error('Error fetching device locations:', error)
      setAllDeviceLocations([]) // Set empty array as fallback
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow-md">
          <div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow-md">
          <div>
            <DevicePhoneMobileIcon className="mx-auto h-12 w-12 text-blue-600" />
            <h2 className="mt-6 text-center text-2xl font-extrabold text-gray-900">
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
      
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-4">
              <h1 className="text-2xl font-bold text-gray-900">GPS Tracker</h1>
              {currentDevice && (
                <div className="flex items-center space-x-2 text-sm">
                  <DevicePhoneMobileIcon className="w-4 h-4 text-gray-500" />
                  <span className="text-gray-600">{currentDevice.device_name}</span>
                  <div className={`w-3 h-3 rounded-full ${isOnline && locationStatus === 'granted' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                </div>
              )}
            </div>
            <div className="flex items-center space-x-4">
              {/* Status indicators */}
              <div className="flex items-center space-x-2">
                {!isOnline && (
                  <div className="flex items-center text-red-600 text-sm">
                    <ExclamationTriangleIcon className="w-4 h-4 mr-1" />
                    Offline
                  </div>
                )}
                {locationStatus === 'denied' && isOnline && (
                  <div className="flex items-center text-orange-600 text-sm">
                    <ExclamationTriangleIcon className="w-4 h-4 mr-1" />
                    No Location
                  </div>
                )}
                {isMovingFast && (
                  <div className="flex items-center text-blue-600 text-sm">
                    ⚡ {Math.round(movementSpeed)} km/h
                  </div>
                )}
              </div>
              <span className="text-sm text-gray-600">{user?.email}</span>
              <button
                onClick={handleSignOut}
                className="bg-red-600 text-white px-4 py-2 rounded-md text-sm hover:bg-red-700"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Location permission request */}
      {locationStatus === 'denied' && isOnline && (
        <div className="bg-orange-50 border-b border-orange-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <ExclamationTriangleIcon className="h-5 w-5 text-orange-400 mr-3" />
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
                className="bg-orange-600 text-white px-4 py-2 rounded-md text-sm hover:bg-orange-700"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8">
            {['map', 'users'].map((tab) => (
              <button
                key={tab}
                onClick={() => setCurrentTab(tab)}
                className={`py-4 px-1 border-b-2 font-medium text-sm capitalize ${
                  currentTab === tab
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab === 'map' && <MapPinIcon className="w-5 h-5 inline mr-1" />}
                {tab === 'users' && <UserGroupIcon className="w-5 h-5 inline mr-1" />}
                {tab}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Map Tab */}
        {currentTab === 'map' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">Live GPS Tracking</h2>
              <div className="text-sm text-gray-600">
                {allDeviceLocations.length} devices online
              </div>
            </div>
            <MapComponent 
              devices={allDeviceLocations} 
              height="500px"
              showAllDevices={true}
            />
          </div>
        )}

        {/* Users Tab */}
        {currentTab === 'users' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">All Users</h2>
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search users..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Users Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredUsers.map((user) => (
                <div key={user.id} className="bg-white p-6 rounded-lg shadow-md border">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center">
                      <span className="text-white font-medium">
                        {user.username?.charAt(0)?.toUpperCase() || '?'}
                      </span>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-medium">{user.username}</h3>
                      {user.full_name && (
                        <p className="text-sm text-gray-600">{user.full_name}</p>
                      )}
                    </div>
                  </div>
                  
                  <div className="mt-4 text-xs text-gray-500">
                    Joined {format(new Date(user.created_at), 'MMM yyyy')}
                  </div>
                </div>
              ))}
            </div>

            {filteredUsers.length === 0 && (
              <div className="text-center py-12">
                <UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">No users found</h3>
                <p className="mt-1 text-sm text-gray-500">Try adjusting your search terms.</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}