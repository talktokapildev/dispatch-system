import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from 'react-hot-toast'

export const metadata: Metadata = {
  title: 'OrangeRide Corporate',
  description: 'OrangeRide Corporate Booking Portal',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: { fontSize: 13, borderRadius: 8 },
            success: { iconTheme: { primary: '#ff8c1a', secondary: '#fff' } },
          }}
        />
      </body>
    </html>
  )
}
