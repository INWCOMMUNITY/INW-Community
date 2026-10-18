const STEPS = [
  "Account",
  "Business",
  "Name and phone",
  "Subscribe",
  "Shipping",
  "Get paid",
  "Listings",
] as const;

export function OnboardingProgress({ stepIndex, className = "mb-8" }: { stepIndex: number; className?: string }) {
  const current = Math.min(Math.max(stepIndex, 1), STEPS.length);
  const label = STEPS[current - 1];
  const percent = Math.round((current / STEPS.length) * 100);

  return (
    <div className={className} aria-label="Onboarding progress">
      <p className="mb-2 text-sm font-medium" style={{ color: "var(--color-heading)" }}>
        Step {current} of {STEPS.length}
        {label ? (
          <span className="font-normal" style={{ color: "var(--color-earth)" }}>
            {" "}
            · {label}
          </span>
        ) : null}
      </p>
      <div
        className="h-3.5 w-full overflow-hidden rounded-full border"
        style={{ backgroundColor: "var(--color-section-alt)", borderColor: "var(--color-earth)" }}
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={current}
        aria-valuetext={`Step ${current} of ${STEPS.length}: ${label}`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{
            width: `${percent}%`,
            backgroundColor: "var(--color-earth)",
            backgroundImage:
              "repeating-linear-gradient(45deg, var(--color-earth) 0 8px, var(--color-section-alt) 8px 12px)",
          }}
        />
      </div>
    </div>
  );
}
