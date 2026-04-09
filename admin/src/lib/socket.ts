'use client'
import { useEffect, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '') ?? 'http://localhost:3001'

let socket: Socket | null = null

export function getSocket(token: string): Socket {
  if (!socket || !socket.connected) {
    socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
    })
  }
  return socket
}

export function useSocket(token: string | null, handlers: Record<string, (data: any) => void>) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!token) return

    const s = getSocket(token)

    const off: (() => void)[] = []
    for (const [event, handler] of Object.entries(handlersRef.current)) {
      const wrapper = (data: any) => handler(data)
      s.on(event, wrapper)
      off.push(() => s.off(event, wrapper))
    }

    return () => off.forEach((fn) => fn())
  }, [token])
}
