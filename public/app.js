// ── State ──
let network = null;
let nodesDS = new vis.DataSet();
let edgesDS = new vis.DataSet();
let manifest = null;
let currentView = "system";
let currentSectionFilter = null;

const SECTION_FILTER_MIN = 2; // Show section filter only when project has >= 2 sections

// ── Colors ──
const KNOWN_SECTION_COLORS = {
  dashboard: "#f59e0b",
  crm: "#6366f1",
  operations: "#10b981",
  marketing: "#f97316",
  analytics: "#06b6d4",
  admin: "#ef4444",
};

const COLOR_PALETTE = [
  "#6366f1", "#f59e0b", "#10b981", "#f97316", "#06b6d4", "#ef4444",
  "#a855f7", "#ec4899", "#84cc16", "#14b8a6", "#f43f5e", "#8b5cf6",
  "#22d3ee", "#fb923c", "#4ade80", "#e879f9",
];

let SECTION_COLORS = {};

function buildSectionColors() {
  SECTION_COLORS = {};
  if (!manifest || !manifest.sections) return;
  let paletteIdx = 0;
  manifest.sections.forEach((s) => {
    if (KNOWN_SECTION_COLORS[s.id]) {
      SECTION_COLORS[s.id] = KNOWN_SECTION_COLORS[s.id];
    } else {
      SECTION_COLORS[s.id] = COLOR_PALETTE[paletteIdx % COLOR_PALETTE.length];
      paletteIdx++;
    }
  });
}

const ENTITY_COLOR = "#ec4899";
const FLOW_COLOR = "#a855f7";

const ELEMENT_COLORS = {
  button: "#22c55e",
  form: "#f59e0b",
  table: "#3b82f6",
  list: "#8b5cf6",
  cards: "#f97316",
  chart: "#06b6d4",
  charts: "#06b6d4",
  dialog: "#ef4444",
  sheet: "#d946ef",
  panel: "#64748b",
  section: "#475569",
  controls: "#94a3b8",
  tabs: "#94a3b8",
  tab: "#94a3b8",
  input: "#22c55e",
  dropdown: "#8b5cf6",
  tags: "#f43f5e",
  timeline: "#f59e0b",
  kanban: "#6366f1",
  column: "#475569",
  display: "#e2e8f0",
  interaction: "#10b981",
};

// ── Init ──
async function init() {
  initNetwork();
  setupControls();

  const res = await fetch("/api/projects");
  const projects = await res.json();
  const select = document.getElementById("project-select");

  // Sort by number prefix (e.g. "0000 - General" comes before "0001 - Selling Stuff")
  projects.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  projects.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.screenCount} screens, ${p.entityCount} entities)`;
    select.appendChild(opt);
  });

  if (projects.length) {
    select.value = projects[0].id;
    await loadProject(projects[0].id);
  }
}

async function loadProject(id) {
  const overlay = document.getElementById("loading-overlay");
  overlay.classList.remove("hidden");

  try {
    const res = await fetch(`/api/project/${id}`);
    manifest = await res.json();
    currentSectionFilter = null;
    buildSectionColors();
    populateSectionFilter();
    renderView(currentView);
  } finally {
    overlay.classList.add("hidden");
  }
}

// ── Section Filter ──
function populateSectionFilter() {
  const select = document.getElementById("section-filter");
  select.innerHTML = "";

  const hasSections = manifest.sections.length >= SECTION_FILTER_MIN;
  if (!hasSections) {
    select.classList.add("hidden");
    currentSectionFilter = null;
    return;
  }

  select.classList.remove("hidden");

  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "All sections";
  select.appendChild(allOpt);

  manifest.sections.forEach((s) => {
    const screenCount = manifest.screens.filter((sc) => sc.section === s.id).length;
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.name} (${screenCount})`;
    select.appendChild(opt);
  });
}

