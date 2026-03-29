/**
 * Build optional branding_settings for Stripe Checkout sessions.
 * Set STRIPE_CHECKOUT_DISPLAY_NAME, STRIPE_CHECKOUT_BUTTON_COLOR, STRIPE_CHECKOUT_BACKGROUND_COLOR
 * in .env to customize checkout appearance.
 *
 * Hosted Checkout does not expose a dedicated API field for input placeholder text color; contrast is
 * mainly affected by background_color, button_color, font_family, and border_style. For finer control,
 * use Stripe Dashboard → Settings → Branding → Checkout. Embedded Payment Element placeholder color is
 * set separately (e.g. `colorTextPlaceholder` in apps/main storefront checkout page).
 *
 * @see https://docs.stripe.com/payments/checkout/customization/appearance
 */
export function getStripeCheckoutBranding(): {
  display_name?: string;
  button_color?: string;
  background_color?: string;
} | undefined {
  const displayName = process.env.STRIPE_CHECKOUT_DISPLAY_NAME?.trim();
  const buttonColor = process.env.STRIPE_CHECKOUT_BUTTON_COLOR?.trim();
  const backgroundColor = process.env.STRIPE_CHECKOUT_BACKGROUND_COLOR?.trim();

  if (!displayName && !buttonColor && !backgroundColor) return undefined;

  const settings: Record<string, string> = {};
  if (displayName) settings.display_name = displayName;
  if (buttonColor && /^#[0-9A-Fa-f]{6}$/.test(buttonColor)) settings.button_color = buttonColor;
  if (backgroundColor && /^#[0-9A-Fa-f]{6}$/.test(backgroundColor)) settings.background_color = backgroundColor;

  return Object.keys(settings).length > 0 ? settings : undefined;
}
