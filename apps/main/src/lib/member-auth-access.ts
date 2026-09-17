import { prisma } from "database";

export function tokenAuthEpoch(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

export function isLoginBlockedStatus(status: string): boolean {
  return status === "suspended" || status === "closed";
}

export function issuedSessionIsValid(args: {
  memberExists: boolean;
  status: string;
  dbEpoch: number;
  tokenEpoch: unknown;
}): boolean {
  if (!args.memberExists) return false;
  if (args.status === "closed") return false;
  return tokenAuthEpoch(args.tokenEpoch) === args.dbEpoch;
}

export async function memberAllowsIssuedSession(
  memberId: string,
  tokenEpoch: unknown
): Promise<{ ok: true; authEpoch: number; status: string } | { ok: false }> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { status: true, authEpoch: true },
  });
  if (!member) return { ok: false };
  if (
    !issuedSessionIsValid({
      memberExists: true,
      status: member.status,
      dbEpoch: member.authEpoch,
      tokenEpoch,
    })
  ) {
    return { ok: false };
  }
  return { ok: true, authEpoch: member.authEpoch, status: member.status };
}