function getFilteredData() {
  if (!currentSectionFilter) {
    return {
      sections: manifest.sections,
      screens: manifest.screens,
      entities: manifest.entities,
      relationships: manifest.relationships,
      flows: manifest.flows || [],
    };
  }

  const sections = manifest.sections.filter((s) => s.id === currentSectionFilter);
  const screens = manifest.screens.filter((s) => s.section === currentSectionFilter);
  const screenIds = new Set(screens.map((s) => s.id));

  const entities = manifest.entities.filter((e) =>
    e.screens.some((sid) => screenIds.has(sid))
  );
  const entityIds = new Set(entities.map((e) => e.id));

  const relationships = manifest.relationships.filter(
    (r) => entityIds.has(r.from) || entityIds.has(r.to)
  );

  const flows = (manifest.flows || []).filter((f) =>
    f.steps.some((stepId) => screenIds.has(stepId) || entityIds.has(stepId))
  );

  return { sections, screens, entities, relationships, flows };
}

// ── Network ──
function initNetwork() {
  const container = document.getElementById("graph-container");
  const options = {
    physics: {
      enabled: true,
      solver: "forceAtlas2Based",
      forceAtlas2Based: {
        gravitationalConstant: -80,
        centralGravity: 0.006,
        springLength: 160,
        springConstant: 0.04,
        damping: 0.4,
        avoidOverlap: 0.6,
      },
      stabilization: { enabled: true, iterations: 300, updateInterval: 20 },
      maxVelocity: 40,
    },
    interaction: {
      hover: true,
      tooltipDelay: 100,
      keyboard: { enabled: true },
      zoomView: true,
      dragView: true,
      multiselect: false,
    },
    nodes: {
      font: { color: "#cbd5e1", size: 13, face: "'SF Mono', 'Fira Code', monospace" },
    },
    edges: {
      arrows: { to: { enabled: false } },
      smooth: { type: "cubicBezier", roundness: 0.3 },
    },
  };

  network = new vis.Network(container, { nodes: nodesDS, edges: edgesDS }, options);

  network.on("click", (params) => {
    if (params.nodes.length === 1) showPanel(params.nodes[0]);
  });

  network.on("doubleClick", (params) => {
    if (params.nodes.length === 1) drillInto(params.nodes[0]);
  });
}

// ── Views ──
function renderView(view) {
  currentView = view;
  nodesDS.clear();
  edgesDS.clear();
  document.getElementById("panel").classList.add("hidden");

  switch (view) {
    case "system":
      renderSystemView();
      break;
    case "screens":
      renderScreensView();
      break;
    case "data":
      renderDataView();
      break;
    case "flows":
      renderFlowsView();
      break;
  }

  updateLegend(view);

  setTimeout(() => {
    network.fit({ animation: { duration: 500, easingFunction: "easeInOutQuad" } });
  }, 600);
}

function renderSystemView() {
  const filtered = getFilteredData();
  const filteredScreenIds = new Set(filtered.screens.map((s) => s.id));

  // Section nodes (big clusters)
  filtered.sections.forEach((s) => {
    nodesDS.add({
      id: `section:${s.id}`,
      label: s.name.toUpperCase(),
      color: nodeColor(SECTION_COLORS[s.id] || "#475569"),
      font: { color: "#e2e8f0", size: 16, bold: { color: "#e2e8f0" } },
      size: 35,
      shape: "dot",
      borderWidth: 3,
      _type: "section",
      _data: s,
    });
  });

  // Screen nodes
  filtered.screens.forEach((s) => {
    const sectionColor = SECTION_COLORS[s.section] || "#475569";
    nodesDS.add({
      id: `screen:${s.id}`,
      label: s.name,
      color: nodeColor(sectionColor, 0.7),
      font: { color: "#94a3b8", size: 12 },
      size: 16,
      shape: "dot",
      borderWidth: 2,
      _type: "screen",
      _data: s,
    });
    edgesDS.add({
      id: `e:section-${s.section}->screen-${s.id}`,
      from: `section:${s.section}`,
      to: `screen:${s.id}`,
      color: { color: sectionColor + "33", hover: sectionColor + "66" },
      width: 1,
    });
  });

  // Entity nodes (smaller, on the outside)
  filtered.entities.forEach((e) => {
    nodesDS.add({
      id: `entity:${e.id}`,
      label: e.name,
      color: nodeColor(ENTITY_COLOR, 0.5),
      font: { color: "#64748b", size: 10 },
      size: 10,
      shape: "diamond",
      borderWidth: 1,
      _type: "entity",
      _data: e,
    });

    // Connect entities only to visible screens
    e.screens.forEach((screenId) => {
      if (!filteredScreenIds.has(screenId)) return;
      edgesDS.add({
        id: `e:entity-${e.id}->screen-${screenId}`,
        from: `entity:${e.id}`,
        to: `screen:${screenId}`,
        color: { color: ENTITY_COLOR + "15", hover: ENTITY_COLOR + "44" },
        width: 0.5,
        dashes: true,
      });
    });
  });
}

