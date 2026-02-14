export interface BenefitSection {
  title: string;
  description: string;
  /** Optional image src; when not provided, a placeholder is shown */
  imageSrc?: string;
  imageAlt?: string;
}

export interface InfoPageBenefitSectionsProps {
  benefits: BenefitSection[];
}

export function InfoPageBenefitSections({ benefits }: InfoPageBenefitSectionsProps) {
  return (
    <div className="w-full">
      {benefits.map((benefit, i) => {
        const photoLeft = i % 2 === 0; // Odd sections: photo left, box right; Even sections: box left, photo right
        return (
          <section
            key={i}
            className={`relative min-h-[330px] md:h-[500px] border-2 border-[var(--color-primary)] ${photoLeft ? "md:flex" : "md:flex md:flex-row-reverse"}`}
            style={{ backgroundColor: "#e5e3de" }}
          >
            {/* Photo: mobile = full bleed background; desktop = 50% side-by-side */}
            {benefit.imageSrc ? (
              <div
                className={`absolute inset-0 md:static md:inset-auto md:w-1/2 md:h-full md:shrink-0 md:flex-shrink-0 md:border-[var(--color-primary)] ${photoLeft ? "md:border-r-2" : "md:border-l-2"}`}
              >
                <img
                  src={benefit.imageSrc}
                  alt={benefit.imageAlt ?? benefit.title}
                  className="w-full h-full object-cover min-h-[330px] md:min-h-0 md:h-full"
                />
              </div>
            ) : null}
            {/* White box: mobile = centered overlay; desktop = 50% solid white, centered content */}
            <div
              className="absolute left-[20%] top-[20%] w-[60%] h-[60%] md:static md:left-auto md:top-auto md:right-auto md:bottom-auto md:w-1/2 md:h-full md:flex-1 flex flex-col justify-center items-center p-4 md:p-[2.5in] text-center overflow-hidden rounded-lg md:rounded-none bg-white/70 md:bg-white"
            >
              <h3
                className="text-sm md:text-xl font-bold mb-2 text-gray-900 w-full"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {benefit.title}
              </h3>
              <hr className="border-t-2 my-2 w-full shrink-0 border-gray-700" />
              <p className="opacity-90 leading-relaxed text-sm md:text-base text-gray-900">
                {benefit.description}
              </p>
            </div>
          </section>
        );
      })}
    </div>
  );
}
