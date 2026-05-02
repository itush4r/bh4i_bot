import User from "../models/User.js";
import { sendTelegramMessage } from "./telegram.js";
import { isEscapeInput, sendEscapeMessage } from "./flowUtils.js";

const ESCAPE_HINT = "\n\n_Type_ `cancel` _anytime to stop, or_ `skip` _to leave blank._";

const STEPS = [
  {
    field: "expertise",
    prompt:
      "What's this persona's *areas of expertise*? Comma-separated list, max 10.\n\n" +
      "_Example:_ `strategy, fundraising, hiring`",
  },
  {
    field: "experienceYears",
    prompt:
      "How many *years of experience* does this persona have? (number, or `skip`)",
  },
  {
    field: "tone",
    prompt:
      "What *tone* should this persona use? (≤200 chars)\n\n" +
      "_Example:_ `decisive, blunt, data-driven`",
  },
  {
    field: "responseStyle",
    prompt:
      "What *response style* should this persona use? (≤200 chars)\n\n" +
      "_Example:_ `short paragraphs followed by 2-3 bullet points`",
  },
];

async function clearPending(chatId) {
  await User.updateOne(
    { chatId: String(chatId) },
    {
      $set: {
        personaSetupPending: false,
        personaSetupStep:    0,
        personaSetupDraft:   null,
      },
    }
  );
}

export async function startPersonaSetup(user, chatId, draft) {
  await User.updateOne(
    { chatId: String(chatId) },
    {
      $set: {
        personaSetupPending: true,
        personaSetupStep:    0,
        personaSetupDraft:   draft,
      },
    }
  );
  await sendTelegramMessage(
    `🎭 Creating persona *${draft.displayName}* (\`${draft.id}\`).\n\n` +
    `Step 1 of ${STEPS.length}: ${STEPS[0].prompt}` +
    ESCAPE_HINT,
    chatId
  );
}

export async function handlePersonaSetup(user, text, chatId) {
  if (isEscapeInput(text)) {
    await clearPending(chatId);
    await sendEscapeMessage(chatId, "personaSetup");
    return;
  }

  const step  = user.personaSetupStep || 0;
  const draft = { ...(user.personaSetupDraft || {}) };
  const stepDef = STEPS[step];
  if (!stepDef) {
    await clearPending(chatId);
    await sendTelegramMessage(
      "❌ Persona setup got into an unexpected state. Cancelled.\n\n" +
      "_Example:_ `/persona create my-coach | Sales Coach | VP Sales` to retry.",
      chatId
    );
    return;
  }

  const skip = text.trim().toLowerCase() === "skip";

  if (stepDef.field === "expertise") {
    if (!skip) {
      const items = text.split(",").map((s) => s.trim()).filter(Boolean);
      if (items.length > 10) {
        await sendTelegramMessage("❌ Max 10 expertise items. Try again:", chatId);
        return;
      }
      if (items.some((i) => i.length > 50)) {
        await sendTelegramMessage("❌ Each expertise item must be ≤50 chars. Try again:", chatId);
        return;
      }
      draft.expertise = items;
    }
  }

  if (stepDef.field === "experienceYears") {
    if (!skip) {
      const n = parseInt(text.trim(), 10);
      if (Number.isNaN(n) || n < 0 || n > 80) {
        await sendTelegramMessage("❌ Enter a number between 0 and 80, or `skip`:", chatId);
        return;
      }
      draft.experienceYears = n;
    }
  }

  if (stepDef.field === "tone") {
    if (!skip) {
      const v = text.trim();
      if (v.length > 200) {
        await sendTelegramMessage("❌ Tone must be ≤200 chars. Try again:", chatId);
        return;
      }
      draft.tone = v;
    }
  }

  if (stepDef.field === "responseStyle") {
    if (!skip) {
      const v = text.trim();
      if (v.length > 200) {
        await sendTelegramMessage("❌ Response style must be ≤200 chars. Try again:", chatId);
        return;
      }
      draft.responseStyle = v;
    }
  }

  // Advance or commit
  if (step + 1 < STEPS.length) {
    await User.updateOne(
      { chatId: String(chatId) },
      { $set: { personaSetupStep: step + 1, personaSetupDraft: draft } }
    );
    const nextStep = STEPS[step + 1];
    await sendTelegramMessage(
      `Step ${step + 2} of ${STEPS.length}: ${nextStep.prompt}` + ESCAPE_HINT,
      chatId
    );
    return;
  }

  // Commit — re-fetch fresh user to avoid clobbering parallel writes
  const fresh = await User.findOne({ chatId: String(chatId) });
  if (!fresh) {
    await clearPending(chatId);
    await sendTelegramMessage("❌ Couldn't find your account.", chatId);
    return;
  }

  if ((fresh.personas || []).length >= 10) {
    await clearPending(chatId);
    await sendTelegramMessage(
      "❌ You've hit the *10 custom persona* cap. Delete one with `/persona delete <id>` and try again.",
      chatId
    );
    return;
  }

  // Re-check id uniqueness in case another flow created the same id mid-setup
  if ((fresh.personas || []).some((p) => p.id === draft.id)) {
    await clearPending(chatId);
    await sendTelegramMessage(
      `❌ A persona with id \`${draft.id}\` already exists. Use a different id.`,
      chatId
    );
    return;
  }

  const newPersona = {
    id:              draft.id,
    displayName:     draft.displayName,
    role:            draft.role,
    expertise:       draft.expertise || [],
    experienceYears: draft.experienceYears ?? null,
    industry:        draft.industry || null,
    tone:            draft.tone || null,
    responseStyle:   draft.responseStyle || null,
    isBuiltIn:       false,
    createdAt:       new Date(),
  };

  await User.updateOne(
    { chatId: String(chatId) },
    {
      $push: { personas: newPersona },
      $set: {
        personaSetupPending: false,
        personaSetupStep:    0,
        personaSetupDraft:   null,
      },
    }
  );

  await sendTelegramMessage(
    `✅ Persona *${draft.displayName}* (\`${draft.id}\`) created.\n\n` +
    `To activate: \`/persona use ${draft.id}\`\n` +
    `To view all personas: \`/personas\``,
    chatId
  );
}
