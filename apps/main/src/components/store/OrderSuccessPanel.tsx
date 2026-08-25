import Image from "next/image";
import Link from "next/link";

type Props = {
  ordersHref?: string;
  shopHref?: string;
  variant?: "success" | "sold_while_paying";
};

/**
 * Purchase success panel for the website (~80% viewport). Used on order-success return URL.
 */
export function OrderSuccessPanel({
  ordersHref = "/my-community/orders",
  shopHref = "/storefront",
  variant = "success",
}: Props) {
  const soldWhilePaying = variant === "sold_while_paying";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.45)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-success-title"
    >
      <div
        className="flex flex-col items-center justify-between bg-white text-center w-[88vw] max-w-[420px] min-h-[min(80vh,560px)] px-7 pt-9 pb-8"
        style={{
          border: "4px solid #000",
          borderRadius: "4px",
        }}
      >
        <div className="w-full">
          <h1
            id="order-success-title"
            className="font-bold text-black leading-tight mb-2"
            style={{ fontSize: "clamp(1.35rem, 4.5vw, 1.65rem)" }}
          >
            {soldWhilePaying ? "This item sold while you were paying" : "Thanks for Shopping Local!"}
          </h1>
          <p
            className="font-bold text-black leading-tight"
            style={{ fontSize: "clamp(1.15rem, 3.8vw, 1.375rem)" }}
          >
            {soldWhilePaying
              ? "Your payment was refunded. Someone else completed checkout first."
              : "Your order was a success!"}
          </p>
        </div>

        <div className="flex-1 flex items-center justify-center py-6 w-full">
          <Image
            src="/nwc-community-logo.png"
            alt="Northwest Community"
            width={200}
            height={200}
            className="w-[min(52vw,200px)] h-auto"
            priority
          />
        </div>

        <div className="w-full flex flex-col gap-3.5">
          <Link
            href={ordersHref}
            className="block w-full py-4 px-6 rounded-full font-bold text-lg text-black bg-white text-center transition-opacity hover:opacity-90"
            style={{ border: "3px solid #000" }}
          >
            {soldWhilePaying ? "View account" : "View Order"}
          </Link>
          <Link
            href={shopHref}
            className="block w-full py-4 px-6 rounded-full font-bold text-lg text-black bg-white text-center transition-opacity hover:opacity-90"
            style={{ border: "3px solid #000" }}
          >
            Keep Shopping
          </Link>
        </div>
      </div>
    </div>
  );
}
