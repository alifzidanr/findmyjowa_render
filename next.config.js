// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  env: {
    SUPABASE_URL: 'https://bsyvtlzcrvdrvnnxdvww.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzeXZ0bHpjcnZkcnZubnhkdnd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc1ODY4OTMsImV4cCI6MjA3MzE2Mjg5M30.4_KJ0mNNi06bOx3v3Ke8AzyQGyt4_7PV1pIaDMOAR50'
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
    };
    return config;
  },
}

module.exports = nextConfig