import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  const { id: postId } = await params;
  const { optionId } = await req.json();
  if (!optionId || typeof optionId !== "string") {
    return NextResponse.json({ error: "optionId is required" }, { status: 400 });
  }

  const option = await prisma.postPollOption.findUnique({
    where: { id: optionId },
    include: { poll: { select: { postId: true } } },
  });
  if (!option || option.poll.postId !== postId) {
    return NextResponse.json({ error: "Invalid option for this post" }, { status: 404 });
  }

  const existingVotes = await prisma.postPollVote.findMany({
    where: {
      option: { pollId: option.pollId },
      memberId: session.user.id,
    },
    select: { id: true, optionId: true },
  });

  if (existingVotes.length > 0) {
    const alreadyVotedSameOption = existingVotes.some((v) => v.optionId === optionId);

    await prisma.$transaction([
      ...existingVotes.map((v) =>
        prisma.postPollVote.delete({ where: { id: v.id } })
      ),
      ...(alreadyVotedSameOption
        ? []
        : [
            prisma.postPollVote.create({
              data: { optionId, memberId: session.user.id },
            }),
          ]),
    ]);
  } else {
    await prisma.postPollVote.create({
      data: { optionId, memberId: session.user.id },
    });
  }

  return buildPollResponse(option.pollId, session.user.id);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: postId } = await params;

  const session = await getSessionForApi(req);
  const viewerId = session?.user?.id ?? null;

  const poll = await prisma.postPoll.findUnique({
    where: { postId },
    include: {
      options: {
        include: {
          _count: { select: { votes: true } },
        },
      },
    },
  });

  if (!poll) {
    return NextResponse.json({ error: "No poll found for this post" }, { status: 404 });
  }

  let myVote: string | undefined;
  if (viewerId) {
    const vote = await prisma.postPollVote.findFirst({
      where: {
        memberId: viewerId,
        option: { pollId: poll.id },
      },
      select: { optionId: true },
    });
    myVote = vote?.optionId ?? undefined;
  }

  const options = poll.options.map((o) => ({
    id: o.id,
    label: o.label,
    voteCount: o._count.votes,
  }));
  const totalVotes = options.reduce((sum, o) => sum + o.voteCount, 0);

  return NextResponse.json({
    question: poll.question,
    options,
    totalVotes,
    myVote,
  });
}

async function buildPollResponse(pollId: string, viewerId: string) {
  const poll = await prisma.postPoll.findUnique({
    where: { id: pollId },
    include: {
      options: {
        include: {
          _count: { select: { votes: true } },
        },
      },
    },
  });

  if (!poll) {
    return NextResponse.json({ error: "Poll not found" }, { status: 404 });
  }

  const vote = await prisma.postPollVote.findFirst({
    where: {
      memberId: viewerId,
      option: { pollId: poll.id },
    },
    select: { optionId: true },
  });

  const options = poll.options.map((o) => ({
    id: o.id,
    label: o.label,
    voteCount: o._count.votes,
  }));
  const totalVotes = options.reduce((sum, o) => sum + o.voteCount, 0);

  return NextResponse.json({
    question: poll.question,
    options,
    totalVotes,
    myVote: vote?.optionId ?? undefined,
  });
}
