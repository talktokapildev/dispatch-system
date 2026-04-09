import { PrismaClient, VehicleClass } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // ─── Admin user ───
  const passwordHash = await bcrypt.hash('Admin1234!', 12)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@dispatch.com' },
    update: {},
    create: {
      phone: '+447000000000',
      email: 'admin@dispatch.com',
      firstName: 'System',
      lastName: 'Admin',
      role: 'ADMIN',
      isVerified: true,
      passwordHash,
      adminProfile: { create: { permissions: ['ALL'] } },
    },
  })

  const dispatcher = await prisma.user.upsert({
    where: { email: 'dispatcher@dispatch.com' },
    update: {},
    create: {
      phone: '+447000000001',
      email: 'dispatcher@dispatch.com',
      firstName: 'Main',
      lastName: 'Dispatcher',
      role: 'DISPATCHER',
      isVerified: true,
      passwordHash,
      adminProfile: { create: { permissions: ['BOOKINGS', 'DRIVERS', 'MAP'] } },
    },
  })

  console.log(`✅ Admin: ${admin.email}`)
  console.log(`✅ Dispatcher: ${dispatcher.email}`)

  // ─── Pricing zones ───
  const zones = [
    {
      name: 'Standard - Default',
      vehicleClass: VehicleClass.STANDARD,
      isDefault: true,
      baseFare: 3.50,
      perMile: 2.00,
      perMinute: 0.25,
      minimumFare: 5.00,
      airportPickupSupplement: 5.00,
      airportDropoffSupplement: 0,
      nightSupplement: 20,
      weekendSupplement: 10,
      bankHolidaySupplement: 25,
    },
    {
      name: 'Executive - Default',
      vehicleClass: VehicleClass.EXECUTIVE,
      isDefault: true,
      baseFare: 5.00,
      perMile: 3.00,
      perMinute: 0.40,
      minimumFare: 10.00,
      airportPickupSupplement: 10.00,
      airportDropoffSupplement: 0,
      nightSupplement: 20,
      weekendSupplement: 10,
      bankHolidaySupplement: 25,
    },
    {
      name: 'MPV - Default',
      vehicleClass: VehicleClass.MPV,
      isDefault: true,
      baseFare: 5.00,
      perMile: 2.50,
      perMinute: 0.35,
      minimumFare: 8.00,
      airportPickupSupplement: 8.00,
      airportDropoffSupplement: 0,
      nightSupplement: 20,
      weekendSupplement: 10,
      bankHolidaySupplement: 25,
    },
    {
      name: 'Minibus - Default',
      vehicleClass: VehicleClass.MINIBUS,
      isDefault: true,
      baseFare: 8.00,
      perMile: 3.50,
      perMinute: 0.50,
      minimumFare: 15.00,
      airportPickupSupplement: 15.00,
      airportDropoffSupplement: 0,
      nightSupplement: 20,
      weekendSupplement: 10,
      bankHolidaySupplement: 25,
    },
  ]

  for (const zone of zones) {
    await prisma.pricingZone.upsert({
      where: { id: zone.name.toLowerCase().replace(/\s/g, '-') },
      update: zone,
      create: { id: zone.name.toLowerCase().replace(/\s/g, '-'), ...zone },
    })
  }

  console.log(`✅ ${zones.length} pricing zones created`)

  // ─── Sample corporate account ───
  await prisma.corporateAccount.upsert({
    where: { id: 'sample-corp' },
    update: {},
    create: {
      id: 'sample-corp',
      companyName: 'Acme Corp Ltd',
      contactName: 'John Smith',
      contactEmail: 'john@acme.com',
      contactPhone: '+447123456789',
      address: '123 Business Park, London, EC1A 1BB',
      invoicingEmail: 'accounts@acme.com',
      paymentTermsDays: 30,
      creditLimit: 5000,
    },
  })

  console.log('✅ Sample corporate account created')
  console.log('\n🎉 Seed complete!')
  console.log('\n📋 Admin credentials:')
  console.log('   Email: admin@dispatch.com')
  console.log('   Password: Admin1234!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
