// ─────────────────────────────────────────
// Core enums (mirror Prisma enums for client use)
// ─────────────────────────────────────────

// export enum BookingStatus {
//   PENDING = 'PENDING',
//   CONFIRMED = 'CONFIRMED',
//   DRIVER_ASSIGNED = 'DRIVER_ASSIGNED',
//   DRIVER_EN_ROUTE = 'DRIVER_EN_ROUTE',
//   DRIVER_ARRIVED = 'DRIVER_ARRIVED',
//   IN_PROGRESS = 'IN_PROGRESS',
//   COMPLETED = 'COMPLETED',
//   CANCELLED = 'CANCELLED',
//   NO_SHOW = 'NO_SHOW',
// }

// export enum BookingType {
//   ASAP = 'ASAP',
//   PREBOOKED = 'PREBOOKED',
//   AIRPORT_PICKUP = 'AIRPORT_PICKUP',
//   AIRPORT_DROPOFF = 'AIRPORT_DROPOFF',
//   CORPORATE = 'CORPORATE',
// }

// export enum DriverStatus {
//   OFFLINE = 'OFFLINE',
//   AVAILABLE = 'AVAILABLE',
//   ON_JOB = 'ON_JOB',
//   BREAK = 'BREAK',
// }

// export enum VehicleClass {
//   STANDARD = 'STANDARD',
//   EXECUTIVE = 'EXECUTIVE',
//   MPV = 'MPV',
//   MINIBUS = 'MINIBUS',
// }

// export enum PaymentMethod {
//   CARD = 'CARD',
//   CASH = 'CASH',
//   APPLE_PAY = 'APPLE_PAY',
//   GOOGLE_PAY = 'GOOGLE_PAY',
//   ACCOUNT = 'ACCOUNT',
// }

// ─────────────────────────────────────────
// API Response wrapper
// ─────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─────────────────────────────────────────
// Location types
// ─────────────────────────────────────────

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface LocationWithAddress extends LatLng {
  address: string;
}

// ─────────────────────────────────────────
// Real-time socket events
// ─────────────────────────────────────────

export enum SocketEvent {
  // Driver events
  DRIVER_LOCATION_UPDATE = "driver:location_update",
  DRIVER_STATUS_CHANGE = "driver:status_change",
  DRIVER_JOB_OFFER = "driver:job_offer",
  DRIVER_JOB_ACCEPTED = "driver:job_accepted",
  DRIVER_JOB_REJECTED = "driver:job_rejected",

  // Booking events
  BOOKING_STATUS_UPDATE = "booking:status_update",
  BOOKING_DRIVER_LOCATION = "booking:driver_location",
  BOOKING_CONFIRMED = "booking:confirmed",
  BOOKING_CANCELLED = "booking:cancelled",

  // Admin events
  ADMIN_BOOKING_CREATED = "admin:booking_created",
  ADMIN_BOOKING_UPDATED = "admin:booking_updated",
  ADMIN_DRIVER_UPDATE = "admin:driver_update",

  // System
  PING = "ping",
  PONG = "pong",
}

export interface DriverLocationPayload {
  driverId: string;
  latitude: number;
  longitude: number;
  bearing: number;
  speed?: number;
  timestamp: number;
}

export interface BookingStatusPayload {
  bookingId: string;
  status: string;
  driverLocation?: LatLng;
  estimatedArrival?: number; // seconds
  timestamp: number;
}

// export interface JobOfferPayload {
//   bookingId: string
//   reference: string
//   type: string
//   pickupAddress: string
//   pickupLatitude: number
//   pickupLongitude: number
//   dropoffAddress: string
//   estimatedFare: number
//   scheduledAt?: string
//   passengerCount: number
//   notes?: string
//   flightNumber?: string
//   distanceToPickup?: number // km
//   timeoutMs: number
// }

export interface JobOfferPayload {
  bookingId: string;
  reference: string;
  type: string;
  pickupAddress: string;
  pickupLatitude: number;
  pickupLongitude: number;
  dropoffAddress: string;
  dropoffLatitude: number;
  dropoffLongitude: number;
  estimatedFare: number;
  scheduledAt?: string;
  passengerCount: number;
  notes?: string;
  flightNumber?: string;
  distanceToPickup?: number; // km from driver to pickup
  timeToPickupMins?: number; // mins from driver to pickup
  tripDistanceKm?: number; // km from pickup to dropoff
  tripDurationMins?: number; // mins from pickup to dropoff
  routePolyline?: string;
  timeoutMs: number;
}