function renderScreensView() {
  const filtered = getFilteredData();

  // Group by section
  const sectionMap = {};
  filtered.screens.forEach((s) => {
    if (!sectionMap[s.section]) sectionMap[s.section] = [];
    sectionMap[s.section].push(s);
  });

  Object.entries(sectionMap).forEach(([sectionId, screens]) => {
    const color = SECTION_COLORS[sectionId] || "#475569";
    const section = filtered.sections.find((s) => s.id === sectionId);

    // Section header
    nodesDS.add({
      id: `section:${sectionId}`,
      label: (section?.name || sectionId).toUpperCase(),
      color: nodeColor(color),
      font: { color: "#e2e8f0", size: 14 },
      size: 28,
      shape: "dot",
      borderWidth: 3,
      _type: "section",
      _data: section,
    });

    // Screens with element count
    screens.forEach((s) => {
      const elCount = s.elements?.length || 0;
      const statusMark = s.status === "planned" ? " [planned]" : "";
      const accessMark = s.access === "admin" ? " *" : "";
      nodesDS.add({
        id: `screen:${s.id}`,
        label: `${s.name}${accessMark}${statusMark}\n${s.route}`,
        color: nodeColor(color, 0.7),
        font: { color: "#94a3b8", size: 11, multi: true },
        size: 14 + elCount,
        shape: "dot",
        borderWidth: 2,
        _type: "screen",
        _data: s,
      });
      edgesDS.add({
        id: `e:${sectionId}->${s.id}`,
        from: `section:${sectionId}`,
        to: `screen:${s.id}`,
        color: { color: color + "33" },
        width: 1.5,
      });
    });
  });
}

function renderDataView() {
  const filtered = getFilteredData();

  // Entity nodes
  filtered.entities.forEach((e) => {
    const fieldCount = e.fields?.length || 0;
    nodesDS.add({
      id: `entity:${e.id}`,
      label: `${e.name}\n${fieldCount} fields`,
      color: nodeColor(ENTITY_COLOR),
      font: { color: "#e2e8f0", size: 12, multi: true },
      size: 16 + fieldCount,
      shape: "dot",
      borderWidth: 2,
      _type: "entity",
      _data: e,
    });
  });

  // Relationships
  filtered.relationships.forEach((r, i) => {
    const dash = r.type === "many-to-many" ? [5, 5] : false;
    const width = r.type === "one-to-one" ? 1 : r.type === "many-to-many" ? 2 : 1.5;
    edgesDS.add({
      id: `rel:${i}`,
      from: `entity:${r.from}`,
      to: `entity:${r.to}`,
      label: r.label,
      color: { color: ENTITY_COLOR + "44", hover: ENTITY_COLOR + "88" },
      font: { color: "#475569", size: 9, strokeWidth: 0 },
      width: width,
      dashes: dash,
      arrows: { to: { enabled: true, scaleFactor: 0.5 } },
      _type: "relationship",
      _data: r,
    });
  });
}

