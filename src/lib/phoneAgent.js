import { sendTelegramMessage } from "./telegram";

const MAX_STEPS = 20;
const STEP_DELAY = 1500; // ms — wait after action for screen to settle

/**
 * Call the bridge server.
 */
async function bridgeCall(bridgeUrl, bridgeSecret, method, path, body) {
  const url = `${bridgeUrl}${path}`;
  const opts = {
    method,
    headers: {
      "x-bridge-secret": bridgeSecret,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bridge ${method} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * Check if the bridge is reachable.
 */
export async function checkBridgeHealth(bridgeUrl) {
  try {
    const res = await fetch(`${bridgeUrl}/health`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

/**
 * Sync installed apps from bridge to user record.
 */
export async function syncApps(bridgeUrl, bridgeSecret) {
  const data = await bridgeCall(bridgeUrl, bridgeSecret, "GET", "/apps");
  return data.apps || [];
}

/**
 * Ask Gemini Vision to decide the next action given a screenshot and task context.
 */
async function askGemini(screenshotBase64, task, stepHistory, screenSize) {
  const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
  const { generateObject } = await import("ai");
  const { z } = await import("zod");

  const google = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });

  const systemPrompt = `You are an Android phone control agent. You can see the phone screen and must decide what action to take to complete the user's task.

Screen resolution: ${screenSize.width}x${screenSize.height}

Available actions:
- tap { x, y } — tap at screen coordinates
- type { text } — type text into the focused field
- swipe { x1, y1, x2, y2, duration } — swipe gesture
- launch { package } — open an app by package name
- back {} — press back button
- home {} — press home button
- scroll { direction: "up"|"down"|"left"|"right" } — scroll the screen

Rules:
- Look at the screenshot carefully to determine what's on screen.
- Provide exact pixel coordinates for taps based on what you see.
- Only perform ONE action per step.
- Set isDone=true when the task is complete, and describe the result.
- Set isDone=true with success=false if the task is impossible or you're stuck.
- Be efficient — take the shortest path to complete the task.`;

  const previousSteps = stepHistory
    .map((s, i) => `Step ${i + 1}: ${s.action}(${JSON.stringify(s.params)}) → ${s.reasoning}`)
    .join("\n");

  const userPrompt = `Task: ${task}

${previousSteps ? `Previous steps:\n${previousSteps}\n\n` : ""}What should I do next? Look at the current screenshot and decide.`;

  const result = await generateObject({
    model: google("gemini-2.5-flash-preview-05-20"),
    schema: z.object({
      reasoning: z.string().describe("Brief explanation of what you see and why you chose this action"),
      action: z.string().describe("The action to take: tap, type, swipe, launch, back, home, scroll"),
      params: z.record(z.any()).describe("Parameters for the action"),
      isDone: z.boolean().describe("Whether the task is now complete"),
      success: z.boolean().describe("Whether the task was completed successfully (only relevant if isDone)"),
      result: z.string().optional().describe("Description of the final result if isDone"),
    }),
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: userPrompt },
          {
            type: "image",
            image: `data:image/png;base64,${screenshotBase64}`,
          },
        ],
      },
    ],
    temperature: 0.2,
  });

  return result.object;
}

/**
 * Run a phone task using the ReAct agent loop.
 *
 * @param {object} opts
 * @param {string} opts.task - Natural language task description
 * @param {string} opts.bridgeUrl - Bridge server URL
 * @param {string} opts.bridgeSecret - Bridge auth secret
 * @param {string[]} opts.allowedApps - Allowed app packages ('*' = all)
 * @param {string|number} opts.chatId - Telegram chat ID for progress updates
 * @returns {Promise<{success: boolean, result?: string, reason?: string, steps: object[]}>}
 */
export async function runPhoneTask({ task, bridgeUrl, bridgeSecret, allowedApps, chatId }) {
  const steps = [];

  // Verify bridge is reachable
  const healthy = await checkBridgeHealth(bridgeUrl);
  if (!healthy) {
    return {
      success: false,
      reason: "Bridge is not reachable. Make sure it's running and connected.",
      steps,
    };
  }

  await sendTelegramMessage(`📱 *Phone Task Started*\n\n_"${task}"_\n\nWorking on it...`, chatId);

  for (let i = 0; i < MAX_STEPS; i++) {
    try {
      // 1. Capture screenshot
      const screenshotData = await bridgeCall(bridgeUrl, bridgeSecret, "GET", "/screenshot");
      const { image, screen } = screenshotData;

      // 2. Ask Gemini what to do
      const decision = await askGemini(image, task, steps, screen);

      // 3. Check app permissions for launch actions
      if (decision.action === "launch" && decision.params?.package) {
        const pkg = decision.params.package;
        if (!allowedApps.includes("*") && !allowedApps.includes(pkg)) {
          await sendTelegramMessage(
            `⛔ Step ${i + 1}: Blocked — app \`${pkg}\` is not in your allowed list.\nUse /apps to manage permissions.`,
            chatId
          );
          return {
            success: false,
            reason: `App ${pkg} is blocked by your permissions.`,
            steps,
          };
        }
      }

      // 4. Check if done
      if (decision.isDone) {
        steps.push({
          step: i + 1,
          action: "done",
          params: {},
          reasoning: decision.reasoning,
          result: decision.result,
        });

        const statusIcon = decision.success ? "✅" : "❌";
        await sendTelegramMessage(
          `${statusIcon} *Task ${decision.success ? "Complete" : "Failed"}* (${i + 1} steps)\n\n${decision.result || decision.reasoning}`,
          chatId
        );

        return {
          success: decision.success,
          result: decision.result || decision.reasoning,
          steps,
        };
      }

      // 5. Execute the action
      const execResult = await bridgeCall(bridgeUrl, bridgeSecret, "POST", "/execute", {
        action: decision.action,
        params: decision.params,
      });

      steps.push({
        step: i + 1,
        action: decision.action,
        params: decision.params,
        reasoning: decision.reasoning,
        execResult: execResult.result,
      });

      // 6. Send progress update every 3 steps
      if ((i + 1) % 3 === 0 || i === 0) {
        await sendTelegramMessage(
          `📱 Step ${i + 1}/${MAX_STEPS}: ${decision.reasoning}`,
          chatId
        );
      }

      // 7. Wait for screen to settle
      await new Promise((r) => setTimeout(r, STEP_DELAY));

    } catch (err) {
      steps.push({
        step: i + 1,
        action: "error",
        params: {},
        reasoning: err.message,
      });

      await sendTelegramMessage(
        `⚠️ Step ${i + 1} error: ${err.message}`,
        chatId
      );

      // Continue trying unless it's a connection error
      if (err.message.includes("Bridge") || err.message.includes("ECONNREFUSED")) {
        return {
          success: false,
          reason: "Lost connection to bridge server.",
          steps,
        };
      }
    }
  }

  // Max steps reached
  await sendTelegramMessage(
    `⚠️ *Task stopped* — reached ${MAX_STEPS} step limit.\n\nPartial progress made. You can run another /phone command to continue.`,
    chatId
  );

  return {
    success: false,
    reason: `Reached maximum ${MAX_STEPS} steps without completing the task.`,
    steps,
  };
}
