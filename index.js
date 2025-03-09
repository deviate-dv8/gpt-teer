import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AnonymizeUAPlugin from "puppeteer-extra-plugin-anonymize-ua";
import UserAgent from "user-agents";
import dotenv from "dotenv";
import express from "express";
import process from "process";
import fs from "fs";

dotenv.config();

const stealth = StealthPlugin();
const anonymize = AnonymizeUAPlugin();

puppeteer.use(stealth);
puppeteer.use(anonymize);

const INACTIVITY_TIMEOUT =
  (process.env.INACTIVITY_TIMEOUT_MINUTE
    ? parseInt(process.env.INACTIVITY_TIMEOUT_MINUTE)
    : 3) *
  60 *
  1000;
let browser = null;
const conversations = {};
const requestQueues = {};
let numErr = 0;
let stopFetching = false;

function signalHandler(signal) {
  console.log(`Received ${signal}. Initiating graceful shutdown...`);
  cleanupBeforeExit()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error("Error during cleanup:", err);
      process.exit(1);
    });
}

// Handle SIGINT signals for Ctrl+C
process.on("SIGINT", signalHandler);

// Handle custom signal (e.g., SIGUSR1) from frunner.sh
process.on("SIGUSR1", signalHandler); // Found out that OS kills some of the process because of false positive during initialization (beacuse cpu usage goes for 100% for a few seconds)

async function browserInit() {
  try {
    if (!browser) {
      console.log(
        `Launching ${browserType == "chrome" ? "Chromium" : "Firefox"}`
      );
      browser = await puppeteer.launch({
        headless,
        browser: browserType,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        // pipe: true,
      });
      // Removed tab closing code
    }
  } catch {
    numErr++;
    await handleGlobalError();
    console.log("Failed to launch re-run browser");
    browserInit();
  }
}

const MAX_RETRIES = 10;

