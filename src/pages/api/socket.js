import { Server } from 'socket.io'
import { supabase } from '../../lib/supabase'

let io

const SocketHandler = (req, res) => {
  if (!res.socket.server.io) {
    console.log('Setting up Socket.IO server...')
    
    io = new Server(res.socket.server, {
      path: '/api/socket',
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    })

    res.socket.server.io = io

    io.on('connection', (socket) => {
      console.log('Client connected:', socket.id)

      // Join room for specific user
      socket.on('join-user', (userId) => {
        socket.join(`user-${userId}`)
        console.log(`User ${userId} joined their room`)
      })

      // Join global room for all updates
      socket.on('join-global', () => {
        socket.join('global')
        console.log('Client joined global room')
      })

      // Handle device location updates
      socket.on('location-update', async (data) => {
        try {
          const { deviceId, latitude, longitude, accuracy, speed, heading, altitude, timestamp } = data

          // Insert location into database
          const { error: locationError } = await supabase
            .from('location_history')
            .insert({
              device_id: deviceId,
              latitude,
              longitude,
              accuracy,
              speed,
              heading,
              altitude,
              timestamp: timestamp || new Date().toISOString()
            })

          if (locationError) {
            console.error('Error inserting location:', locationError)
            return
          }

          // Update device last seen and online status
          const { error: deviceError } = await supabase
            .from('devices')
            .update({ 
              last_seen: new Date().toISOString(),
              is_online: true 
            })
            .eq('id', deviceId)

          if (deviceError) {
            console.error('Error updating device:', deviceError)
            return
          }

          // Get device info with user details
          const { data: deviceInfo } = await supabase
            .from('devices_with_users')
            .select('*')
            .eq('id', deviceId)
            .single()

          // Broadcast to global room
          io.to('global').emit('location-updated', {
            ...data,
            deviceInfo
          })

          // Broadcast to specific user room
          if (deviceInfo) {
            io.to(`user-${deviceInfo.user_id}`).emit('device-location-updated', {
              ...data,
              deviceInfo
            })
          }

        } catch (error) {
          console.error('Error handling location update:', error)
        }
      })

      // Handle device status updates
      socket.on('device-status', async (data) => {
        try {
          const { deviceId, isOnline, batteryLevel } = data

          const { error } = await supabase
            .from('devices')
            .update({ 
              is_online: isOnline,
              battery_level: batteryLevel,
              last_seen: new Date().toISOString()
            })
            .eq('id', deviceId)

          if (!error) {
            // Broadcast status update
            io.to('global').emit('device-status-updated', data)
          }
        } catch (error) {
          console.error('Error updating device status:', error)
        }
      })

      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id)
      })
    })

    // Set up periodic offline device checker
    setInterval(async () => {
      try {
        const { error } = await supabase
          .from('devices')
          .update({ is_online: false })
          .lt('last_seen', new Date(Date.now() - 2 * 60 * 1000).toISOString()) // 2 minutes ago
          .eq('is_online', true)

        if (!error) {
          // Notify clients about offline devices
          io.to('global').emit('devices-offline-check')
        }
      } catch (error) {
        console.error('Error checking offline devices:', error)
      }
    }, 30000) // Check every 30 seconds

    console.log('Socket.IO server initialized')
  }

  res.end()
}

export default SocketHandler