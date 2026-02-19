import Image from "next/image";

export interface GoalSectionProps {
  number: number;
  title: string;
  children: React.ReactNode;
  imageSrc: string;
  imageAlt: string;
  /** Optional background color for the section (e.g. logo tan). */
  sectionBackground?: string;
}

export function GoalSection({ number, title, children, imageSrc, imageAlt, sectionBackground }: GoalSectionProps) {
  const isReversed = number % 2 === 0; // Goal 2, 4, ...: text left, photo right
  return (
    <section
      className="w-full py-8 md:py-12"
      style={{ backgroundColor: sectionBackground ?? "var(--color-section-alt)" }}
    >
      <div className="relative flex flex-col md:flex-row min-h-[320px] md:min-h-[380px] max-w-[var(--max-width)] mx-auto px-2 md:px-3">
        {/* Photo: above white box on mobile; left or right depending on goal number on desktop */}
        <div
          className={`relative w-full md:w-[75%] h-64 md:h-auto md:min-h-[380px] shrink-0 max-md:order-1 ${
            isReversed ? "md:order-2" : "md:order-1"
          }`}
        >
          <Image
            src={imageSrc}
            alt={imageAlt}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 75vw"
            quality={100}
          />
        </div>
        {/* White box: below photo on mobile; overlaps photo on desktop */}
        <div
          className={`relative z-10 w-full md:w-[68%] md:my-8 flex flex-col justify-center max-md:order-2 bg-white rounded shadow-lg p-6 md:p-8 ${
            isReversed ? "md:order-1 md:mr-[-12%]" : "md:order-2 md:ml-[-12%]"
          }`}
          style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
        >
          <h3 className="text-base md:text-xl font-bold mb-4" style={{ color: "var(--color-heading)", fontFamily: "var(--font-heading)" }}>
            Goal {number}: {title}
          </h3>
          <div className="text-gray-700 leading-relaxed">{children}</div>
        </div>
      </div>
    </section>
  );
}
