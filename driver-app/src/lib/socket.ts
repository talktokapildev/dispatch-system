import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { SOCKET_URL, useAuthStore, api } from "./api";

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  return socket;
}

export function initSocket(token: string): Socket {
  if (socket?.connected) return socket;

  if (socket && !socket.connected) {
    socket.connect(); // reuse — don't create a second socket
    return socket;
  }

  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 2000,
  });

  // Add this handler:
  socket.on("reconnect", async () => {
    try {
      const { driver } = useAuthStore.getState();
      if (driver?.status === "AVAILABLE" || driver?.status === "ON_JOB") {
        await api.patch("/drivers/status", { status: driver.status });
      }
    } catch {}
  });

  socket.on("connect", () => console.log("Socket connected"));
  socket.on("disconnect", (reason) =>
    console.log("Socket disconnected:", reason)
  );
  socket.on("connect_error", (err) =>
    console.log("Socket error:", err.message)
  );

  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

export function useSocket(handlers: Record<string, (data: any) => void>) {
  const { token } = useAuthStore();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!token) return;

    const s = initSocket(token);
    const off: (() => void)[] = [];

    for (const [event, handler] of Object.entries(handlersRef.current)) {
      const wrapper = (data: any) => handler(data);
      s.on(event, wrapper);
      off.push(() => s.off(event, wrapper));
    }

    return () => off.forEach((fn) => fn());
  }, [token]);
}
