import { prisma } from "database";

const TAKE_EACH = 22;
const ORDER_WINDOW_DAYS = 90;

export type ActivityNav =
  | { kind: "friend_requests" }
  | { kind: "post"; postId: string; commentId?: string }
  | { kind: "blog"; slug: string }
  | { kind: "event_invites" }
  | { kind: "event"; slug: string }
  | { kind: "my_orders" }
  | { kind: "seller_orders" }
  | { kind: "buyer_order"; orderId: string }
  | { kind: "seller_order"; orderId: string }
  | { kind: "group"; slug: string }
  | { kind: "resale_chat"; conversationId: string }
  | { kind: "none" };

export type ActivityFeedItem = {
  id: string;
  type: string;
  category: "social" | "content" | "events" | "groups" | "commerce";
  title: string;
  subtitle: string | null;
  occurredAt: string;
  actor: {
    id: string;
    firstName: string;
    lastName: string;
    profilePhotoUrl: string | null;
  } | null;
  nav: ActivityNav;
};

function memberName(m: { firstName: string; lastName: string }): string {
  return [m.firstName, m.lastName].filter(Boolean).join(" ").trim() || "Someone";
}

function orderStatusLine(status: string): string {
  const s = status.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export async function getMeActivityFeed(
  memberId: string,
  opts: { blockedIds: Set<string> }
): Promise<ActivityFeedItem[]> {
  const { blockedIds } = opts;
  const orderSince = new Date();
  orderSince.setDate(orderSince.getDate() - ORDER_WINDOW_DAYS);

  const [
    incomingFriendReqs,
    postComments,
    postLikes,
    commentLikes,
    blogComments,
    eventInvites,
    groupAdminInvites,
    buyerOrders,
    sellerOrders,
    resaleOffersSeller,
    resaleOffersBuyer,
  ] = await Promise.all([
    prisma.friendRequest.findMany({
      where: { addresseeId: memberId, status: "pending" },
      include: {
        requester: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
      },
      orderBy: { createdAt: "desc" },
      take: TAKE_EACH,
    }),
    prisma.postComment.findMany({
      where: {
        post: { authorId: memberId },
        NOT: { memberId: memberId },
      },
      include: {
        member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        post: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
      take: TAKE_EACH,
    }),
    prisma.postLike.findMany({
      where: {
        post: { authorId: memberId },
        NOT: { memberId: memberId },
      },
      include: {
        member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        post: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
      take: TAKE_EACH,
    }),
    prisma.postCommentLike.findMany({
      where: {
        comment: { memberId: memberId },
        NOT: { memberId: memberId },
      },
      include: {
        member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        comment: { select: { id: true, postId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: TAKE_EACH,
    }),
    prisma.blogComment.findMany({
      where: {
        blog: { memberId: memberId },
        NOT: { memberId: memberId },
      },
      include: {
        member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        blog: { select: { id: true, slug: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: TAKE_EACH,
    }),
    prisma.eventInvite.findMany({
      where: { inviteeId: memberId, status: "pending" },
      include: {
        inviter: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        event: { select: { id: true, slug: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: TAKE_EACH,
    }),
    prisma.groupAdminInvite.findMany({
      where: { inviteeId: memberId, status: "pending" },
      include: {
        inviter: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        group: { select: { id: true, slug: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: TAKE_EACH,
    }),
    prisma.storeOrder.findMany({
      where: { buyerId: memberId, createdAt: { gte: orderSince } },
      include: {
        seller: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        items: { take: 1, select: { storeItem: { select: { title: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: TAKE_EACH,
    }),
    prisma.storeOrder.findMany({
      where: { sellerId: memberId, createdAt: { gte: orderSince } },
      include: {
        buyer: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        items: { take: 1, select: { storeItem: { select: { title: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: TAKE_EACH,
    }),
    prisma.resaleOffer.findMany({
      where: {
        status: "pending",
        storeItem: { memberId: memberId },
      },
      include: {
        buyer: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        storeItem: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: TAKE_EACH,
    }),
    prisma.resaleOffer.findMany({
      where: {
        buyerId: memberId,
        status: { in: ["accepted", "declined", "countered"] },
      },
      include: {
        storeItem: {
          select: { id: true, title: true, member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } } },
        },
      },
      orderBy: { respondedAt: "desc" },
      take: TAKE_EACH,
    }),
  ]);

  const resaleConvIds = new Map<string, string>();
  const resaleKeys = new Set<string>();
  for (const o of resaleOffersSeller) {
    resaleKeys.add(`${o.storeItemId}\t${o.buyerId}`);
  }
  for (const o of resaleOffersBuyer) {
    resaleKeys.add(`${o.storeItemId}\t${o.buyerId}`);
  }
  if (resaleKeys.size > 0) {
    const convs = await prisma.resaleConversation.findMany({
      where: {
        OR: Array.from(resaleKeys).map((k) => {
          const [storeItemId, buyerId] = k.split("\t");
          return { storeItemId, buyerId };
        }),
      },
      select: { id: true, storeItemId: true, buyerId: true },
    });
    for (const c of convs) {
      resaleConvIds.set(`${c.storeItemId}\t${c.buyerId}`, c.id);
    }
  }

  const items: ActivityFeedItem[] = [];

  const skipActor = (actorId: string | undefined) => actorId && blockedIds.has(actorId);

  for (const fr of incomingFriendReqs) {
    if (skipActor(fr.requester.id)) continue;
    items.push({
      id: `friend_request:${fr.id}`,
      type: "friend_request",
      category: "social",
      title: "Friend request",
      subtitle: `${memberName(fr.requester)} wants to connect`,
      occurredAt: fr.createdAt.toISOString(),
      actor: fr.requester,
      nav: { kind: "friend_requests" },
    });
  }

  for (const c of postComments) {
    if (skipActor(c.member.id)) continue;
    const preview = c.content.replace(/\s+/g, " ").trim().slice(0, 120);
    items.push({
      id: `post_comment:${c.id}`,
      type: "post_comment",
      category: "content",
      title: "Comment on your post",
      subtitle: `${memberName(c.member)}: ${preview}${c.content.length > 120 ? "…" : ""}`,
      occurredAt: c.createdAt.toISOString(),
      actor: c.member,
      nav: { kind: "post", postId: c.post.id, commentId: c.id },
    });
  }

  for (const like of postLikes) {
    if (skipActor(like.member.id)) continue;
    const liker = memberName(like.member);
    items.push({
      id: `post_like:${like.id}`,
      type: "post_like",
      category: "content",
      title: `${liker} liked your post`,
      subtitle: null,
      occurredAt: like.createdAt.toISOString(),
      actor: like.member,
      nav: { kind: "post", postId: like.post.id },
    });
  }

  for (const lk of commentLikes) {
    if (skipActor(lk.member.id)) continue;
    const liker = memberName(lk.member);
    items.push({
      id: `comment_like:${lk.id}`,
      type: "comment_like",
      category: "content",
      title: `${liker} liked your comment`,
      subtitle: null,
      occurredAt: lk.createdAt.toISOString(),
      actor: lk.member,
      nav: { kind: "post", postId: lk.comment.postId, commentId: lk.commentId },
    });
  }

  for (const bc of blogComments) {
    if (skipActor(bc.member.id)) continue;
    const preview = bc.content.replace(/\s+/g, " ").trim().slice(0, 100);
    items.push({
      id: `blog_comment:${bc.id}`,
      type: "blog_comment",
      category: "content",
      title: `Comment on: ${bc.blog.title}`,
      subtitle: `${memberName(bc.member)}: ${preview}${bc.content.length > 100 ? "…" : ""}`,
      occurredAt: bc.createdAt.toISOString(),
      actor: bc.member,
      nav: { kind: "blog", slug: bc.blog.slug },
    });
  }

  for (const inv of eventInvites) {
    if (skipActor(inv.inviter.id)) continue;
    items.push({
      id: `event_invite:${inv.id}`,
      type: "event_invite",
      category: "events",
      title: "Event invitation",
      subtitle: `${memberName(inv.inviter)} invited you to ${inv.event.title}`,
      occurredAt: inv.createdAt.toISOString(),
      actor: inv.inviter,
      nav: { kind: "event", slug: inv.event.slug },
    });
  }

  for (const g of groupAdminInvites) {
    if (skipActor(g.inviter.id)) continue;
    items.push({
      id: `group_admin_invite:${g.id}`,
      type: "group_admin_invite",
      category: "groups",
      title: "Group co-admin invite",
      subtitle: `${memberName(g.inviter)} invited you to help admin ${g.group.name}`,
      occurredAt: g.createdAt.toISOString(),
      actor: g.inviter,
      nav: { kind: "group", slug: g.group.slug },
    });
  }

  for (const ord of buyerOrders) {
    const label = ord.items[0]?.storeItem?.title ?? "Order";
    items.push({
      id: `order_buyer:${ord.id}`,
      type: "order_purchase",
      category: "commerce",
      title: "Your order",
      subtitle: `${label} · ${orderStatusLine(ord.status)}`,
      occurredAt: ord.createdAt.toISOString(),
      actor: ord.seller,
      nav: { kind: "buyer_order", orderId: ord.id },
    });
  }

  for (const ord of sellerOrders) {
    if (skipActor(ord.buyer.id)) continue;
    const label = ord.items[0]?.storeItem?.title ?? "Order";
    items.push({
      id: `order_seller:${ord.id}`,
      type: "order_sale",
      category: "commerce",
      title: "New sale",
      subtitle: `${memberName(ord.buyer)} · ${label} · ${orderStatusLine(ord.status)}`,
      occurredAt: ord.createdAt.toISOString(),
      actor: ord.buyer,
      nav: { kind: "seller_order", orderId: ord.id },
    });
  }

  for (const off of resaleOffersSeller) {
    if (skipActor(off.buyer.id)) continue;
    const convId = resaleConvIds.get(`${off.storeItemId}\t${off.buyerId}`);
    items.push({
      id: `resale_offer_in:${off.id}`,
      type: "resale_offer_in",
      category: "commerce",
      title: "Offer on your listing",
      subtitle: `${memberName(off.buyer)} on “${off.storeItem.title}”`,
      occurredAt: off.createdAt.toISOString(),
      actor: off.buyer,
      nav: convId ? { kind: "resale_chat", conversationId: convId } : { kind: "seller_orders" },
    });
  }

  for (const off of resaleOffersBuyer) {
    const seller = off.storeItem.member;
    if (skipActor(seller.id)) continue;
    const when = off.respondedAt ?? off.createdAt;
    const statusLabel =
      off.status === "accepted"
        ? "Accepted"
        : off.status === "declined"
          ? "Declined"
          : off.status === "countered"
            ? "Counteroffer"
            : off.status;
    const convId = resaleConvIds.get(`${off.storeItemId}\t${off.buyerId}`);
    items.push({
      id: `resale_offer_out:${off.id}`,
      type: "resale_offer_out",
      category: "commerce",
      title: `Offer ${statusLabel.toLowerCase()}`,
      subtitle: `“${off.storeItem.title}”`,
      occurredAt: when.toISOString(),
      actor: seller,
      nav: convId ? { kind: "resale_chat", conversationId: convId } : { kind: "my_orders" },
    });
  }

  items.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  const seen = new Set<string>();
  const deduped: ActivityFeedItem[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    deduped.push(it);
  }

  return deduped.slice(0, 100);
}
