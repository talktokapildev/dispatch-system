import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { SOCKET_URL, useAuthStore } from './api'

let socket: Socket | null = null

export function getSocket(): Socket | null {
  return socket
}

export function initSocket(token: string): Socket {
  if (socket?.connected) return socket

  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 2000,
  })

  socket.on('connect', () => console.log('[Passenger] Socket connected'))
  socket.on('disconnect', (reason) => console.log('[Passenger] Socket disconnected:', reason))
  socket.on('connect_error', (err) => console.log('[Passenger] Socket error:', err.message))

  return socket
}

export function disconnectSocket() {
  socket?.disconnect()
  socket = null
}

export function useSocket(handlers: Record<string, (data: any) => void>) {
  const { token } = useAuthStore()
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!token) return

    const s = initSocket(token)
    const off: (() => void)[] = []

    for (const [event, handler] of Object.entries(handlersRef.current)) {
      const wrapper = (data: any) => handler(data)
      s.on(event, wrapper)
      off.push(() => s.off(event, wrapper))
    }

    return () => off.forEach((fn) => fn())
  }, [token])
}
