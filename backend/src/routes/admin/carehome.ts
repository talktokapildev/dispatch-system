import { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

export default async function adminCareHomeRoutes(fastify: FastifyInstance) {
  // ─── ACCOUNTS ───────────────────────────────────────────────────────────────

  // GET /admin/carehome — list all care home accounts
  fastify.get("/admin/carehome", async (request, reply) => {
    const accounts = await prisma.careHomeAccount.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { residents: true, bookings: true } },
      },
    });
    return accounts;
  });

  // POST /admin/carehome — create care home account + initial staff member
  fastify.post<{
    Body: {
      name: string;
      address: string;
      contactName: string;
      contactEmail: string;
      contactPhone: string;
      invoicingEmail: string;
      paymentTermsDays?: number;
      notes?: string;
      staffName: string;
      staffEmail: string;
      staffPassword: string;
      staffPhone?: string;
    };
  }>("/admin/carehome", async (request, reply) => {
    const {
      name,
      address,
      contactName,
      contactEmail,
      contactPhone,
      invoicingEmail,
      paymentTermsDays,
      notes,
      staffName,
      staffEmail,
      staffPassword,
      staffPhone,
    } = request.body;

    const passwordHash = await bcrypt.hash(staffPassword, 10);

    const account = await prisma.careHomeAccount.create({
      data: {
        name,
        address,
        contactName,
        contactEmail,
        contactPhone,
        invoicingEmail,
        paymentTermsDays: paymentTermsDays
          ? parseInt(String(paymentTermsDays))
          : 30,
        notes,
        staff: {
          create: {
            name: staffName,
            email: staffEmail,
            passwordHash,
            phone: staffPhone || undefined,
          },
        },
      },
      include: { staff: true },
    });
    return account;
  });

  // GET /admin/carehome/:id
  fastify.get<{ Params: { id: string } }>(
    "/admin/carehome/:id",
    async (request, reply) => {
      const account = await prisma.careHomeAccount.findUnique({
        where: { id: request.params.id },
        include: {
          residents: { where: { isActive: true }, orderBy: { name: "asc" } },
          staff: true,
          invoices: { orderBy: { createdAt: "desc" }, take: 12 },
          bookings: {
            include: { resident: true },
            orderBy: { createdAt: "desc" },
            take: 10,
          },
          recurringBookings: {
            include: { resident: true },
            orderBy: { createdAt: "desc" },
          },
          _count: { select: { bookings: true, residents: true } },
        },
      });
      if (!account) return reply.status(404).send({ error: "Not found" });
      return account;
    }
  );

  // PUT /admin/carehome/:id — update account
  fastify.put<{
    Params: { id: string };
    Body: {
      name?: string;
      address?: string;
      contactName?: string;
      contactEmail?: string;
      contactPhone?: string;
      invoicingEmail?: string;
      paymentTermsDays?: number;
      notes?: string;
    };
  }>("/admin/carehome/:id", async (request, reply) => {
    const account = await prisma.careHomeAccount.update({
      where: { id: request.params.id },
      data: request.body,
    });
    return account;
  });

  // PATCH /admin/carehome/:id/suspend
  fastify.patch<{ Params: { id: string } }>(
    "/admin/carehome/:id/suspend",
    async (request, reply) => {
      const account = await prisma.careHomeAccount.update({
        where: { id: request.params.id },
        data: { status: "SUSPENDED" },
      });
      return account;
    }
  );

  // PATCH /admin/carehome/:id/reactivate
  fastify.patch<{ Params: { id: string } }>(
    "/admin/carehome/:id/reactivate",
    async (request, reply) => {
      const account = await prisma.careHomeAccount.update({
        where: { id: request.params.id },
        data: { status: "ACTIVE" },
      });
      return account;
    }
  );

  // PATCH /admin/carehome/:id/archive
  fastify.patch<{ Params: { id: string } }>(
    "/admin/carehome/:id/archive",
    async (request, reply) => {
      const account = await prisma.careHomeAccount.update({
        where: { id: request.params.id },
        data: { status: "ARCHIVED" },
      });
      return account;
    }
  );

  // ─── STAFF ──────────────────────────────────────────────────────────────────

  // POST /admin/carehome/:id/staff — add staff member
  fastify.post<{
    Params: { id: string };
    Body: { name: string; email: string; password: string; phone?: string };
  }>("/admin/carehome/:id/staff", async (request, reply) => {
    const { name, email, password, phone } = request.body;
    const passwordHash = await bcrypt.hash(password, 10);
    const staff = await prisma.careHomeStaff.create({
      data: { careHomeId: request.params.id, name, email, passwordHash, phone },
    });
    const { passwordHash: _, ...safe } = staff;
    return safe;
  });

  // DELETE /admin/carehome/:id/staff/:staffId
  fastify.delete<{ Params: { id: string; staffId: string } }>(
    "/admin/carehome/:id/staff/:staffId",
    async (request, reply) => {
      await prisma.careHomeStaff.delete({
        where: { id: request.params.staffId },
      });
      return { success: true };
    }
  );

  // ─── BOOKINGS ───────────────────────────────────────────────────────────────

  // GET /admin/carehome/:id/bookings
  fastify.get<{
    Params: { id: string };
    Querystring: { from?: string; to?: string };
  }>("/admin/carehome/:id/bookings", async (request, reply) => {
    const { from, to } = request.query;
    const bookings = await prisma.booking.findMany({
      where: {
        careHomeId: request.params.id,
        ...(from &&
          to && {
            scheduledAt: { gte: new Date(from), lte: new Date(to) },
          }),
      },
      include: { resident: true, driver: true },
      orderBy: { scheduledAt: "desc" },
    });
    return bookings;
  });

  // ─── INVOICES ───────────────────────────────────────────────────────────────

  // GET /admin/carehome/:id/invoices
  fastify.get<{ Params: { id: string } }>(
    "/admin/carehome/:id/invoices",
    async (request, reply) => {
      const invoices = await prisma.careHomeInvoice.findMany({
        where: { careHomeId: request.params.id },
        orderBy: { createdAt: "desc" },
      });
      return invoices;
    }
  );

  // POST /admin/carehome/:id/invoices/generate — generate invoice for a period
  fastify.post<{
    Params: { id: string };
    Body: { periodFrom: string; periodTo: string; paymentTermsDays?: number };
  }>("/admin/carehome/:id/invoices/generate", async (request, reply) => {
    const { periodFrom, periodTo, paymentTermsDays } = request.body;
    const from = new Date(periodFrom);
    const to = new Date(periodTo);

    // Find all completed bookings in period not yet invoiced
    const bookings = await prisma.booking.findMany({
      where: {
        careHomeId: request.params.id,
        status: "COMPLETED",
        careHomeInvoiceId: null,
        scheduledAt: { gte: from, lte: to },
      },
    });

    if (bookings.length === 0) {
      return reply
        .status(400)
        .send({ error: "No uninvoiced completed bookings in this period" });
    }

    const totalAmount = bookings.reduce(
      (sum, b) => sum + (b.actualFare ?? b.estimatedFare ?? 0),
      0
    );

    const account = await prisma.careHomeAccount.findUnique({
      where: { id: request.params.id },
    });
    const terms = paymentTermsDays ?? account?.paymentTermsDays ?? 30;
    const dueDate = new Date(to);
    dueDate.setDate(dueDate.getDate() + terms);

    const invoice = await prisma.careHomeInvoice.create({
      data: {
        careHomeId: request.params.id,
        periodFrom: from,
        periodTo: to,
        dueDate,
        totalAmount,
        bookings: { connect: bookings.map((b) => ({ id: b.id })) },
      },
      include: { bookings: true },
    });
    return invoice;
  });

  // PATCH /admin/carehome/invoices/:invoiceId/mark-paid
  fastify.patch<{ Params: { invoiceId: string } }>(
    "/admin/carehome/invoices/:invoiceId/mark-paid",
    async (request, reply) => {
      const invoice = await prisma.careHomeInvoice.update({
        where: { id: request.params.invoiceId },
        data: { isPaid: true, paidAt: new Date() },
      });
      return invoice;
    }
  );

  // ─── RECURRING BOOKINGS ─────────────────────────────────────────────────────

  // GET /admin/carehome/:id/recurring
  fastify.get<{ Params: { id: string } }>(
    "/admin/carehome/:id/recurring",
    async (request, reply) => {
      const recurring = await prisma.recurringBooking.findMany({
        where: { careHomeId: request.params.id },
        include: { resident: true },
        orderBy: { createdAt: "desc" },
      });
      return recurring;
    }
  );
}
