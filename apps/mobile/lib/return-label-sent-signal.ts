let pending = false;

export function markReturnLabelSent(): void {
  pending = true;
}

export function consumeReturnLabelSent(): boolean {
  const sent = pending;
  pending = false;
  return sent;
}
