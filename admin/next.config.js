/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['storage.googleapis.com', 'res.cloudinary.com'],
  },
}

module.exports = nextConfig
