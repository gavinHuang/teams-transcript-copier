// Teams chat group history extraction.
//
// 1. In DevTools → Elements, select the chat message list, so it becomes $0.
// 2. Paste this script into the Console and press Enter.
// 3. Click back into the page and wait. The script scrolls up until the whole
//    history has loaded, then scrolls back down collecting every message in
//    order. When it finishes, the chat is copied to the clipboard.
// 4. Export again at any time:
//      copy([...__chat.values()].join("\n"));
// 5. Clean up:
//      __stopChat?.();         // stop scrolling and observing
//      window.__chat?.clear(); // clear stored messages
//
// Set CONFIG.autoScroll = false to scroll by hand instead.

window.__chat = window.__chat || new Map();
window.__stopChat?.();

const CONFIG = {
  autoScroll: true,
  scrollStep: 500,
  scrollDelayMs: 700,
  // Rounds without progress before a phase is considered done.
  maxIdleRounds: 12,
  copyWhenFinished: true,
};

const normalize = s =>
  (s || "")
    .replace(/​|‌|‍|﻿/g, "")
    .replace(/ /g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The selected element may be the scroller itself, a child of it, or a wrapper
// around it, so look in all three directions and take the biggest scroll range.
const findScroller = el => {
  const candidates = [el, ...el.querySelectorAll("*")];
  for (let p = el.parentElement; p; p = p.parentElement) candidates.push(p);

  return candidates
    .filter(c => c.scrollHeight > c.clientHeight + 80)
    .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
};

(function watch(el){

  // While loading history upward, messages arrive newest-first, so recording
  // waits until the downward sweep to keep them in chronological order.
  let recording = !CONFIG.autoScroll;
  let stopped = false;

  const getMessages = () =>
    // Adjust selectors if needed
    el.querySelectorAll('[data-tid="chat-pane-message"], .fui-ChatMessage, [role="listitem"]');

  const grab = () => {
    if (!recording) return;

    getMessages().forEach(msg => {

      // Try to extract sender
      const senderEl =
        msg.querySelector('[data-tid="message-author-name"]') ||
        msg.querySelector('.fui-ChatMessage__author') ||
        msg.querySelector('[role="heading"]');

      // Try to extract message body
      const bodyEl =
        msg.querySelector('[data-tid="chat-pane-message-text"]') ||
        msg.querySelector('.fui-ChatMessage__content') ||
        msg.querySelector('[dir="auto"]');

      const sender = normalize(senderEl?.innerText);
      const body = normalize(bodyEl?.innerText);

      if (!body) return;

      // Use body + sender as dedupe key
      const key = sender + "||" + body;

      if (!window.__chat.has(key)) {
        window.__chat.set(key, `${sender ? sender + ": " : ""}${body}`);
      }
    });
  };

  // Phase 1: keep jumping to the top so Teams lazy-loads older messages,
  // until neither the scroll height nor the first message changes.
  const loadHistory = async scroller => {
    let idle = 0;
    let lastHeight = -1;
    let lastFirst = null;

    while (!stopped && idle < CONFIG.maxIdleRounds) {
      scroller.scrollTop = 0;
      await sleep(CONFIG.scrollDelayMs);

      const first = normalize(getMessages()[0]?.innerText);

      if (scroller.scrollHeight !== lastHeight || first !== lastFirst) {
        lastHeight = scroller.scrollHeight;
        lastFirst = first;
        idle = 0;
        console.log("[Teams chat] loading older messages...");
      } else {
        idle++;
        // Nudge down and back up; Teams sometimes only loads on a scroll event.
        if (idle % 3 === 0) {
          scroller.scrollTop = CONFIG.scrollStep;
          await sleep(150);
        }
      }
    }
  };

  // Phase 2: scroll down step by step, recording what renders.
  const sweepDown = async scroller => {
    recording = true;
    grab();

    let idle = 0;
    let lastSize = window.__chat.size;

    while (!stopped && idle < CONFIG.maxIdleRounds) {
      const beforeTop = scroller.scrollTop;
      const beforeSize = window.__chat.size;

      scroller.scrollBy({ top: CONFIG.scrollStep, behavior: "auto" });
      await sleep(CONFIG.scrollDelayMs);
      grab();

      if (scroller.scrollTop !== beforeTop || window.__chat.size !== beforeSize) {
        idle = 0;
      } else {
        idle++;
      }

      if (window.__chat.size !== lastSize) {
        lastSize = window.__chat.size;
        console.log(`[Teams chat] captured messages: ${lastSize}`);
      }
    }
  };

  const copyChat = async () => {
    const text = [...window.__chat.values()].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      console.log(`[Teams chat] copied ${window.__chat.size} messages to clipboard.`);
    } catch (err) {
      console.warn("[Teams chat] clipboard blocked. Click the page, then run: copy([...__chat.values()].join('\\n'))");
    }
  };

  const autoScroll = async () => {
    const scroller = findScroller(el);
    if (!scroller) {
      console.warn("[Teams chat] no scrollable container found. Scroll by hand instead.");
      recording = true;
      grab();
      return;
    }

    console.log("[Teams chat] scrolling target:", scroller);
    await loadHistory(scroller);
    if (stopped) return;

    console.log("[Teams chat] reached the top. Collecting messages...");
    await sweepDown(scroller);
    if (stopped) return;

    console.log(`[Teams chat] finished. Captured messages: ${window.__chat.size}`);
    if (CONFIG.copyWhenFinished) await copyChat();
  };

  grab();

  const obs = new MutationObserver(grab);
  obs.observe(el, { childList: true, subtree: true });

  window.__stopChat = () => {
    stopped = true;
    obs.disconnect();
  };

  if (CONFIG.autoScroll) {
    console.log("[Teams chat] auto-scrolling. Keep this tab active until it finishes.");
    autoScroll();
  } else {
    console.log("Watching chat. Scroll slowly. Export with: copy([...__chat.values()].join('\\n'))");
  }
})($0);
