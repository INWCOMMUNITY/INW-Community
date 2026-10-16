import { describe, expect, it } from "vitest";
import {
  buyerFieldsFromEtsyQuestions,
  buyerResponsesFingerprint,
  etsyPersonalizationWriteBody,
  shouldApplyEtsyPersonalizationInbound,
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

  it("maps a Shop Manager set of text, choices, and a file upload", () => {
    const mapped = buyerFieldsFromEtsyQuestions([
      {
        question_id: 1,
        question_type: "text_input",
        question_text: "Specifics",
        instructions: "Add Last Name, Year, and a Note for your custom cutting board",
        required: true,
        max_allowed_characters: 256,
      },
      {
        question_id: 2,
        question_type: "dropdown",
        question_text: "Font Choice",
        required: true,
        options: [
          { option_id: 10, label: "Romans" },
          { option_id: 11, label: "Calibri" },
          { option_id: 12, label: "Script" },
        ],
      },
      {
        question_id: 3,
        question_type: "unlabeled_upload",
        question_text: "Pet Photo",
        required: true,
        max_allowed_files: 5,
      },
      {
        question_id: 4,
        question_type: "text_input",
        question_text: "Quote",
        required: true,
        max_allowed_characters: 256,
      },
    ]);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.fields.map((field) => field.title)).toEqual([
      "Specifics",
      "Font Choice",
      "Pet Photo",
      "Quote",
    ]);
    expect(mapped.fields[2]).toMatchObject({ kind: "FILE", maxFiles: 5, labelEachFile: false });
  });

  it("keeps every labeled file name, including a repeated label", () => {
    const mapped = buyerFieldsFromEtsyQuestions([
      {
        question_id: 3,
        question_type: "labeled_upload",
        question_text: "Pet Photo",
        instructions: "Make sure its good, at least 30 pixels",
        required: true,
        max_allowed_files: 5,
        options: [
          { option_id: 1, label: "Closeup of Face" },
          { option_id: 2, label: "Dog Pooping" },
          { option_id: 3, label: "Test" },
          { option_id: 4, label: "Test" },
          { option_id: 5, label: "Testies" },
        ],
      },
    ]);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.fields[0]).toMatchObject({ kind: "FILE", labelEachFile: true, maxFiles: 5 });
    expect(mapped.fields[0]?.options.map((option) => option.label)).toEqual([
      "Closeup of Face",
      "Dog Pooping",
      "Test",
      "Test",
      "Testies",
    ]);
  });
});

describe("etsy personalization inbound", () => {
  it("applies an Etsy edit even when some other listing change is still unsynced", () => {
    expect(
      shouldApplyEtsyPersonalizationInbound({
        observed: true,
        mappedOk: true,
        localDirty: false,
        same: false,
      })
    ).toBe(true);
  });

  it("keeps an INW edit that has not been pushed yet", () => {
    expect(
      shouldApplyEtsyPersonalizationInbound({
        observed: true,
        mappedOk: true,
        localDirty: true,
        same: false,
      })
    ).toBe(false);
  });

  it("does not replace local options when Etsy personalization could not be read", () => {
    expect(
      shouldApplyEtsyPersonalizationInbound({
        observed: true,
        mappedOk: false,
        localDirty: false,
        same: false,
      })
    ).toBe(false);
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

  it("accepts a filled text answer when the saved field id changed", () => {
    const result = validateBuyerResponses(fields, [
      { fieldId: "old-id", title: "Specifics", text: "Donivan, 2004" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.responses[0]?.text).toBe("Donivan, 2004");
  });

  it("accepts answers in field order when only the ids are stale", () => {
    const result = validateBuyerResponses(
      [
        fields[0]!,
        {
          id: "color",
          kind: "DROPDOWN",
          title: "Colors",
          instructions: null,
          required: true,
          maxCharacters: null,
          maxFiles: null,
          labelEachFile: false,
          options: [{ id: "red", label: "Red", required: true }],
        },
      ],
      [
        { fieldId: "stale-text", text: "Donivan, 2004" },
        { fieldId: "stale-color", optionLabel: "Red" },
      ]
    );
    expect(result.ok).toBe(true);
  });

  it("lets an optional labeled photo be left out", () => {
    const result = validateBuyerResponses(
      [
        {
          id: "photos",
          kind: "FILE",
          title: "Photos",
          instructions: null,
          required: true,
          maxCharacters: null,
          maxFiles: 2,
          labelEachFile: true,
          options: [
            { id: "dog1", label: "Dog #1", required: true },
            { id: "dog2", label: "Dog #2", required: false },
          ],
        },
      ],
      [
        {
          fieldId: "photos",
          files: [{ url: "https://files.example.com/grrr.jpg", label: "Dog #1", slot: 0 }],
        },
      ]
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.responses[0]?.files).toEqual([
      { url: "https://files.example.com/grrr.jpg", label: "Dog #1" },
    ]);
  });

  it("still requires a labeled photo that is marked required", () => {
    const result = validateBuyerResponses(
      [
        {
          id: "photos",
          kind: "FILE",
          title: "Photos",
          instructions: null,
          required: true,
          maxCharacters: null,
          maxFiles: 2,
          labelEachFile: true,
          options: [
            { id: "dog1", label: "Dog #1", required: true },
            { id: "dog2", label: "Dog #2", required: false },
          ],
        },
      ],
      [{ fieldId: "photos", files: [] }]
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Dog #1 is required.");
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
