/* Modifica rapida stile Trello (✎ o tasto destro su una scheda) e "Duplica scheda" nel menu ⋮ */
(() => {
  "use strict";
  const PS = window.__ps;
  if (!PS || PS.ready) return;
  const { TASK, TS_MODEL, SPRINT_FIELD, getEnv, el, fail, svg, findRecord, sprintValue, pad,
    fmtDay, fmtHours, parseHours, PALETTE, PRIO, PRIO_ORDER, prioOf, prioButton } = PS;

  /* ---------- "Duplica scheda" nel menu ⋮ delle schede kanban ---------- */
  const DUP_MODELS = [TASK, "helpdesk.ticket"];
  let lastCard = null, lastCardAt = 0;

  async function duplicate(rec) {
    const { orm, notification, action } = getEnv().services;
    const r = await orm.call(rec.resModel, "copy", [[rec.resId]]);
    const newId = Array.isArray(r) ? r[0] : r;
    try { await rec.model.load(); } catch (e) { console.warn("[pulsantiera] ricarica vista non riuscita:", e); }
    const [n] = await orm.read(rec.resModel, [newId], ["display_name"]);
    notification.add(`Scheda duplicata: ${n?.display_name || "#" + newId}`, {
      type: "success",
      buttons: [{
        name: "Apri", primary: true,
        onClick: () => action.doAction({
          type: "ir.actions.act_window", res_model: rec.resModel, res_id: newId,
          views: [[false, "form"]], target: "current",
        }),
      }],
    });
  }

  function closeMenu(card) {
    const toggle = card.querySelector(".o_dropdown_kanban .dropdown-toggle");
    if (toggle) toggle.click();
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }

  // chiamata dall'observer di main.js per ogni menu a tendina aggiunto alla pagina
  function injectDup(menu) {
    if (menu.querySelector(".ps-dup")) return;
    const inCard = menu.closest(".o_kanban_record");
    const card = inCard || (Date.now() - lastCardAt < 1500 ? lastCard : null);
    if (!card || !card.isConnected) return;
    const rec = findRecord(card);
    if (!rec || !DUP_MODELS.includes(rec.resModel)) return;
    const item = el("a", {
      href: "#", role: "menuitem", className: "dropdown-item o-dropdown-item ps-dup", textContent: "Duplica scheda",
    });
    item.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(card);
      duplicate(rec).catch(fail);
    });
    menu.prepend(item, el("div", { className: "dropdown-divider" }));
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest?.(".o_kanban_record .o_dropdown_kanban, .o_kanban_record .dropdown-toggle");
    if (t) { lastCard = t.closest(".o_kanban_record"); lastCardAt = Date.now(); }
  }, true);

  /* ---------- Modifica rapida ---------- */
  const QE_MODELS = [TASK];

  let qe = null, taskFields = null;
  // con una finestra di dialogo aperta Esc chiude solo quella
  const qeKey = (e) => {
    if (e.key === "Escape" && !document.getElementById("ps-dialog")) { e.preventDefault(); e.stopPropagation(); closeQE(); }
  };
  function closeQE() {
    if (!qe) return;
    document.removeEventListener("keydown", qeKey, true);
    qe.remove();
    qe = null;
  }
  async function getTaskFields(orm) {
    if (!taskFields) taskFields = await orm.call(TASK, "fields_get", [], { attributes: ["type", "string"] });
    return taskFields;
  }
  const toLocalInput = (v, type) => {
    if (!v) return "";
    if (type === "date") return v;
    const d = new Date(v.replace(" ", "T") + "Z");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const fromLocalInput = (v, type) => {
    if (!v) return false;
    if (type === "date") return v;
    return new Date(v).toISOString().slice(0, 19).replace("T", " ");
  };
  const todayIso = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };

  async function openQE(card, rec) {
    closeQE();
    const { orm, notification, action } = getEnv().services;
    const id = rec.resId;
    const fields = await getTaskFields(orm);
    const has = (f) => !!fields[f];
    const DATE_FIELDS = ["planned_date_begin", "date_deadline"].filter(has);
    const readFields = ["name", "tag_ids", "user_ids", "stage_id", "project_id", "displayed_image_id",
      ...DATE_FIELDS, SPRINT_FIELD, "effective_hours", "allocated_hours", "color"].filter(has);

    let data;
    const reload = async () => { [data] = await orm.read(TASK, [id], readFields); };
    const refreshView = async () => {
      try { await rec.model.load(); } catch (e) { console.warn("[pulsantiera] ricarica vista non riuscita:", e); }
    };
    const write = async (vals, msg) => {
      await orm.write(TASK, [id], vals);
      await reload();
      await refreshView();
      if (msg) notification.add(msg, { type: "success" });
    };
    await reload();

    const r = card.getBoundingClientRect();
    qe = el("div", { id: "ps-qe" });
    qe.addEventListener("mousedown", (e) => { if (e.target === qe) closeQE(); });
    qe.addEventListener("contextmenu", (e) => { e.preventDefault(); if (e.target === qe) closeQE(); });
    document.addEventListener("keydown", qeKey, true);

    /* titolo modificabile al posto della scheda */
    const title = el("textarea", { value: data.name, rows: 3 });
    title.setAttribute("aria-label", "Titolo della scheda");
    async function saveTitle() {
      const v = title.value.trim();
      if (!v || v === data.name) return closeQE();
      try { await write({ name: v }); closeQE(); } catch (e) { fail(e); }
    }
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveTitle(); }
    });
    const box = el("div", { className: "qe-card" }, title,
        el("button", { className: "primary", textContent: "Salva", onclick: saveTitle }));
    box.style.left = r.left + "px";
    box.style.width = r.width + "px";

    const menu = el("div", { className: "qe-menu" });
    const pop = el("div", { className: "qe-pop", hidden: true });

    /* popover */
    let popFor = null;
    const hidePop = () => { pop.hidden = true; popFor = null; };
    function placePop(btn) {
      const m = menu.getBoundingClientRect(), b = btn.getBoundingClientRect(), w = 280;
      let left = m.right + 8;
      if (left + w > innerWidth - 8) left = m.left - 8 - w;
      pop.style.left = Math.max(8, left) + "px";
      pop.style.top = Math.max(8, Math.min(b.top, innerHeight - pop.offsetHeight - 8)) + "px";
    }
    async function showPop(btn, build) {
      if (popFor === btn && !pop.hidden) return hidePop();
      popFor = btn;
      pop.hidden = false;
      PS.fill(pop, el("p", { className: "hint", textContent: "Carico…" }));
      placePop(btn);
      try { PS.fill(pop, ...(await build()).filter(Boolean)); }
      catch (e) { hidePop(); return fail(e); }
      placePop(btn);
    }
    const done = (p) => p.then(hidePop).catch(fail);

    function multiPicker({ title: t, items, selected, onSave, onCreate }) {
      const sel = new Set(selected);
      const search = el("input", { placeholder: "Cerca…" });
      const list = el("div", { className: "qe-list" });
      const createBtn = onCreate ? el("button", { className: "qe-create", hidden: true }) : null;
      const draw = () => {
        const q = search.value.trim().toLowerCase();
        PS.fill(list, ...items.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 200).map((i) => {
          const cb = el("input", { type: "checkbox", checked: sel.has(i.id),
            onchange: () => (cb.checked ? sel.add(i.id) : sel.delete(i.id)) });
          return el("label", { className: "chk" }, cb, i.name);
        }));
        if (createBtn) {
          createBtn.hidden = !q || items.some((i) => i.name.toLowerCase() === q);
          createBtn.textContent = `Crea "${search.value.trim()}"`;
        }
      };
      search.oninput = draw;
      if (createBtn) createBtn.onclick = async () => {
        try {
          const name = search.value.trim();
          const r2 = await onCreate(name);
          const newId = Array.isArray(r2) ? r2[0] : r2;
          items.push({ id: newId, name });
          sel.add(newId);
          search.value = "";
          draw();
        } catch (e) { fail(e); }
      };
      draw();
      setTimeout(() => search.focus());
      return [el("h4", { textContent: t }), search, createBtn, list,
        el("div", { className: "acts" },
            el("button", { className: "primary", textContent: "Salva", onclick: () => done(onSave([...sel])) }))];
    }

    const tagsPop = async () => {
      const tags = await orm.searchRead("project.tags", [], ["name"], { order: "name", limit: 1000 });
      return multiPicker({
        title: "Etichette", items: tags, selected: data.tag_ids,
        onSave: (ids) => write({ tag_ids: [[6, 0, ids]] }, "Etichette aggiornate."),
        onCreate: (name) => orm.create("project.tags", [{ name }]),
      });
    };
    const membersPop = async () => {
      const users = await orm.searchRead("res.users", [["share", "=", false]], ["name"], { order: "name", limit: 1000 });
      return multiPicker({
        title: "Membri", items: users, selected: data.user_ids,
        onSave: (ids) => write({ user_ids: [[6, 0, ids]] }, "Membri aggiornati."),
      });
    };
    const coverPop = async () => {
      const imgs = await orm.searchRead("ir.attachment",
          [["res_model", "=", TASK], ["res_id", "=", id], ["mimetype", "ilike", "image"]], ["name"]);
      const cur = data.displayed_image_id?.[0] || false;
      return [
        el("h4", { textContent: "Copertina" }),
        imgs.length
            ? el("div", { className: "qe-tiles" }, ...imgs.map((a) => el("button", {
              className: "qe-tile" + (a.id === cur ? " on" : ""), title: a.name,
              onclick: () => done(write({ displayed_image_id: a.id }, "Copertina aggiornata.")),
            }, el("img", { src: `/web/image/${a.id}/240x140`, alt: a.name }))))
            : el("p", { className: "hint", textContent: "Nessuna immagine allegata. Allega un'immagine dal chatter della scheda per usarla come copertina." }),
        el("div", { className: "acts" }, el("button", {
          textContent: "Rimuovi copertina", disabled: !cur,
          onclick: () => done(write({ displayed_image_id: false }, "Copertina rimossa.")),
        })),
      ];
    };
    const datesPop = async () => {
      const inputs = DATE_FIELDS.map((f) => {
        const t = fields[f].type;
        return [f, t, el("input", { type: t === "date" ? "date" : "datetime-local", value: toLocalInput(data[f], t) })];
      });
      return [
        el("h4", { textContent: "Date" }),
        ...inputs.flatMap(([f, , i]) => [el("label", { textContent: fields[f].string }), i]),
        el("div", { className: "acts" },
            el("button", { className: "primary", textContent: "Salva",
              onclick: () => done(write(Object.fromEntries(inputs.map(([f, t, i]) => [f, fromLocalInput(i.value, t)])), "Date aggiornate.")) }),
            el("button", { textContent: "Svuota", onclick: () => inputs.forEach(([, , i]) => { i.value = ""; }) })),
      ];
    };
    const movePop = async () => {
      const projects = await orm.searchRead("project.project", [], ["display_name"], { order: "name", limit: 1000 });
      const projSel = el("select", {}, ...projects.map((p) => el("option", { value: String(p.id), textContent: p.display_name })));
      projSel.value = String(data.project_id?.[0] || "");
      const stageSel = el("select");
      const loadStages = async () => {
        const st = await orm.searchRead("project.task.type", [["project_ids", "in", [Number(projSel.value)]]],
            ["name"], { order: "sequence, id" });
        PS.fill(stageSel, ...st.map((x) => el("option", { value: String(x.id), textContent: x.name })));
        if (st.some((x) => x.id === data.stage_id?.[0])) stageSel.value = String(data.stage_id[0]);
      };
      projSel.onchange = () => loadStages().catch(fail);
      await loadStages();
      return [
        el("h4", { textContent: "Sposta" }),
        el("label", { textContent: "Progetto" }), projSel,
        el("label", { textContent: "Fase" }), stageSel,
        el("div", { className: "acts" }, el("button", {
          className: "primary", textContent: "Sposta",
          onclick: async () => {
            const vals = { stage_id: Number(stageSel.value) || false };
            if (Number(projSel.value) !== data.project_id?.[0]) vals.project_id = Number(projSel.value);
            try { await write(vals, "Scheda spostata."); closeQE(); } catch (e) { fail(e); }
          },
        })),
      ];
    };
    const sprintPop = async () => {
      const cur = await sprintValue(orm, 0);
      const inp = el("input", { type: "number", min: "0", value: data[SPRINT_FIELD] || "" });
      const set = (n) => done(write({ [SPRINT_FIELD]: n }, n ? `Spostata nello sprint #${n}.` : "Sprint rimosso."));
      return [
        el("h4", { textContent: "Sprint" }),
        cur ? el("div", { className: "acts" },
            el("button", { textContent: `Corrente #${cur}`, onclick: () => set(cur) }),
            el("button", { textContent: `Successivo #${cur + 1}`, onclick: () => set(cur + 1) })) : null,
        el("label", { textContent: "Numero" }), inp,
        el("div", { className: "acts" },
            el("button", { className: "primary", textContent: "Salva", onclick: () => set(Number(inp.value) || 0) }),
            el("button", { textContent: "Rimuovi", onclick: () => set(0) })),
      ];
    };

    const hoursPop = async () => {
      if (!data.project_id) {
        return [el("h4", { textContent: "Registra ore" }),
          el("p", { className: "hint", textContent: "La scheda non ha un progetto: non è possibile registrare ore." })];
      }
      const hIn = el("input", { placeholder: "Quante ore? es. 2, 1,5 o 1:30", inputMode: "decimal" });
      const dIn = el("input", { type: "date", value: todayIso() });
      const descIn = el("input", { placeholder: "Descrizione (facoltativa)" });

      async function submit(preset) {
        const hours = preset ?? parseHours(hIn.value);
        if (!hours) { await PS.say("Ore non valide (es. 2, 1,5 o 1:30)."); hIn.focus(); return; }
        try {
          const r2 = await orm.create(TS_MODEL, [{
            date: dIn.value || todayIso(),
            project_id: data.project_id[0],
            task_id: id,
            name: descIn.value.trim() || "/",
            unit_amount: hours,
          }]);
          const lineId = Array.isArray(r2) ? r2[0] : r2;
          await reload();
          await refreshView();
          hidePop();
          const close = notification.add(`Registrate ${fmtHours(hours)} h su "${data.name}" (${fmtDay(dIn.value || todayIso())}).`, {
            type: "success",
            buttons: [{
              name: "Annulla",
              onClick: async () => {
                close?.();
                try {
                  await orm.unlink(TS_MODEL, [lineId]);
                  await refreshView();
                  notification.add("Registrazione annullata.", { type: "info" });
                } catch (e) { fail(e); }
              },
            }],
          });
        } catch (e) { fail(e); }
      }
      for (const n of [hIn, descIn]) n.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); submit(); }
      });
      setTimeout(() => hIn.focus());

      const logged = has("effective_hours")
          ? `Già registrate: ${fmtHours(data.effective_hours || 0)} h` +
          (data.allocated_hours ? ` su ${fmtHours(data.allocated_hours)} h previste` : "")
          : null;
      return [
        el("h4", { textContent: "Registra ore" }),
        logged ? el("p", { className: "hint", textContent: logged }) : null,
        el("label", { textContent: "Ore" }), hIn,
        el("div", { className: "acts" }, ...[0.5, 1, 2, 4, 8].map((h) =>
            el("button", { textContent: fmtHours(h), title: `Registra subito ${fmtHours(h)} h`, onclick: () => submit(h) }))),
        el("label", { textContent: "Data" }), dIn,
        el("label", { textContent: "Descrizione" }), descIn,
        el("div", { className: "acts" },
            el("button", { className: "primary", textContent: "Registra", onclick: () => submit() })),
      ];
    };

    const colorPop = async () => [
      el("h4", { textContent: "Colore scheda" }),
      el("div", { className: "qe-sw" }, ...PALETTE.map((p, i) => {
        const b = el("button", {
          title: i ? p[1] : "Nessun colore", textContent: i ? "" : "∅",
          className: (data.color || 0) === i ? "on" : "",
          onclick: () => done(write({ color: i }, "Colore aggiornato.")),
        });
        if (i) b.style.background = p[0];
        return b;
      })),
    ];

    const prioPop = async () => {
      const curP = prioOf({ data });
      return [
        el("h4", { textContent: "Priorità" }),
        el("div", { className: "prio-list" }, ...PRIO_ORDER.map((k) => {
          const b = prioButton(k, curP === k);
          b.onclick = () => done(write({ color: PRIO[k].color }, `Priorità: ${PRIO[k].label.toLowerCase()}.`));
          return b;
        })),
      ];
    };

    const copyLink = async () => {
      const url = `${location.origin}/web#id=${id}&model=${TASK}&view_type=form`;
      try { await navigator.clipboard.writeText(url); notification.add("Link copiato.", { type: "info" }); }
      catch { PS.showText("Copia il link:", url); }
    };
    const archive = async () => {
      if (!(await PS.ask("Archiviare la scheda?", { ok: "Archivia", danger: true }))) return;
      await orm.write(TASK, [id], { active: false });
      closeQE();
      await refreshView();
      notification.add("Scheda archiviata.", { type: "success" });
    };

    const colCfg = PS.colSettings(PS.colName(card.closest(".o_kanban_group")));
    const actions = [
      ["open", "Apri scheda", () => {
        closeQE();
        return action.doAction({ type: "ir.actions.act_window", res_model: TASK, res_id: id,
          views: [[false, "form"]], target: "current" });
      }],
      ["hours", "Registra ore", (b) => showPop(b, hoursPop)],
      ["tag", "Modifica etichette", (b) => showPop(b, tagsPop)],
      ["user", "Modifica membri", (b) => showPop(b, membersPop)],
      ["image", "Cambia copertina", (b) => showPop(b, coverPop)],
      DATE_FIELDS.length ? ["clock", "Modifica le date", (b) => showPop(b, datesPop)] : null,
      has("color") ? (colCfg.prio
          ? ["palette", "Priorità", (b) => showPop(b, prioPop)]
          : ["palette", "Colore scheda", (b) => showPop(b, colorPop)]) : null,
      ["move", "Sposta", (b) => showPop(b, movePop)],
      has(SPRINT_FIELD) ? ["zap", "Sprint", (b) => showPop(b, sprintPop)] : null,
      ["copy", "Copia scheda", () => { closeQE(); return duplicate(rec); }],
      ["link", "Copia link", copyLink],
      ["archive", "Archivia", archive],
    ].filter(Boolean).filter(([k]) => !(colCfg.qeHidden || []).includes(k));

    for (const [ic, label, fn] of actions) {
      const b = el("button", { className: "qe-act" });
      b.innerHTML = svg(ic);
      b.append(label);
      b.onclick = () => Promise.resolve(fn(b)).catch(fail);
      menu.append(b);
    }

    qe.append(box, menu, pop);
    document.body.append(qe);
    box.style.top = Math.max(8, Math.min(r.top, innerHeight - box.offsetHeight - 8)) + "px";
    let ml = r.right + 8;
    if (ml + menu.offsetWidth > innerWidth - 8) ml = r.left - 8 - menu.offsetWidth;
    menu.style.left = Math.max(8, ml) + "px";
    menu.style.top = Math.max(8, Math.min(r.top, innerHeight - menu.offsetHeight - 8)) + "px";
    title.focus();
    title.select();
  }

  const qeTarget = (node) => {
    const card = node?.closest?.(".o_kanban_record");
    if (!card || node.closest("#ps-qe")) return null;
    const rec = findRecord(card);
    return rec && QE_MODELS.includes(rec.resModel) ? { card, rec } : null;
  };

  // tasto destro sulla scheda (Shift + tasto destro = menu del browser)
  document.addEventListener("contextmenu", (e) => {
    if (e.shiftKey) return;
    const t = qeTarget(e.target);
    if (!t) return;
    e.preventDefault();
    openQE(t.card, t.rec).catch(fail);
  });

  // matita al passaggio del mouse, come in Trello
  const pencil = el("button", { id: "ps-qe-pencil", title: "Modifica rapida (anche tasto destro)", hidden: true });
  pencil.innerHTML = svg("pencil");
  let pencilCard = null;
  const hidePencil = () => { pencil.hidden = true; pencilCard = null; };
  document.addEventListener("mouseover", (e) => {
    if (qe || e.target.closest?.("#ps-qe-pencil")) return;
    const card = e.target.closest?.(".o_kanban_record");
    if (card && card === pencilCard) return;
    hidePencil();
    const t = card && qeTarget(e.target);
    if (!t) return;
    pencilCard = card;
    const r = card.getBoundingClientRect();
    pencil.style.left = (r.right - 62) + "px";
    pencil.style.top = (r.top + 6) + "px";
    pencil.hidden = false;
  });
  document.addEventListener("scroll", hidePencil, true);
  pencil.addEventListener("click", (e) => {
    e.stopPropagation();
    const card = pencilCard;
    hidePencil();
    const rec = card?.isConnected && findRecord(card);
    if (rec) openQE(card, rec).catch(fail);
  });
  document.body.append(pencil);

  Object.assign(PS, { injectDup });
})();