async function puppeteerInit(chatId, retries = 0) {
  if (stopFetching) return;

  try {
    if (conversations[chatId] && conversations[chatId].page) {
      console.log(`Reusing existing page for chat ${chatId}`);
      return;
    }

    // Removed closeExtraTabs call

    console.log(`Creating new page for chat ${chatId}`);
    const page = await browser.newPage();

    // Clear cookies and other browsing data
    const client = await page.target().createCDPSession();
    await client.send("Network.clearBrowserCookies");
    await client.send("Network.clearBrowserCache");

    // Randomize user agent
    const userAgent = new UserAgent({ deviceCategory: "desktop" });
    const randomUserAgent = userAgent.toString();
    console.log(`Using user agent: ${randomUserAgent}`);
    await page.setUserAgent(randomUserAgent);

    // Randomize viewport size
    const width = Math.floor(Math.random() * (1920 - 800 + 1)) + 800;
    const height = Math.floor(Math.random() * (1080 - 600 + 1)) + 600;
    await page.setViewport({ width, height });

    // Randomize screen size
    await page.evaluateOnNewDocument(
      (width, height) => {
        window.screen = {
          width: width,
          height: height,
          availWidth: width,
          availHeight: height,
          colorDepth: Math.floor(Math.random() * 24) + 1,
          pixelDepth: Math.floor(Math.random() * 24) + 1,
        };
      },
      width,
      height
    );

    // Randomize navigator properties
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "platform", {
        get: () =>
          ["Win32", "MacIntel", "Linux x86_64"][Math.floor(Math.random() * 3)],
      });
      Object.defineProperty(navigator, "language", {
        get: () =>
          [
            "en-US",
            "en-GB",
            //  "fr-FR", "de-DE"
          ][Math.floor(Math.random() * 4)],
      });
      Object.defineProperty(navigator, "languages", {
        get: () =>
          [
            ["en-US", "en"],
            ["en-GB", "en"],
            ["fr-FR", "en"],
            ["de-DE", "en"],
            ["es-ES", "en"],
            ["it-IT", "en"],
            ["nl-NL", "en"],
            ["pt-PT", "en"],
            ["ru-RU", "en"],
            ["zh-CN", "en"],
          ][Math.floor(Math.random() * 10)],
      });
      Object.defineProperty(navigator, "vendor", {
        get: () =>
          ["Google Inc.", "Apple Computer, Inc.", "Mozilla Foundation"][
            Math.floor(Math.random() * 3)
          ],
      });
      Object.defineProperty(navigator, "product", {
        get: () => ["Gecko", "WebKit", "Blink"][Math.floor(Math.random() * 3)],
      });
      Object.defineProperty(navigator, "appVersion", {
        get: () =>
          `5.0 (${navigator.platform}) AppleWebKit/${
            Math.floor(Math.random() * 600) + 500
          }.0 (KHTML, like Gecko) Chrome/${
            Math.floor(Math.random() * 100) + 50
          }.0.${Math.floor(Math.random() * 4000) + 1000}.0 Safari/${
            Math.floor(Math.random() * 600) + 500
          }.0`,
      });
      Object.defineProperty(navigator, "webdriver", {
        get: () => false,
      });
      Object.defineProperty(navigator, "hardwareConcurrency", {
        get: () => Math.floor(Math.random() * 8) + 1,
      });
      Object.defineProperty(navigator, "deviceMemory", {
        get: () => Math.floor(Math.random() * 8) + 1,
      });
    });

    // Set geolocation
    // await page.setGeolocation({
    //   latitude: parseFloat((Math.random() * 180 - 90).toFixed(6)),
    //   longitude: parseFloat((Math.random() * 360 - 180).toFixed(6)),
    //   accuracy: parseFloat((Math.random() * 100).toFixed(2)),
    // });

    // Randomize timezone
    // const timezones = [
    //   "America/New_York",
    //   "Europe/London",
    //   "Asia/Tokyo",
    //   "Australia/Sydney",
    //   "America/Los_Angeles",
    //   "Europe/Berlin",
    //   "Asia/Shanghai",
    //   "America/Chicago",
    //   "Europe/Paris",
    //   "Asia/Singapore",
    //   "Africa/Johannesburg",
    //   "America/Sao_Paulo",
    //   "Asia/Dubai",
    //   "Asia/Kolkata",
    //   "Pacific/Auckland",
    // ];
    // const timezone = timezones[Math.floor(Math.random() * timezones.length)];
    // await page.emulateTimezone(timezone);

    // Randomize WebGL properties
    await page.evaluateOnNewDocument(() => {
      const vendors = ["Intel Inc.", "NVIDIA Corporation", "AMD Inc."];
      const renderers = [
        "Intel Iris OpenGL Engine",
        "NVIDIA GeForce GTX",
        "AMD Radeon Pro",
      ];

      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (parameter) {
        if (parameter === 37445)
          return vendors[Math.floor(Math.random() * vendors.length)]; // UNMASKED_VENDOR_WEBGL
        if (parameter === 37446)
          return renderers[Math.floor(Math.random() * renderers.length)]; // UNMASKED_RENDERER_WEBGL
        return getParameter(parameter);
      };
    });
    // Randomize media devices
    await page.evaluateOnNewDocument(() => {
      const mediaDevices = [
        { label: "External Webcam", kind: "videoinput" },
        { label: "Built-in Microphone", kind: "audioinput" },
        { label: "Virtual Microphone", kind: "audioinput" },
        { label: "Screen Capture", kind: "videoinput" },
      ];

      navigator.mediaDevices.enumerateDevices = async () =>
        mediaDevices.map((device) => ({
          deviceId: Math.random().toString(36).substr(2, 10),
          label: device.label,
          kind: device.kind,
          groupId: Math.random().toString(36).substr(2, 10),
        }));
    });
    // Clear browser cache
    await page._client().send("Network.clearBrowserCache");
    // Set the Referer header
    await page.setExtraHTTPHeaders({
      Referer: "https://www.chatgpt.com",
    });
    await page.goto("https://www.chatgpt.com").catch(async (err) => {
      console.log("Re Run");
      await page.close();
      if (retries < MAX_RETRIES) {
        return await puppeteerInit(chatId, retries + 1);
      } else {
        throw new Error("Max retries reached");
      }
    });
    // Add key-value pair to session storage
    await page.evaluate(() => {
      sessionStorage.setItem(
        "oai/apps/noAuthHasDismissedSoftRateLimitModal",
        "true"
      );
    });
    await stayLoggedOut(page);

    const checkContent = await page.$("text=" + "Get started");
    if (checkContent) {
      console.log("Re run");
      await page.close();
      if (retries < MAX_RETRIES) {
        return await puppeteerInit(chatId, retries + 1);
      } else {
        throw new Error("Max retries reached");
      }
    }
    const checkContent2 = await page.$("text=" + "Welcome back");
    if (checkContent2) {
      console.log("Re run");
      await page.close();
      if (retries < MAX_RETRIES) {
        return await puppeteerInit(chatId, retries + 1);
      } else {
        throw new Error("Max retries reached");
      }
    }

    conversations[chatId] = {
      page,
      conversation: 1,
      conversationNo: 0,
      ready: true,
      lastActivity: Date.now(),
      timeout: setTimeout(() => {
        closeChatSession(chatId);
      }, INACTIVITY_TIMEOUT),
    };

    // Bring page to front regardless of screenshot setting
    await page.bringToFront();

    if (screenshot) {
      ensureScreenshotsDir();
      await page.screenshot({
        path: `screenshots/init-${chatId}.png`,
      });
      console.log(`screenshots/init-${chatId}.png`);
    }
    requestQueues[chatId] = Promise.resolve();
    console.log(`Page is ready for chat ${chatId}`);
  } catch (error) {
    numErr++;
    await handleGlobalError();

    // Removed closeExtraTabs call

    if (retries < MAX_RETRIES) {
      console.log(
        `Retrying puppeteerInit for chat ${chatId}, attempt ${retries + 1}`
      );
      return puppeteerInit(chatId, retries + 1);
    } else {
      console.error(`Max retries reached for chat ${chatId}:`, error);
    }
  }
}

