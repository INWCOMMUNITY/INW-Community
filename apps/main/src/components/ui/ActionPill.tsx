"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { IonIcon } from "@/components/IonIcon";

export type ActionPillVariant = "primary" | "outline" | "ghost";
export type ActionPillSize = "sm" | "md" | "lg";

export interface ActionPillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ActionPillVariant;
  size?: ActionPillSize;
  icon?: string;
  iconPosition?: "left" | "right";
  loading?: boolean;
  children?: ReactNode;
}

const sizeClasses: Record<ActionPillSize, string> = {
  sm: "px-3 py-1.5 text-xs gap-1",
  md: "px-4 py-2 text-sm gap-1.5",
  lg: "px-5 py-2.5 text-base gap-2",
};

const iconSizes: Record<ActionPillSize, number> = {
  sm: 14,
  md: 16,
  lg: 18,
};

const variantClasses: Record<ActionPillVariant, string> = {
  primary:
    "bg-[var(--color-primary)] text-white border-[1.5px] border-[var(--color-primary)] hover:bg-[#3E432F] hover:border-[#3E432F]",
  outline:
    "bg-white text-[var(--color-primary)] border-[1.5px] border-[var(--color-primary)] hover:bg-[#F8F8F3]",
  ghost:
    "bg-transparent text-[var(--color-primary)] border-[1.5px] border-transparent hover:bg-[#F8F8F3]",
};

export const ActionPill = forwardRef<HTMLButtonElement, ActionPillProps>(
  (
    {
      variant = "primary",
      size = "md",
      icon,
      iconPosition = "left",
      loading = false,
      disabled,
      className = "",
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        type="button"
        disabled={isDisabled}
        className={`
          inline-flex items-center justify-center
          rounded-full font-semibold
          transition-colors duration-150
          ${sizeClasses[size]}
          ${variantClasses[variant]}
          ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}
          ${className}
        `.trim()}
        {...props}
      >
        {loading ? (
          <span className="animate-spin">
            <IonIcon name="sync-outline" size={iconSizes[size]} />
          </span>
        ) : (
          <>
            {icon && iconPosition === "left" && (
              <IonIcon name={icon} size={iconSizes[size]} />
            )}
            {children}
            {icon && iconPosition === "right" && (
              <IonIcon name={icon} size={iconSizes[size]} />
            )}
          </>
        )}
      </button>
    );
  }
);

ActionPill.displayName = "ActionPill";

/** Link variant of ActionPill - for use with Next.js Link */
export interface ActionPillLinkProps {
  variant?: ActionPillVariant;
  size?: ActionPillSize;
  icon?: string;
  iconPosition?: "left" | "right";
  className?: string;
  children?: ReactNode;
}

export function getActionPillLinkClasses({
  variant = "primary",
  size = "md",
  className = "",
}: Pick<ActionPillLinkProps, "variant" | "size" | "className">): string {
  return `
    inline-flex items-center justify-center
    rounded-full font-semibold
    transition-colors duration-150
    ${sizeClasses[size]}
    ${variantClasses[variant]}
    ${className}
  `.trim();
}
