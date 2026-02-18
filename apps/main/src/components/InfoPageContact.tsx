import { WIX_IMG, CONTACT_SECTION_PHOTO } from "@/lib/wix-media";

const TAN_BG = "#F5E9CE";

export function InfoPageContact() {
  return (
    <section
      className="w-full py-10 md:py-14 px-6 md:px-12 flex justify-center items-center border-t-4 border-b-4"
      style={{ backgroundColor: TAN_BG, borderColor: "var(--color-primary)" }}
    >
      {/* Centered: white box + 1:1 photo (1.5x size), no gap */}
      <div className="w-full max-w-[84rem] flex flex-col md:flex-row md:items-stretch overflow-hidden rounded-lg shadow-lg min-h-[480px] md:min-h-0">
        {/* White box – flex, same height as square photo */}
        <div className="w-full md:flex-1 flex items-stretch">
          <div className="w-full bg-white p-10 md:p-14 text-left flex flex-col justify-center">
            <h3 className="font-semibold text-xl mb-2" style={{ color: "var(--color-heading)" }}>
              Not sure yet?
            </h3>
            <p className="text-sm mb-3 opacity-80 leading-relaxed">
              My name is Donivan, a real person! If you have any questions or prefer personal business, by all means give me a call! I am happy to connect with any business owners looking to sponsor Northwest Community or those who may just have questions. Thanks!
            </p>
            <p className="font-medium mb-1">208-819-0268</p>
            <a href="mailto:donivan@inwcommunity.com" className="hover:underline text-sm block" style={{ color: "var(--color-link)" }}>
              donivan@inwcommunity.com
            </a>
          </div>
        </div>
        {/* Photo – 1:1 square next to box (480px = 1.5×320), photo fills square */}
        <div className="w-full aspect-square max-w-[480px] md:w-[480px] md:max-w-none flex-shrink-0 relative overflow-hidden mx-auto md:mx-0">
          <img
            src={WIX_IMG(CONTACT_SECTION_PHOTO)}
            alt="Donivan with dog"
            className="absolute inset-0 w-full h-full object-cover object-center"
          />
        </div>
      </div>
    </section>
  );
}
