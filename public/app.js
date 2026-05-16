const navButtons = document.querySelectorAll(".nav-btn");
const sections = document.querySelectorAll(".section");

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.section;
    navButtons.forEach((b) => b.classList.toggle("active", b === btn));
    sections.forEach((s) => s.classList.toggle("active", s.id === target));
    if (target === "library") loadLibrary();
  });
});

/* ---------- Advise ---------- */
const chatMessages = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");
const history = [];

function renderAssistant(text) {
  const wrap = document.createElement("div");
  wrap.className = "msg assistant";
  const idx = text.search(/RECOMMENDATION:/i);
  if (idx === -1) {
    wrap.textContent = text;
  } else {
    const before = document.createElement("span");
    before.textContent = text.slice(0, idx).trim();
    const rec = document.createElement("span");
    rec.className = "recommendation";
    rec.textContent = text.slice(idx).trim();
    wrap.appendChild(before);
    wrap.appendChild(rec);
  }
  chatMessages.appendChild(wrap);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderSimple(text, cls) {
  const el = document.createElement("div");
  el.className = `msg ${cls}`;
  el.textContent = text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const content = chatInput.value.trim();
  if (!content) return;

  const empty = chatMessages.querySelector(".chat-empty");
  if (empty) empty.remove();

  renderSimple(content, "user");
  history.push({ role: "user", content });
  chatInput.value = "";
  chatSend.disabled = true;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed.");
    renderAssistant(data.reply);
    history.push({ role: "assistant", content: data.reply });
  } catch (err) {
    renderSimple(err.message, "error");
    history.pop();
  } finally {
    chatSend.disabled = false;
  }
});

/* ---------- Library ---------- */
const libraryList = document.getElementById("library-list");

function field(label, value) {
  const f = document.createElement("div");
  f.className = "field" + (value ? "" : " empty");
  const l = document.createElement("div");
  l.className = "field-label";
  l.textContent = label;
  const t = document.createElement("div");
  t.className = "field-text";
  t.textContent = value || "";
  f.appendChild(l);
  f.appendChild(t);
  return f;
}

async function loadLibrary() {
  libraryList.textContent = "";
  let principles;
  try {
    const res = await fetch("/api/principles");
    principles = await res.json();
  } catch {
    libraryList.textContent = "Could not load principles.";
    return;
  }

  if (!principles.length) {
    libraryList.textContent = "No principles yet.";
    return;
  }

  principles.forEach((p, i) => {
    const item = document.createElement("div");
    item.className = "principle";

    const head = document.createElement("div");
    head.className = "principle-head";

    const num = document.createElement("span");
    num.className = "principle-num";
    num.textContent = "P" + String(i + 1).padStart(2, "0");

    const name = document.createElement("span");
    name.className = "principle-name";
    name.textContent = p.name;

    const date = document.createElement("span");
    date.className = "principle-date";
    date.textContent = p.dateAdded || "";

    head.appendChild(num);
    head.appendChild(name);
    head.appendChild(date);

    const body = document.createElement("div");
    body.className = "principle-body";
    body.appendChild(field("Statement", p.refined));
    body.appendChild(field("Stress Test", p.stressTest));
    body.appendChild(field("Connections", p.connections));
    body.appendChild(field("Insight", p.insight));

    item.appendChild(head);
    item.appendChild(body);
    item.addEventListener("click", () => item.classList.toggle("open"));
    libraryList.appendChild(item);
  });
}

/* ---------- Add ---------- */
const addName = document.getElementById("add-name");
const addRaw = document.getElementById("add-raw");
const btnSave = document.getElementById("btn-save");
const btnStress = document.getElementById("btn-stress");
const addStatus = document.getElementById("add-status");
const preview = document.getElementById("preview");

function setStatus(text, cls) {
  addStatus.textContent = text;
  addStatus.className = "add-status" + (cls ? " " + cls : "");
}

async function savePrinciple(payload) {
  const res = await fetch("/api/principles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Save failed.");
  return data;
}

btnSave.addEventListener("click", async () => {
  const raw = addRaw.value.trim();
  if (!raw) {
    setStatus("Write a principle first.", "error");
    return;
  }
  btnSave.disabled = true;
  try {
    const saved = await savePrinciple({ name: addName.value.trim(), raw });
    setStatus(`Saved "${saved.name}".`, "success");
    addName.value = "";
    addRaw.value = "";
    preview.textContent = "";
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    btnSave.disabled = false;
  }
});

btnStress.addEventListener("click", async () => {
  const raw = addRaw.value.trim();
  if (!raw) {
    setStatus("Write a principle first.", "error");
    return;
  }
  btnStress.disabled = true;
  setStatus("Stress testing…");
  preview.textContent = "";
  try {
    const res = await fetch("/api/refine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Stress test failed.");
    setStatus("");
    renderPreview(data);
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    btnStress.disabled = false;
  }
});

function renderPreview(data) {
  const card = document.createElement("div");
  card.className = "preview-card";

  const name = document.createElement("div");
  name.className = "preview-name";
  name.textContent = data.name || "Untitled Principle";
  card.appendChild(name);

  card.appendChild(field("Statement", data.refined));
  card.appendChild(field("Stress Test", data.stressTest));
  card.appendChild(field("Connections", data.connections));
  card.appendChild(field("Insight", data.insight));

  const row = document.createElement("div");
  row.className = "confirm-row";
  const confirm = document.createElement("button");
  confirm.textContent = "Confirm & Save";
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    try {
      const saved = await savePrinciple({
        name: data.name,
        refined: data.refined,
        stressTest: data.stressTest,
        connections: data.connections,
        insight: data.insight,
      });
      setStatus(`Saved "${saved.name}".`, "success");
      addName.value = "";
      addRaw.value = "";
      preview.textContent = "";
    } catch (err) {
      setStatus(err.message, "error");
      confirm.disabled = false;
    }
  });
  row.appendChild(confirm);
  card.appendChild(row);

  preview.appendChild(card);
}
