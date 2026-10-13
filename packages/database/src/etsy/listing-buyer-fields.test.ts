import { describe, expect, it } from "vitest";
import {
  buyerFieldsFromEtsyQuestions,
  buyerResponsesFingerprint,
  etsyPersonalizationWriteBody,
  splitEtsyReceiptVariations,
  validateBuyerResponses,
  validateListingBuyerFields,
} from "../listing-buyer-fields";

describe("listing buyer field constraints", () => {
  it("rejects a sixth field and a second file upload", () => {
    const five = Array.from({ length: 6 }, (_, i) => ({
      kind: "TEXT" as const,
      title: `Name ${i + 1}`,
      required: true,
      maxCharacters: 40,
    }));
    expect(validateListingBuyerFields(five).ok).toBe(false);

    const twoFiles = validateListingBuyerFields([
      { kind: "FILE", title: "Photo", required: true, maxFiles: 1 },
      { kind: "FILE", title: "Art", required: false, maxFiles: 1 },
    ]);
    expect(twoFiles.ok).toBe(false);
  });

  it("requires labeled uploads to match file count and limits dropdown labels", () => {
    const labeled = validateListingBuyerFields([
      {
        kind: "FILE",
        title: "Pet Photo",
        required: true,
        maxFiles: 2,
        labelEachFile: true,
        options: [{ label: "Front" }],
      },
    ]);
    expect(labeled.ok).toBe(false);

    const longLabel = validateListingBuyerFields([
      {
        kind: "DROPDOWN",
        title: "Font Choice",
        required: true,
        options: [{ label: "This label is way too long" }],
      },
    ]);
    expect(longLabel.ok).toBe(false);
  });

  it("accepts text, dropdown, and one upload together", () => {
    const result = validateListingBuyerFields([
      {
        kind: "TEXT",
        title: "Specifics",
        instructions: "Add last name and year",
        required: true,
        maxCharacters: 256,
      },
      {
        kind: "DROPDOWN",
        title: "Font Choice",
        required: true,
        options: [{ label: "Romans" }, { label: "Calibri" }],
      },
      {
        kind: "FILE",
        title: "Pet Photo",
        instructions: "Here is an example",
        required: true,
        maxFiles: 1,
      },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fields).toHaveLength(3);
  });
});

describe("etsy personalization mapping", () => {
  it("maps text, dropdown, and upload questions and preserves question ids on write", () => {
    const mapped = buyerFieldsFromEtsyQuestions([
      {
        question_id: 11,
        question_type: "text_input",
        question_text: "Specifics",
        instructions: "Add last name",
        required: true,
        max_allowed_characters: 256,
      },
      {
        question_id: 12,
        question_type: "dropdown",
        question_text: "Font Choice",
        required: true,
        options: [
          { option_id: 1, label: "Romans" },
          { option_id: 2, label: "Calibri" },
        ],
      },
      {
        question_id: 13,
        question_type: "unlabeled_upload",
        question_text: "Pet Photo",
        instructions: "Here is an example",
        required: true,
        max_allowed_files: 1,
      },
    ]);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    const body = etsyPersonalizationWriteBody(mapped.fields);
    expect(body.personalization_questions).toHaveLength(3);
    expect(body.personalization_questions[0]).toMatchObject({
      question_id: 11,
      question_type: "text_input",
    });
    expect(body.personalization_questions[1]).toMatchObject({
      question_id: 12,
      question_type: "dropdown",
    });
    expect(body.personalization_questions[2]).toMatchObject({
      question_type: "unlabeled_upload",
      question_id: 13,
    });
  });
});

describe("buyer responses", () => {
  const fields = [
    {
      id: "f1",
      kind: "TEXT" as const,
      title: "Specifics",
      instructions: null,
      required: true,
      maxCharacters: 20,
      maxFiles: null,
      labelEachFile: false,
      options: [],
    },
  ];

  it("rejects a missing required text answer", () => {
    const result = validateBuyerResponses(fields, []);
    expect(result.ok).toBe(false);
  });

  it("keeps different answers on different cart fingerprints", () => {
    const a = validateBuyerResponses(fields, [{ fieldId: "f1", text: "MJB" }]);
    const b = validateBuyerResponses(fields, [{ fieldId: "f1", text: "ANN" }]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(buyerResponsesFingerprint(a.responses)).not.toBe(buyerResponsesFingerprint(b.responses));
  });
});

describe("etsy receipt personalization", () => {
  it("keeps property 54 answers out of inventory options", () => {
    const split = splitEtsyReceiptVariations([
      { property_id: 513, formatted_name: "Size", formatted_value: "Large" },
      {
        property_id: 54,
        question_id: 11,
        formatted_name: "Specifics",
        formatted_value: "MJB",
      },
      {
        property_id: 54,
        question_id: 13,
        formatted_name: "Pet Photo",
        formatted_value: "https://example.com/pet.jpg",
      },
    ]);
    expect(split.inventoryOptions).toEqual({ Size: "Large" });
    expect(split.personalization).toEqual([
      { questionId: "11", name: "Specifics", value: "MJB" },
      { questionId: "13", name: "Pet Photo", value: "https://example.com/pet.jpg" },
    ]);
  });
});