function renderFlowsView() {
  const filtered = getFilteredData();
  if (!filtered.flows.length) return;

  filtered.flows.forEach((flow, fi) => {
    // Flow header
    nodesDS.add({
      id: `flow:${flow.id}`,
      label: flow.name.toUpperCase(),
      color: nodeColor(FLOW_COLOR),
      font: { color: "#e2e8f0", size: 14 },
      size: 25,
      shape: "dot",
      borderWidth: 3,
      _type: "flow",
      _data: flow,
    });

    // Steps as a chain
    flow.steps.forEach((stepId, si) => {
      // Find if it's a screen or entity
      const screen = manifest.screens.find((s) => s.id === stepId);
      const entity = manifest.entities.find((e) => e.id === stepId);
      const item = screen || entity;
      const isScreen = !!screen;

      const stepNodeId = `flow-step:${flow.id}:${stepId}`;
      const color = isScreen ? (SECTION_COLORS[screen.section] || "#475569") : ENTITY_COLOR;

      nodesDS.add({
        id: stepNodeId,
        label: `${si + 1}. ${item?.name || stepId}`,
        color: nodeColor(color, 0.7),
        font: { color: "#94a3b8", size: 11 },
        size: 14,
        shape: isScreen ? "dot" : "diamond",
        borderWidth: 2,
        _type: isScreen ? "screen" : "entity",
        _data: item,
      });

      // Connect to flow header
      if (si === 0) {
        edgesDS.add({
          id: `fe:${flow.id}->start`,
          from: `flow:${flow.id}`,
          to: stepNodeId,
          color: { color: FLOW_COLOR + "44" },
          width: 1.5,
        });
      }

      // Chain steps
      if (si > 0) {
        const prevId = `flow-step:${flow.id}:${flow.steps[si - 1]}`;
        edgesDS.add({
          id: `fe:${flow.id}:${si - 1}->${si}`,
          from: prevId,
          to: stepNodeId,
          color: { color: FLOW_COLOR + "55" },
          width: 2,
          arrows: { to: { enabled: true, scaleFactor: 0.6 } },
        });
      }
    });
  });
}

// ── Drill into a screen to see its elements ──
function drillInto(nodeId) {
  const node = nodesDS.get(nodeId);
  if (!node || node._type !== "screen") return;

  const screen = node._data;
  if (!screen.elements || !screen.elements.length) return;

  // Check if already drilled
  const existingEls = nodesDS.get({ filter: (n) => n.id.startsWith(`el:${screen.id}:`) });
  if (existingEls.length) {
    // Collapse - remove elements
    const elIds = existingEls.map((n) => n.id);
    const elEdges = edgesDS.get({ filter: (e) => elIds.includes(e.to) });
    edgesDS.remove(elEdges.map((e) => e.id));
    nodesDS.remove(elIds);
    return;
  }

  const sectionColor = SECTION_COLORS[screen.section] || "#475569";

  screen.elements.forEach((el, i) => {
    const elColor = ELEMENT_COLORS[el.type] || "#475569";
    const elId = `el:${screen.id}:${i}`;

    nodesDS.add({
      id: elId,
      label: el.name,
      color: nodeColor(elColor, 0.5),
      font: { color: "#64748b", size: 9 },
      size: 7,
      shape: "diamond",
      borderWidth: 1,
      _type: "element",
      _data: { ...el, screenId: screen.id, screenName: screen.name },
    });

    edgesDS.add({
      id: `ee:${screen.id}:${i}`,
      from: nodeId,
      to: elId,
      color: { color: sectionColor + "22" },
      width: 0.5,
    });
  });

  network.fit({
    nodes: [nodeId, ...screen.elements.map((_, i) => `el:${screen.id}:${i}`)],
    animation: { duration: 400 },
  });
}

// ── Panel ──
function showPanel(nodeId) {
  const node = nodesDS.get(nodeId);
  if (!node) return;

  const panel = document.getElementById("panel");
  const content = document.getElementById("panel-content");
  const title = document.getElementById("panel-title");

  panel.classList.remove("hidden");

  switch (node._type) {
    case "screen":
      renderScreenPanel(node._data, title, content);
      break;
    case "entity":
      renderEntityPanel(node._data, title, content);
      break;
    case "element":
      renderElementPanel(node._data, title, content);
      break;
    case "section":
      renderSectionPanel(node._data, title, content);
      break;
    case "flow":
      renderFlowPanel(node._data, title, content);
      break;
    default:
      title.textContent = node.label;
      content.innerHTML = "";
  }
}

