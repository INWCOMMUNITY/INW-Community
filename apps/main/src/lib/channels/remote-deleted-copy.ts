import { CHANNEL_PROVIDER_LABELS } from "./provider-ui";

export function formatRemoteDeletedMessage(args: {
  deletedProvider: string;
  otherProviders: string[];
}): { headline: string; body: string } {
  const deleted = CHANNEL_PROVIDER_LABELS[args.deletedProvider] ?? args.deletedProvider;
  const others = args.otherProviders.map((p) => CHANNEL_PROVIDER_LABELS[p] ?? p);
  const headline = `This listing was deleted on ${deleted}.`;
  if (others.length === 0) {
    return {
      headline,
      body: "Delete it on INW too, or keep it listed here.",
    };
  }
  const also =
    others.length === 1 ? others[0]! : `${others.slice(0, -1).join(", ")} and ${others[others.length - 1]}`;
  return {
    headline,
    body: `Delete it on INW and ${also} too, or keep those listings up.`,
  };
}
