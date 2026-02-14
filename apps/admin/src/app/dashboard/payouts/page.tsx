export default function AdminPayoutsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Payouts</h1>
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-600 mb-4">
          Payout integrations (e.g. Stripe Connect) will be available in a future phase. All money collected from subscriptions is visible in your Stripe dashboard.
        </p>
        <p className="text-sm text-gray-500">
          Configure Stripe payouts and connect bank accounts in the Stripe Dashboard.
        </p>
      </div>
    </div>
  );
}