function renderScreenPanel(screen, title, content) {
  title.textContent = screen.name;
  const color = SECTION_COLORS[screen.section] || "#475569";
  const section = manifest.sections.find((s) => s.id === screen.section);

  let html = `
    <div class="p-section">
      <div class="p-section-title">Screen</div>
      <div class="p-row"><span class="p-label">Route</span><span class="p-route" onclick="copyText('${screen.route}')">${screen.route}</span></div>
      <div class="p-row"><span class="p-label">Section</span><span class="p-badge" style="background:${color}22;color:${color}">${section?.name || screen.section}</span></div>
      <div class="p-row"><span class="p-label">Status</span><span class="p-value">${screen.status}</span></div>
      ${screen.access ? `<div class="p-row"><span class="p-label">Access</span><span class="p-badge" style="background:#ef444422;color:#ef4444">${screen.access} only</span></div>` : ""}
      <div class="p-row"><span class="p-label">Purpose</span><span class="p-value">${screen.description}</span></div>
    </div>
  `;

  if (screen.elements?.length) {
    html += `
      <div class="p-section">
        <div class="p-section-title">UI Elements (${screen.elements.length})</div>
        <div style="font-size:10px;color:#334155;margin-bottom:8px">Double-click the node to expand these on the graph</div>
        <ul class="el-list">
          ${screen.elements.map((el) => {
            const c = ELEMENT_COLORS[el.type] || "#475569";
            return `<li class="el-item">
              <span class="el-dot" style="background:${c}"></span>
              <div>
                <span class="el-name">${el.name}</span><span class="el-type">${el.type}</span>
                ${el.notes ? `<span class="el-notes">${el.notes}</span>` : ""}
              </div>
            </li>`;
          }).join("")}
        </ul>
      </div>
    `;
  }

  // Related entities
  const relatedEntities = manifest.entities.filter((e) => e.screens.includes(screen.id));
  if (relatedEntities.length) {
    html += `
      <div class="p-section">
        <div class="p-section-title">Data Entities</div>
        ${relatedEntities.map((e) => `<span class="screen-link" onclick="focusNode('entity:${e.id}')">${e.name}</span>`).join("")}
      </div>
    `;
  }

  content.innerHTML = html;
}

function renderEntityPanel(entity, title, content) {
  title.textContent = entity.name;

  let html = `
    <div class="p-section">
      <div class="p-section-title">Entity</div>
      <div class="p-row"><span class="p-label">Name</span><span class="p-value">${entity.name}</span></div>
      <div class="p-row"><span class="p-label">Purpose</span><span class="p-value">${entity.description}</span></div>
    </div>
  `;

  if (entity.fields?.length) {
    html += `
      <div class="p-section">
        <div class="p-section-title">Fields (${entity.fields.length})</div>
        <div class="field-chips">
          ${entity.fields.map((f) => `<span class="field-chip">${f}</span>`).join("")}
        </div>
      </div>
    `;
  }

  // Relationships involving this entity
  const rels = manifest.relationships.filter((r) => r.from === entity.id || r.to === entity.id);
  if (rels.length) {
    html += `
      <div class="p-section">
        <div class="p-section-title">Relationships</div>
        ${rels.map((r) => {
          const other = r.from === entity.id ? r.to : r.from;
          const otherEntity = manifest.entities.find((e) => e.id === other);
          const direction = r.from === entity.id ? "\u2192" : "\u2190";
          return `<div class="rel-item">
            <span class="rel-arrow">${direction}</span>
            <span class="screen-link" onclick="focusNode('entity:${other}')">${otherEntity?.name || other}</span>
            <span style="color:#475569;font-size:10px">${r.label} (${r.type})</span>
          </div>`;
        }).join("")}
      </div>
    `;
  }

  // Screens where this entity appears
  if (entity.screens?.length) {
    html += `
      <div class="p-section">
        <div class="p-section-title">Used In Screens</div>
        ${entity.screens.map((sid) => {
          const s = manifest.screens.find((sc) => sc.id === sid);
          return `<span class="screen-link" onclick="focusNode('screen:${sid}')">${s?.name || sid}</span>`;
        }).join("")}
      </div>
    `;
  }

  content.innerHTML = html;
}

