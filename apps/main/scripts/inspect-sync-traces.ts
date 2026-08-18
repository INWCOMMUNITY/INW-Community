import { prisma } from "database";

async function main() {
  const traces = await prisma.syncTrace.findMany({
    where: { provider: "ebay" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      status: true,
      errorMessage: true,
      rootCause: true,
      storeItemId: true,
      categoryId: true,
      sku: true,
      validationResult: true,
      transformTrace: true,
      inputSnapshot: true,
      requestPayload: true,
      createdAt: true,
    },
  });

  for (const t of traces) {
    console.log("=== TRACE", t.id, t.status, t.createdAt.toISOString(), "===");
    console.log("storeItemId:", t.storeItemId, "sku:", t.sku, "categoryId:", t.categoryId);
    console.log("errorMessage:", t.errorMessage);
    console.log("rootCause:", t.rootCause);
    const inputAspects = t.inputSnapshot?.aspects;
    const afterAspects = t.transformTrace?.after?.aspects;
    const reqAspects = (t.requestPayload as { product?: { aspects?: Record<string, unknown> } } | null)
      ?.product?.aspects;
    console.log("input aspects count:", Array.isArray(inputAspects) ? inputAspects.length : "none");
    if (Array.isArray(inputAspects)) {
      console.log(
        "input Year:",
        inputAspects.find((a) => String((a as { name?: string }).name).toLowerCase().includes("year"))
      );
    }
    console.log("after aspects count:", Array.isArray(afterAspects) ? afterAspects.length : "none");
    if (Array.isArray(afterAspects)) {
      console.log(
        "after Year:",
        afterAspects.find((a) => String((a as { name?: string }).name).toLowerCase().includes("year"))
      );
    }
    console.log("request aspects keys:", reqAspects ? Object.keys(reqAspects) : "none");
    if (reqAspects) {
      console.log("request Year:", reqAspects.Year ?? reqAspects["Year of Issue"] ?? "MISSING");
    }
    const val = t.validationResult as {
      checks?: { name: string; passed: boolean; detail?: string }[];
    } | null;
    if (val?.checks) {
      console.log(
        "validation failed checks:",
        val.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`)
      );
    }
    console.log("");
  }

  if (traces[0]?.storeItemId) {
    const item = await prisma.storeItem.findUnique({
      where: { id: traces[0].storeItemId },
      select: { id: true, title: true, ebayCategoryId: true, aspects: true },
    });
    console.log("=== STORE ITEM", item?.id, "===");
    console.log("title:", item?.title);
    console.log("ebayCategoryId:", item?.ebayCategoryId);
    console.log("aspects:", JSON.stringify(item?.aspects, null, 2));
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
