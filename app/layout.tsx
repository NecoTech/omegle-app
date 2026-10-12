import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Video Chat App',
  description: 'Random video chat with strangers',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