function renderElementPanel(element, title, content) {
  title.textContent = element.name;
  const c = ELEMENT_COLORS[element.type] || "#475569";

  let html = `
    <div class="p-section">
      <div class="p-section-title">UI Element</div>
      <div class="p-row"><span class="p-label">Name</span><span class="p-value">${element.name}</span></div>
      <div class="p-row"><span class="p-label">Type</span><span class="p-badge" style="background:${c}22;color:${c}">${element.type}</span></div>
      <div class="p-row"><span class="p-label">Screen</span><span class="screen-link" onclick="focusNode('screen:${element.screenId}')">${element.screenName}</span></div>
      ${element.notes ? `<div class="p-row"><span class="p-label">Notes</span><span class="p-value">${element.notes}</span></div>` : ""}
    </div>
    <div class="p-section">
      <div class="p-section-title">Reference</div>
      <div class="p-row"><span class="p-value" style="color:#475569;font-size:10px">Use this name when referring to this element in prompts:<br><br><span style="color:#6366f1">"the ${element.name} on the ${element.screenName} screen"</span></span></div>
    </div>
  `;

  content.innerHTML = html;
}

function renderSectionPanel(section, title, content) {
  if (!section) return;
  title.textContent = section.name;
  const screens = manifest.screens.filter((s) => s.section === section.id);

  let html = `
    <div class="p-section">
      <div class="p-section-title">Section</div>
      <div class="p-row"><span class="p-label">Name</span><span class="p-value">${section.name}</span></div>
      <div class="p-row"><span class="p-label">Screens</span><span class="p-value">${screens.length}</span></div>
    </div>
    <div class="p-section">
      <div class="p-section-title">Screens in this section</div>
      ${screens.map((s) => {
        const accessBadge = s.access ? ` <span class="p-badge" style="background:#ef444422;color:#ef4444;font-size:8px">${s.access}</span>` : "";
        return `<div class="el-item" onclick="focusNode('screen:${s.id}')" style="cursor:pointer">
          <span class="el-dot" style="background:${SECTION_COLORS[section.id]}"></span>
          <div>
            <span class="el-name">${s.name}${accessBadge}</span>
            <span class="el-notes">${s.route}</span>
          </div>
        </div>`;
      }).join("")}
    </div>
  `;

  content.innerHTML = html;
}

function renderFlowPanel(flow, title, content) {
  title.textContent = flow.name;

  let html = `
    <div class="p-section">
      <div class="p-section-title">Flow</div>
      <div class="p-row"><span class="p-label">Name</span><span class="p-value">${flow.name}</span></div>
      <div class="p-row"><span class="p-label">Purpose</span><span class="p-value">${flow.description}</span></div>
    </div>
    <div class="p-section">
      <div class="p-section-title">Steps (${flow.steps.length})</div>
      ${flow.steps.map((stepId, i) => {
        const screen = manifest.screens.find((s) => s.id === stepId);
        const entity = manifest.entities.find((e) => e.id === stepId);
        const item = screen || entity;
        return `<div class="el-item">
          <span style="color:#a855f7;font-size:11px;min-width:18px">${i + 1}.</span>
          <div>
            <span class="el-name">${item?.name || stepId}</span>
            <span class="el-type">${screen ? "screen" : "entity"}</span>
            ${screen?.route ? `<span class="el-notes">${screen.route}</span>` : ""}
          </div>
        </div>`;
      }).join("")}
    </div>
  `;

  content.innerHTML = html;
}

// ── Helpers ──
function nodeColor(hex, opacity) {
  const o = opacity || 1;
  const alpha = Math.round(o * 40).toString(16).padStart(2, "0");
  return {
    background: hex + alpha,
    border: hex,
    highlight: { background: hex + "66", border: hex },
    hover: { background: hex + "44", border: hex },
  };
}

function focusNode(nodeId) {
  const node = nodesDS.get(nodeId);
  if (node) {
    network.selectNodes([nodeId]);
    network.focus(nodeId, { scale: 1.5, animation: { duration: 400, easingFunction: "easeInOutQuad" } });
    showPanel(nodeId);
  }
}

