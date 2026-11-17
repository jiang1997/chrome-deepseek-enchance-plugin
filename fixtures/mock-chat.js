// Test-page controls only: mutate page DOM, never invoke extension code or compute its results.
(() => {
  const viewport = document.querySelector("#message-viewport");
  const list = document.querySelector("#messages");
  const windowEl = list.querySelector(".ds-virtual-list-visible-items");
  const original = [...windowEl.children].map((item) => item.cloneNode(true));
  let virtual = null;

  const itemFor = (id) => [...windowEl.children].find((item) => item.dataset.virtualListItemKey === id);
  const textBlock = (className, text) => {
    const el = document.createElement("div");
    el.className = className;
    el.textContent = text;
    return el;
  };

  function createMessage(message) {
    const item = document.createElement("div");
    item.className = "msg";
    item.dataset.virtualListItemKey = message.id;
    const body = textBlock("ds-message", "");
    if (message.role === "user") {
      body.append(textBlock("ds-collapsible-text", message.content ?? ""));
    } else {
      if (message.thinking !== undefined) {
        const thinking = textBlock("ds-think-content", "");
        thinking.append(textBlock("ds-markdown", message.thinking));
        body.append(thinking);
      }
      if (message.content !== undefined) {
        const answer = textBlock(
          message.answerClass === false ? "ds-markdown" : "ds-markdown ds-assistant-message-main-content",
          message.content,
        );
        body.append(answer);
      }
    }
    item.append(body);
    return item;
  }

  function stopVirtualList() {
    virtual = null;
    viewport.removeAttribute("data-virtual");
    viewport.style.removeProperty("height");
    viewport.scrollTop = 0;
    list.style.removeProperty("height");
    windowEl.removeAttribute("style");
    windowEl.style.setProperty("--dsl-virtual-list-transform-y", "0px");
  }

  function renderVirtualWindow() {
    if (!virtual) return;
    const { messages, rowHeight } = virtual;
    const start = Math.floor(viewport.scrollTop / rowHeight);
    if (virtual.start === start) return;
    virtual.start = start;
    const end = Math.min(messages.length, start + Math.ceil(viewport.clientHeight / rowHeight) + 1);
    const offset = start * rowHeight;
    windowEl.style.transform = `translateY(${offset}px)`;
    windowEl.style.setProperty("--dsl-virtual-list-transform-y", `${offset}px`);
    const nodes = messages.slice(start, end).map((message) => {
      const item = createMessage(message);
      item.style.height = `${rowHeight}px`;
      return item;
    });
    // Unmount the previous window, just as a virtual list does on scrolling.
    windowEl.replaceChildren(...nodes);
  }

  viewport.addEventListener("scroll", renderVirtualWindow);

  window.__mockDeepSeek = {
    resetMessages() {
      stopVirtualList();
      windowEl.replaceChildren(...original.map((item) => item.cloneNode(true)));
    },
    setMessages(messages) {
      stopVirtualList();
      windowEl.replaceChildren(...messages.map(createMessage));
    },
    showRenderedWindow(ids, offset) {
      stopVirtualList();
      windowEl.replaceChildren(
        ...original.filter((item) => ids.includes(item.dataset.virtualListItemKey)).map((item) => item.cloneNode(true)),
      );
      windowEl.style.setProperty("--dsl-virtual-list-transform-y", `${offset}px`);
    },
    addMessage(message) {
      if (virtual) throw new Error("Use setVirtualMessages to change a virtual conversation");
      windowEl.append(createMessage(message));
    },
    appendAnswer(id, text) {
      const item = itemFor(id);
      if (!item) throw new Error(`Message ${id} is not rendered`);
      let answer = item.querySelector(".ds-assistant-message-main-content");
      if (!answer) {
        answer = textBlock("ds-markdown ds-assistant-message-main-content", "");
        item.querySelector(".ds-message").append(answer);
      }
      if (answer.lastChild?.nodeType === Node.TEXT_NODE) answer.lastChild.appendData(text);
      else answer.append(document.createTextNode(text));
    },
    replaceComposer() {
      const old = document.querySelector("#composer");
      const fresh = old.cloneNode(false);
      fresh.value = old.value;
      old.replaceWith(fresh);
    },
    setVirtualMessages(messages, rowHeight = 100, height = 300) {
      stopVirtualList();
      virtual = { messages, rowHeight, start: -1 };
      viewport.dataset.virtual = "true";
      viewport.style.height = `${height}px`;
      list.style.height = `${messages.length * rowHeight}px`;
      Object.assign(windowEl.style, { position: "absolute", top: "0", left: "0", right: "0" });
      renderVirtualWindow();
    },
    switchConversation(id, messages) {
      history.pushState({}, "", `/a/chat/s/${encodeURIComponent(id)}`);
      this.setMessages(messages);
      this.replaceComposer();
      document.querySelector("#composer").value = "";
    },
  };
})();
