export class ConcurrentModificationError extends Error {
  constructor(storeItemId: string) {
    super(`Concurrent modification detected for StoreItem ${storeItemId}`);
    this.name = "ConcurrentModificationError";
  }
}

export class InsufficientStockError extends Error {
  constructor(
    public readonly storeItemId: string,
    public readonly requested: number,
    public readonly available: number
  ) {
    super(
      `Insufficient stock for StoreItem ${storeItemId}: requested ${requested}, available ${available}`
    );
    this.name = "InsufficientStockError";
  }
}
