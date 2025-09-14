// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://bsyvtlzcrvdrvnnxdvww.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzeXZ0bHpjcnZkcnZubnhkdnd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc1ODY4OTMsImV4cCI6MjA3MzE2Mjg5M30.4_KJ0mNNi06bOx3v3Ke8AzyQGyt4_7PV1pIaDMOAR50'

export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
})

// Database schema creation functions
export const createTables = async () => {
  try {
    // Create user_profiles table
    await supabase.rpc('create_user_profiles_table', {
      query: `
        CREATE TABLE IF NOT EXISTS user_profiles (
          id UUID REFERENCES auth.users(id) PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          full_name TEXT,
          bio TEXT,
          avatar_url TEXT,
          company_name TEXT,
          location TEXT,
          website TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_username ON user_profiles(username);
      `
    })

    // Create devices table
    await supabase.rpc('create_devices_table', {
      query: `
        CREATE TABLE IF NOT EXISTS devices (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
          device_name TEXT NOT NULL,
          device_token TEXT UNIQUE,
          device_type TEXT,
          is_online BOOLEAN DEFAULT FALSE,
          last_seen TIMESTAMPTZ,
          battery_level INTEGER CHECK (battery_level >= 0 AND battery_level <= 100),
          settings JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `
    })

    // Create location_history table
    await supabase.rpc('create_location_history_table', {
      query: `
        CREATE TABLE IF NOT EXISTS location_history (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
          latitude DECIMAL(10, 8) NOT NULL,
          longitude DECIMAL(11, 8) NOT NULL,
          accuracy DECIMAL(8, 2),
          speed DECIMAL(8, 2),
          heading DECIMAL(5, 2),
          altitude DECIMAL(8, 2),
          timestamp TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_device_timestamp ON location_history(device_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_timestamp ON location_history(timestamp DESC);
      `
    })

    // Create views
    await supabase.rpc('create_views', {
      query: `
        CREATE OR REPLACE VIEW devices_with_users AS
        SELECT 
          d.*,
          up.username,
          up.full_name,
          up.avatar_url,
          up.company_name
        FROM devices d
        JOIN user_profiles up ON d.user_id = up.id;

        CREATE OR REPLACE VIEW current_device_locations AS
        SELECT DISTINCT ON (device_id) 
          lh.*,
          d.device_name,
          d.device_type,
          d.is_online,
          up.username,
          up.full_name,
          up.avatar_url
        FROM location_history lh
        JOIN devices d ON lh.device_id = d.id
        JOIN user_profiles up ON d.user_id = up.id
        ORDER BY device_id, timestamp DESC;
      `
    })

    console.log('Database schema created successfully')
  } catch (error) {
    console.error('Error creating database schema:', error)
  }
}