async function closeChatSession(chatId) {
  if (conversations[chatId]) {
    console.log(`Closing chat session ${chatId} due to inactivity`);
    try {
      await conversations[chatId].page.close();
    } catch (error) {
      console.error(`Error closing page for chat ${chatId}:`, error);
    }
    delete conversations[chatId];
    delete requestQueues[chatId];

    // Removed closeExtraTabs call
  }
}

const sequentialMiddleware = (req, res, next) => {
  const chatId = req.body.chatId;
  if (!chatId) {
    return res.status(400).json({ message: "Chat ID is required" });
  }

  const entry = { req, res, next, disconnected: false };

  if (!requestQueues[chatId]) {
    requestQueues[chatId] = Promise.resolve();
  }

  requestQueues[chatId] = requestQueues[chatId].then(() =>
    processRequest(entry)
  );

  res.on("close", () => {
    console.log(`Client disconnected from chat ${chatId}`);
    entry.disconnected = true;
  });
};

const processRequest = ({ req, res, next, disconnected }) => {
  return new Promise((resolve) => {
    let closeCalled = false;
    let finished = false;
    let checkFinishInterval;

    const done = () => {
      clearInterval(checkFinishInterval);
      resolve();
    };

    const finishHandler = () => {
      finished = true;
      if (closeCalled) {
        done();
      }
    };

    const closeHandler = () => {
      closeCalled = true;
      if (!finished) {
        checkFinishInterval = setInterval(() => {
          if (res.writableFinished) {
            finishHandler();
          }
        }, 50);
      } else {
        done();
      }
    };

    res.on("finish", finishHandler);
    res.on("close", closeHandler);

    if (!disconnected) {
      next();
    } else {
      done();
    }
  });
};

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/screenshots", express.static("screenshots"));
app.get("/", (req, res) => {
  res.json({
    message: "Welcome to ChatGPT API Playwright reverse proxy by Deviate",
  });
});

app.post("/start", async (req, res) => {
  const chatId = generateUniqueChatId();
  await puppeteerInit(chatId);
  res.json({ chatId });
});

app.post("/conversation", sequentialMiddleware, async (req, res) => {
  const { chatId, prompt } = req.body;
  if (!chatId || !prompt) {
    return res.status(400).json({ message: "Chat ID and prompt are required" });
  }
  const chatSession = conversations[chatId];
  if (!chatSession) {
    return res.status(404).json({ message: "Chat session not found" });
  }
  chatSession.lastActivity = Date.now();
  clearTimeout(chatSession.timeout);
  chatSession.timeout = setTimeout(() => {
    closeChatSession(chatId);
  }, INACTIVITY_TIMEOUT);
  const promptResult = await scrapeAndAutomateChat(chatId, prompt.toString());
  if (
    promptResult.message ||
    prompt ==
      "You've reached our limit of messages per hour. Please try again later."
  ) {
    closeChatSession(chatId);
    return res.status(429).json({
      message: promptResult.message ? promptResult.message : promptResult,
    });
  }
  return res.json({ response: promptResult });
});

async function stayLoggedOut(page) {
  try {
    // Wait for the link with text "Stay logged out" to be visible
    await page.waitForSelector('a[href="#"]', {
      visible: true,
      timeout: 5000,
    });

    // Click the link
    await page.click('a[href="#"]');

    console.log('Successfully clicked "Stay logged out"');
  } catch (error) {
    // console.error(
    //   'No "Stay logged out" link found or other error occurred:',
    //   error
    // );
  }
}

async function lazyLoadingFix(page, conversation) {
  let text = await page
    .getByTestId(`conversation-turn-${conversation}`)
    .innerText();
  if (!preprocessText(text)) {
    return lazyLoadingFix(page, conversation);
  }
  return text;
}

