import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import AuthGuard from '@/components/AuthGuard';
import './globals.css'

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Totus Web Calling',
  description: 'Web calling application for Totus',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthGuard>{children}</AuthGuard>
      </body>
    </html>
  )
}
