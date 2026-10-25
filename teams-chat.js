// Teams chat group history extraction.
//
// 1. In DevTools → Elements, select the chat message list, so it becomes $0.
// 2. Paste this script into the Console and press Enter.
// 3. Scroll the chat slowly so every message renders once.
// 4. Export:
//      copy([...__chat.values()].join("\n"));
// 5. Clean up:
//      __stopChat?.();         // stop observing
//      window.__chat?.clear(); // clear stored messages

window.__chat = window.__chat || new Map();
window.__stopChat?.();

const normalize = s =>
  (s || "")
    .replace(/​|‌|‍|﻿/g, "")
    .replace(/ /g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

(function watch(el){

  const grab = () => {

    // Adjust selectors if needed
    const messages = el.querySelectorAll('[data-tid="chat-pane-message"], .fui-ChatMessage, [role="listitem"]');

    messages.forEach(msg => {

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

  grab();

  const obs = new MutationObserver(grab);
  obs.observe(el, { childList: true, subtree: true });

  window.__stopChat = () => obs.disconnect();

  console.log("Watching chat. Scroll slowly. Export with: copy([...__chat.values()].join('\\n'))");
})($0);
