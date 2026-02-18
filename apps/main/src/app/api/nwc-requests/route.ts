import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { checkRateLimit, getClientIdentifier } from "@/lib/rate-limit";

const bodySchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  email: z.string().email("Valid email is required"),
  message: z.string().min(1, "Message is required").max(10000),
});

export async function POST(req: NextRequest) {
  const key = `nwc-requests:${getClientIdentifier(req)}`;
  const { allowed } = checkRateLimit(key);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const data = bodySchema.parse(body);

    const session = await getServerSession(authOptions);
    const memberId = session?.user?.id ?? null;

    await prisma.nwcRequest.create({
      data: {
        memberId,
        name: data.name.trim(),
        email: data.email.trim().toLowerCase(),
        message: data.message.trim(),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: e.errors[0]?.message ?? "Invalid input" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Failed to send request" }, { status: 500 });
  }
}
