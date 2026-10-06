(async () => {
  window.__teamsTranscript?.stop?.();

  const STATE = {
    blocks: new Map(),
    observers: [],
    roots: new Set(),
    autoScrollTimer: null,
    scanTimer: null,
    lastSize: 0,
    copied: false,
  };

  const CONFIG = {
    scrollStep: 650,
    scrollDelayMs: 600,
    maxIdleRounds: 18,
    copyWhenFinished: true,
    downloadWhenFinished: false,
    filename: "teams-transcript.txt",

    // If true, speaker/timestamp headers are removed.
    // If false, Teams-style headers are kept in each block.
    stripSpeakerTimestampHeader: true,
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const normalize = (s) =>
    (s || "")
      .replace(/\u200B|\u200C|\u200D|\uFEFF/g, "")
      .replace(/\u00A0/g, " ")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();

  const isUsefulText = (t) => {
    if (!t) return false;
    if (t.length < 2) return false;

    const junk = [
      /^transcript$/i,
      /^meeting transcript$/i,
      /^copy$/i,
      /^copied$/i,
      /^download$/i,
      /^close$/i,
      /^more options$/i,
      /^search$/i,
      /^show more$/i,
      /^see more$/i,
      /^jump to/i,
      /^live transcript/i,
      /^started transcription/i,
      /^stopped transcription/i,
      /^open in teams/i,
      /^view meeting transcript/i,
    ];

    return !junk.some((re) => re.test(t));
  };

  const cleanBlock = (raw) => {
    let t = normalize(raw);
    if (!isUsefulText(t)) return "";

    let lines = t
      .split("\n")
      .map((l) => normalize(l))
      .filter(Boolean);

    if (!lines.length) return "";

    lines = lines.filter(
      (l) =>
        !/^(copy|copied|download|close|more options|search|show more|see more)$/i.test(l)
    );

    const headerDurationRe =
      /^(.+?)\s+((\d+\s+minutes?\s+)?\d+\s+seconds?|\d{1,2}:\d{2}(:\d{2})?)$/i;

    if (CONFIG.stripSpeakerTimestampHeader) {
      // Removes combined header like:
      // "John Smith 0 minutes 10 seconds"
      // "John Smith 10 seconds"
      // "John Smith 01:23"
      if (lines[0] && headerDurationRe.test(lines[0])) {
        lines.shift();
      }

      // Removes split header like:
      // John Smith
      // 0 minutes 10 seconds
      // Actual transcript text
      if (
        lines.length >= 3 &&
        /^((\d+\s+minutes?\s+)?\d+\s+seconds?|\d{1,2}:\d{2}(:\d{2})?)$/i.test(lines[1])
      ) {
        lines = lines.slice(2);
      }
    }

    // Remove adjacent duplicate lines in one block.
    const out = [];
    for (const line of lines) {
      if (out[out.length - 1] !== line) out.push(line);
    }

    t = normalize(out.join("\n"));
    return isUsefulText(t) ? t : "";
  };

  const getRoots = () => {
    const candidates = [];

    if (typeof $0 !== "undefined" && $0 instanceof HTMLElement) {
      candidates.push($0);
    }

    document
      .querySelectorAll(`
        [aria-label*="transcript" i],
        [aria-label*="transcription" i],
        [data-tid*="transcript" i],
        [data-testid*="transcript" i],
        [id*="transcript" i],
        [class*="transcript" i],
        [role="dialog"],
        [role="complementary"],
        aside
      `)
      .forEach((el) => candidates.push(el));

    if (!candidates.length) candidates.push(document.body);

    return [...new Set(candidates)].filter((el) => el && el instanceof HTMLElement);
  };

  const getRows = (root) => {
    const selector = [
      '[role="listitem"]',
      '[role="article"]',
      '[data-tid*="message" i]',
      '[data-tid*="transcript" i]',
      '[data-testid*="message" i]',
      '[data-testid*="transcript" i]',
      ".ms-List-cell",
      "li",
    ].join(",");

    const matched = [...root.querySelectorAll(selector)].filter(
      (el) => el instanceof HTMLElement
    );

    // Keep only the innermost matches. Otherwise a wrapper and its child rows
    // both match, and the wrapper's combined text is captured as a giant block.
    const rows = matched
      .filter((el) => !matched.some((other) => other !== el && el.contains(other)))
      .filter((el) => {
        const txt = normalize(el.innerText);
        return txt && txt.length > 1;
      });

    return rows.length ? rows : [root];
  };

  const addBlock = (key, text) => {
    // Key is the raw row text (including speaker/timestamp header), so
    // virtualized re-renders dedupe, but identical lines like "Yes" said at
    // different times are still kept.
    if (!STATE.blocks.has(key)) {
      STATE.blocks.set(key, text);
    }
  };

  const grabFromRoot = (root) => {
    const rows = getRows(root);

    for (const row of rows) {
      const raw = row.innerText;
      const text = cleanBlock(raw);
      if (text) addBlock(normalize(raw), text);
    }

    if (STATE.blocks.size !== STATE.lastSize) {
      STATE.lastSize = STATE.blocks.size;
      console.log(`[Teams transcript] captured blocks: ${STATE.blocks.size}`);
    }
  };

  const observeRoot = (root) => {
    if (STATE.roots.has(root)) return;
    STATE.roots.add(root);

    grabFromRoot(root);

    // Throttle: Teams mutates the DOM constantly.
    let pending = false;
    const obs = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        grabFromRoot(root);
      });
    });
    obs.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    root.addEventListener("scroll", () => grabFromRoot(root), { passive: true });

    STATE.observers.push(obs);
  };

  const scan = () => {
    getRoots().forEach(observeRoot);
    STATE.roots.forEach(grabFromRoot);
  };

  const getBestScrollable = () => {
    const all = [
      ...STATE.roots,
      ...document.querySelectorAll("*"),
      document.scrollingElement,
      document.documentElement,
      document.body,
    ].filter(Boolean);

    const scrollables = [...new Set(all)]
      .filter((el) => el instanceof HTMLElement)
      .filter((el) => el.scrollHeight > el.clientHeight + 80)
      .map((el) => ({
        el,
        score:
          el.scrollHeight -
          el.clientHeight +
          (normalize(el.innerText).toLowerCase().includes("transcript") ? 5000 : 0),
      }))
      .sort((a, b) => b.score - a.score);

    return scrollables[0]?.el || document.scrollingElement || document.documentElement;
  };

  const text = () => [...STATE.blocks.values()].join("\n\n");

  const showSelectedTextarea = (finalText) => {
    const existing = document.getElementById("__teamsTranscriptTextarea");
    if (existing) existing.remove();

    const wrapper = document.createElement("div");
    wrapper.id = "__teamsTranscriptTextarea";
    wrapper.style.position = "fixed";
    wrapper.style.inset = "20px";
    wrapper.style.zIndex = "2147483647";
    wrapper.style.background = "white";
    wrapper.style.border = "2px solid #333";
    wrapper.style.boxShadow = "0 8px 30px rgba(0,0,0,0.35)";
    wrapper.style.padding = "12px";
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.gap = "8px";
    wrapper.style.fontFamily = "Arial, sans-serif";

    const label = document.createElement("div");
    label.textContent =
      "Automatic copy was blocked. The transcript is selected below - press Ctrl+C or Cmd+C now.";
    label.style.color = "black";
    label.style.fontSize = "14px";

    const closeButton = document.createElement("button");
    closeButton.textContent = "Close";
    closeButton.style.alignSelf = "flex-end";
    closeButton.onclick = () => wrapper.remove();

    const textarea = document.createElement("textarea");
    textarea.value = finalText;
    textarea.setAttribute("readonly", "");
    textarea.style.flex = "1";
    textarea.style.width = "100%";
    textarea.style.minHeight = "300px";
    textarea.style.fontSize = "14px";
    textarea.style.lineHeight = "1.4";
    textarea.style.background = "white";
    textarea.style.color = "black";

    wrapper.appendChild(closeButton);
    wrapper.appendChild(label);
    wrapper.appendChild(textarea);
    document.body.appendChild(wrapper);

    textarea.focus();
    textarea.select();

    return textarea;
  };

  const copyText = async () => {
    const finalText = text();

    if (!finalText) {
      console.warn("[Teams transcript] nothing captured yet.");
      return finalText;
    }

    try {
      await navigator.clipboard.writeText(finalText);
      console.log(`[Teams transcript] copied ${finalText.length} characters to clipboard.`);
      return finalText;
    } catch (err) {
      console.warn(
        "[Teams transcript] navigator.clipboard failed; trying textarea fallback.",
        err
      );
    }

    const textarea = document.createElement("textarea");
    textarea.value = finalText;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "20px";
    textarea.style.left = "20px";
    textarea.style.width = "80vw";
    textarea.style.height = "60vh";
    textarea.style.zIndex = "2147483647";
    textarea.style.fontSize = "14px";
    textarea.style.background = "white";
    textarea.style.color = "black";

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    let copied = false;

    try {
      copied = document.execCommand("copy");
    } catch (err2) {
      copied = false;
    }

    if (copied) {
      console.log(
        `[Teams transcript] copied ${finalText.length} characters using textarea fallback.`
      );
      textarea.remove();
    } else {
      textarea.remove();
      showSelectedTextarea(finalText);
      console.warn(
        "[Teams transcript] automatic copy was blocked. Press Ctrl+C or Cmd+C in the selected transcript box."
      );
    }

    return finalText;
  };

  const downloadText = () => {
    const finalText = text();

    if (!finalText) {
      console.warn("[Teams transcript] nothing captured yet.");
      return;
    }

    const blob = new Blob([finalText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = CONFIG.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    console.log(`[Teams transcript] downloaded ${finalText.length} characters.`);
  };

  window.__teamsTranscript = {
    text,
    copy: copyText,
    download: downloadText,
    count: () => STATE.blocks.size,

    show() {
      showSelectedTextarea(text());
    },

    stopAutoScroll() {
      if (STATE.autoScrollTimer) {
        clearInterval(STATE.autoScrollTimer);
        STATE.autoScrollTimer = null;
        console.log("[Teams transcript] auto-scroll stopped.");
      }
    },

    stop() {
      this.stopAutoScroll();

      if (STATE.scanTimer) {
        clearInterval(STATE.scanTimer);
        STATE.scanTimer = null;
      }

      STATE.observers.forEach((obs) => obs.disconnect());
      STATE.observers = [];

      console.log("[Teams transcript] stopped.");
    },
  };

  console.log("[Teams transcript] starting watcher...");
  scan();

  STATE.scanTimer = setInterval(scan, 1000);

  await sleep(1000);
  scan();

  let target = getBestScrollable();

  // Start from the top so earlier entries are not missed.
  target.scrollTop = 0;
  await sleep(CONFIG.scrollDelayMs);
  scan();

  console.log("[Teams transcript] auto-scrolling target:", target);
  console.log("[Teams transcript] scroll started. Keep this tab active until it finishes.");

  let idleRounds = 0;
  let lastTop = -1;
  let lastHeight = -1;
  let lastCount = -1;

  STATE.autoScrollTimer = setInterval(async () => {
    scan();

    // Teams may replace the scroll container, so re-check periodically.
    const maybeTarget = getBestScrollable();

    if (
      maybeTarget &&
      maybeTarget !== target &&
      maybeTarget.scrollHeight - maybeTarget.clientHeight >
        target.scrollHeight - target.clientHeight
    ) {
      target = maybeTarget;
      console.log("[Teams transcript] switched scroll target:", target);
    }

    const beforeTop = target.scrollTop;
    const beforeHeight = target.scrollHeight;
    const beforeCount = STATE.blocks.size;

    target.scrollBy({
      top: CONFIG.scrollStep,
      behavior: "auto",
    });

    await sleep(80);
    scan();

    const afterTop = target.scrollTop;
    const afterHeight = target.scrollHeight;
    const afterCount = STATE.blocks.size;

    const moved = afterTop !== beforeTop || afterTop !== lastTop;
    const heightChanged = afterHeight !== beforeHeight || afterHeight !== lastHeight;
    const capturedMore = afterCount !== beforeCount || afterCount !== lastCount;

    if (moved || heightChanged || capturedMore) {
      idleRounds = 0;
    } else {
      idleRounds++;
      console.log(
        `[Teams transcript] waiting for more rows... idle ${idleRounds}/${CONFIG.maxIdleRounds}`
      );
    }

    lastTop = afterTop;
    lastHeight = afterHeight;
    lastCount = afterCount;

    const atBottom =
      Math.ceil(target.scrollTop + target.clientHeight) >= target.scrollHeight - 5;

    if (atBottom && idleRounds >= CONFIG.maxIdleRounds) {
      window.__teamsTranscript.stopAutoScroll();
      scan();

      console.log(`[Teams transcript] finished. Captured blocks: ${STATE.blocks.size}`);

      if (CONFIG.copyWhenFinished && !STATE.copied) {
        STATE.copied = true;
        await copyText();
      }

      if (CONFIG.downloadWhenFinished) {
        downloadText();
      }

      console.log(`
Done.

Useful commands:
  __teamsTranscript.count()
  __teamsTranscript.text()
  __teamsTranscript.copy()
  __teamsTranscript.download()
  __teamsTranscript.show()
  __teamsTranscript.stop()
`);
    }
  }, CONFIG.scrollDelayMs);
})();