function preprocessText(text) {
  text = text.replace("ChatGPT said:\n\n", "");
  text = text.replace("ChatGPT said:\n", "");
  text = text.replace("ChatGPT said:", "");
  text = text.replace("ChatGPT\n\n", "");
  text = text.replace("ChatGPT\n", "");
  text = text.replace("\n\n4o mini", "");
  text = text.replace("\n4o mini", "");
  text = text.replace("4o mini", "");
  return text.trim();
}

async function scrapeAndAutomateChat(chatId, prompt) {
  try {
    if (prompt.length > 4096) {
      prompt = prompt.substring(0, 4096);
    }
    console.log(`Processing prompt for chat ${chatId}: \n`, prompt);
    const chatSession = conversations[chatId];
    let { page } = chatSession;

    chatSession.conversationNo++;
    console.log(chatSession.conversationNo);
    if (chatSession.conversationNo == 20) {
      await closeChatSession(chatId);
      return "You've reached our limit of messages per hour. Please try again later.";
    }
    await stayLoggedOut(page);

    // Bring page to front regardless of screenshot setting
    await page.bringToFront();

    if (screenshot) {
      ensureScreenshotsDir();
      await page.screenshot({
        path: `screenshots/1before-writing-${chatId}.png`,
      });
      console.log(`screenshots/1before-writing-${chatId}.png`);
    }
    await page.type("#prompt-textarea", prompt, {
      timeout: process.env.WAIT_TIMEOUT
        ? parseInt(process.env.WAIT_TIMEOUT)
        : 60000,
    });

    // Bring page to front before clicking
    await page.bringToFront();

    if (screenshot) {
      ensureScreenshotsDir();
      await page.screenshot({
        path: `screenshots/2writing-before-clicking-${chatId}.png`,
      });
      console.log(`screenshots/2writing-before-clicking-${chatId}.png`);
    }
    // Wait for the send button to be present in the DOM
    await page.waitForSelector('[data-testid="send-button"]:not([disabled])', {
      timeout: process.env.WAIT_TIMEOUT
        ? parseInt(process.env.WAIT_TIMEOUT)
        : 60000,
    });

    // Bring page to front before clicking
    await page.bringToFront();

    // Then click the button
    await page.click('button[aria-label="Send prompt"]', {
      timeout: process.env.WAIT_TIMEOUT
        ? parseInt(process.env.WAIT_TIMEOUT)
        : 60000,
    });
    if (screenshot) {
      ensureScreenshotsDir();
      await page.screenshot({
        path: `screenshots/3after-clicking-${chatId}.png`,
      });
      console.log(`screenshots/3after-clicking-${chatId}.png`);
    }
    // Waits for the button to change logo
    await page.waitForSelector('button[aria-label="Stop streaming"]', {
      timeout: process.env.WAIT_TIMEOUT
        ? parseInt(process.env.WAIT_TIMEOUT)
        : 60000,
    });
    // Waits for the button logo to change back
    await page.waitForSelector('button[aria-label="Stop streaming"]', {
      hidden: true,
      timeout: process.env.WAIT_TIMEOUT
        ? parseInt(process.env.WAIT_TIMEOUT)
        : 60000,
    });

    // Waits for the response to be generated
    await page.waitForSelector(".result-thinking", {
      hidden: true,
      timeout: process.env.WAIT_TIMEOUT
        ? parseInt(process.env.WAIT_TIMEOUT)
        : 300000,
    });
    await page.waitForSelector(".result-streaming", {
      hidden: true,
      timeout: process.env.WAIT_TIMEOUT
        ? parseInt(process.env.WAIT_TIMEOUT)
        : 300000,
    });

    const limitCheck = await page.$(
      'text="You\'ve reached our limit of messages per hour. Please try again later."'
    );
    if (limitCheck) {
      await closeChatSession(chatId);
      return "You've reached our limit of messages per hour. Please try again later.";
    }
    const limitCheck2 = await page.$(
      'text="Something went wrong while generating the response. If this issue persists please contact us through our help center at help.openai.com."'
    );
    if (limitCheck2) {
      await closeChatSession(chatId);
      return "You've reached our limit of messages per hour. Please try again later.";
    }
    const limitCheck3 = await page.$(
      'text="A network error occurred. Please check your connection and try again. If this issue persists please contact us through our help center at help.openai.com."'
    );
    if (limitCheck3) {
      await closeChatSession(chatId);
      return "You've reached our limit of messages per hour. Please try again later.";
    }

    // Bring page to front before checking response
    await page.bringToFront();

    if (screenshot) {
      ensureScreenshotsDir();
      await page.screenshot({
        path: `screenshots/4after-streaming-${chatId}.png`,
      });
      console.log(`screenshots/4after-streaming-${chatId}.png`);
    }
    chatSession.conversation += 2;
    if (chatSession.conversation == 3) {
      let text1 = await page.evaluate(
        (el) => el.innerText,
        await page.$('[data-testid="conversation-turn-2"]')
      );
      let parsedText1 = text1.replace("ChatGPT\n\n", "").trim();
      if (
        parsedText1.includes(
          "Something went wrong while generating the response. If this issue persists please contact us through our help center at help.openai.com."
        )
      ) {
        await closeChatSession(chatId);
      }
    }

    let text = await page.evaluate(
      (el) => el.innerText,
      await page.$(
        `[data-testid="conversation-turn-${chatSession.conversation}"]`
      )
    );
    await setTimeout(() => {}, 500);
    const textCheck = text.split(" ");
    if (textCheck[0] == "ChatGPT\n\n" && textCheck.length <= 1) {
      text = await lazyLoadingFix(page, chatSession.conversation);
    }

    // Bring page to front before text extraction
    await page.bringToFront();

    if (screenshot) {
      ensureScreenshotsDir();
      await page.screenshot({
        path: `screenshots/4parsing-text-${chatId}.png`,
      });
      console.log(`screenshots/4parsing-text-${chatId}.png`);
    }

    let parsedText = preprocessText(text);
    if (!parsedText) {
      parsedText = await lazyLoadingFix(page, chatSession.conversation);
    }
    if (
      parsedText ==
        "You've reached our limit of messages per hour. Please try again later." ||
      parsedText ==
        "Something went wrong while generating the response. If this issue persists please contact us through our help center at help.openai.com." ||
      parsedText.includes(
        "A network error occurred. Please check your connection and try again. If this issue persists please contact us through our help center at help.openai.com."
      )
    ) {
      await closeChatSession(chatId);
    }

    console.log(`Prompt response for chat ${chatId}: \n`, parsedText);
    return parsedText;
  } catch (e) {
    numErr++;
    await handleGlobalError();

    console.error(e);
    await closeChatSession(chatId);
    return { message: "Chat crashed, please create a new chat session" };
  }
}