function copyText(text) {
  navigator.clipboard.writeText(text);
  const toast = document.getElementById("toast");
  toast.textContent = `Copied: ${text}`;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1500);
}

function updateLegend(view) {
  const legend = document.getElementById("legend");
  const filtered = getFilteredData();
  let items = [];

  if (view === "system" || view === "screens") {
    items = filtered.sections.map((s) => ({
      color: SECTION_COLORS[s.id] || "#475569",
      label: s.name,
      shape: "dot",
    }));
    if (view === "system") {
      items.push({ color: ENTITY_COLOR, label: "Entity", shape: "sq" });
    }
  } else if (view === "data") {
    items = [
      { color: ENTITY_COLOR, label: "Entity", shape: "dot" },
      { color: ENTITY_COLOR + "44", label: "1:N", shape: "line" },
      { color: ENTITY_COLOR + "44", label: "M:N (dashed)", shape: "line" },
    ];
  } else if (view === "flows") {
    items = [{ color: FLOW_COLOR, label: "Flow", shape: "dot" }];
    Object.values(SECTION_COLORS).forEach((c, i) => {
      items.push({ color: c, label: Object.keys(SECTION_COLORS)[i], shape: "dot" });
    });
  }

  legend.innerHTML = items
    .map((it) => {
      const dot = it.shape === "sq"
        ? `<span class="legend-sq" style="background:${it.color}"></span>`
        : `<span class="legend-dot" style="background:${it.color}"></span>`;
      return `<div class="legend-item">${dot}<span>${it.label}</span></div>`;
    })
    .join("");
}

// ── Controls ──
function setupControls() {
  // View buttons
  document.querySelectorAll(".view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".view-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderView(btn.dataset.view);
    });
  });

  // Project select
  document.getElementById("project-select").addEventListener("change", (e) => {
    if (e.target.value) loadProject(e.target.value);
  });

  // Section filter
  document.getElementById("section-filter").addEventListener("change", (e) => {
    currentSectionFilter = e.target.value || null;
    renderView(currentView);
  });

  // Panel close
  document.getElementById("panel-close").addEventListener("click", () => {
    document.getElementById("panel").classList.add("hidden");
  });

  // Refresh - reload manifest from disk
  document.getElementById("btn-refresh").addEventListener("click", async () => {
    const select = document.getElementById("project-select");
    if (select.value) {
      await loadProject(select.value);
      const toast = document.getElementById("toast");
      toast.textContent = "Manifest reloaded from disk";
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 1500);
    }
  });

  // Regenerate - call server to rebuild manifest
  document.getElementById("btn-regenerate")?.addEventListener("click", async () => {
    const select = document.getElementById("project-select");
    if (!select.value) return;
    const overlay = document.getElementById("loading-overlay");
    const loadingText = overlay.querySelector(".loading-text");
    loadingText.textContent = "Regenerating manifest...";
    overlay.classList.remove("hidden");

    try {
      const res = await fetch(`/api/regenerate/${select.value}`, { method: "POST" });
      const result = await res.json();
      if (result.success) {
        await loadProject(select.value);
        const toast = document.getElementById("toast");
        toast.textContent = "Manifest regenerated";
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 1500);
      } else {
        const toast = document.getElementById("toast");
        toast.textContent = result.error || "Regeneration failed";
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 2500);
      }
    } finally {
      loadingText.textContent = "Loading project...";
      overlay.classList.add("hidden");
    }
  });

  // Search
  let debounce = null;
  document.getElementById("search").addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const q = e.target.value.toLowerCase().trim();
      if (!q) {
        nodesDS.forEach((n) => nodesDS.update({ id: n.id, opacity: 1, font: { ...n.font, color: n.font?.color || "#cbd5e1" } }));
        return;
      }
      nodesDS.forEach((n) => {
        const text = (n.label || "").toLowerCase();
        const match = text.includes(q);
        nodesDS.update({ id: n.id, opacity: match ? 1 : 0.12 });
      });
    }, 150);
  });
}

// Go
init();