function generateUniqueChatId() {
  return "chat_" + Math.random().toString(36).substr(2, 9);
}

async function handleGlobalError() {
  if (process.env.RESTART_BROWSER == "true") {
    console.log("Err counter: ", numErr);
    if (numErr > 1) {
      try {
        await browser.close();
      } catch (error) {
        console.error("Error closing browser during restart:", error);
      }
      browser = await puppeteer.launch({
        headless,
        browser: browserType,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      conversations = {};
      requestQueues = {};
      numErr = 0;
      console.log("Browser Restart");
    }
  }
  // Removed closeExtraTabs call
}

app.use((req, res, next) => {
  res.status(404).json({ message: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Internal server error" });
});

let browserType = "chrome";
let port = 8080;
let headless = true;
let screenshot = false;

// Loop through process.argv to find arguments for port and browser
process.argv.forEach((arg, index) => {
  if (arg === "-p" && process.argv[index + 1]) {
    port = parseInt(process.argv[index + 1], 10);
  }
  if (arg === "-b" && process.argv[index + 1]) {
    browser = process.argv[index + 1].toLowerCase(); // Make browser name lowercase for consistency
  }
  if (arg === "--no-headless") {
    headless = false;
  }
  if (arg === "--screenshot") {
    screenshot = true;
  }
});

browserInit().then(() => {
  app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
  });
});

function ensureScreenshotsDir() {
  if (!fs.existsSync("screenshots")) {
    fs.mkdirSync("screenshots");
  }
}

// Add cleanup function to call when the process is shutting down
async function cleanupBeforeExit() {
  console.log("Cleaning up before exit...");
  stopFetching = true;

  // Close all chat sessions properly
  const chatIds = Object.keys(conversations);
  for (const chatId of chatIds) {
    await closeChatSession(chatId);
  }

  if (browser) {
    try {
      await browser.close();
      console.log("Browser closed successfully");
    } catch (error) {
      console.error("Error closing browser during exit:", error);
    }
  }
}

// Remove the periodic cleanup interval
// const TAB_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
// setInterval(async () => {
//   console.log("Running periodic tab cleanup");
//   await closeExtraTabs();
// }, TAB_CLEANUP_INTERVAL);
