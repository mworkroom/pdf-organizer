// Shared application state is initialized in app.js after these function definitions load.

function loadActionLogs() {
  try {
    return JSON.parse(localStorage.getItem(LOG_STORAGE_KEY)) || [];
  } catch (error) {
    return [];
  }
}

function saveActionLogs() {
  localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(actionLogs));
  renderActionLogs();
}

function addActionLog(log) {
  actionLogs.unshift(log);
  actionLogs = actionLogs.slice(0, MAX_LOG_ENTRIES);
  saveActionLogs();
}

function createExecutionLog() {
  return {
    timestamp: new Date().toISOString(),
    status: "pending",
    createdFolders: [],
    moved: [],
    deleted: [],
    held: downloadFiles
      .filter((file) => file.analysis.action === "hold")
      .map((file) => ({
        file: file.name,
        reason: file.analysis.message
      })),
    excluded: downloadFiles
      .filter((file) => file.excluded)
      .map((file) => file.name),
    error: ""
  };
}

function renderActionLogs() {
  logList.innerHTML = "";

  if (actionLogs.length === 0) {
    logList.innerHTML =
      `<p class="empty">No activity logs yet.</p>`;
    return;
  }

  actionLogs.forEach((log) => {
    const moved = log.moved || [];
    const deleted = log.deleted || [];
    const held = log.held || [];
    const excluded = log.excluded || [];
    const createdFolders = log.createdFolders || [];

    const entry = document.createElement("div");
    entry.className =
      log.status === "failed" ? "log-entry failed" : "log-entry";

    const header = document.createElement("div");
    header.className = "log-entry-header";

    const date = document.createElement("div");
    date.textContent = formatLogTimestamp(log.timestamp);

    const result = document.createElement("div");
    result.className =
      log.status === "failed" ? "log-result failed" : "log-result";
    result.textContent =
      log.status === "failed" ? "Run failed" : "Organization complete";

    header.appendChild(date);
    header.appendChild(result);

    const summary = document.createElement("div");
    summary.className = "log-summary";
    summary.textContent =
      `${moved.length} moved / ${deleted.length} duplicates deleted / ${held.length} on hold / ${excluded.length} excluded`;

    entry.appendChild(header);
    entry.appendChild(summary);

    if (deleted.length > 0) {
      const section = createLogSection("Duplicates deleted", "deleted");

      deleted.forEach((item) => {
        const line = document.createElement("div");
        line.className = "log-line deleted";
        line.textContent =
          `Deleted: ${item.file} → Identical file: ${item.sameAs}`;
        section.appendChild(line);
      });

      entry.appendChild(section);
    }

    if (createdFolders.length > 0) {
      const section = createLogSection("Folders created");

      createdFolders.forEach((folderName) => {
        const line = document.createElement("div");
        line.className = "log-line";
        line.textContent = folderName;
        section.appendChild(line);
      });

      entry.appendChild(section);
    }

    if (moved.length > 0) {
      const section = createLogSection("Moved");

      moved.forEach((item) => {
        const line = document.createElement("div");
        line.className = "log-line";
        line.textContent = `${item.from} → ${item.to}`;
        section.appendChild(line);
      });

      entry.appendChild(section);
    }

    if (held.length > 0) {
      const section = createLogSection("On hold");

      held.forEach((item) => {
        const line = document.createElement("div");
        line.className = "log-line";
        line.textContent = `${item.file} — ${item.reason}`;
        section.appendChild(line);
      });

      entry.appendChild(section);
    }

    if (excluded.length > 0) {
      const section = createLogSection("Excluded from this run");

      excluded.forEach((fileName) => {
        const line = document.createElement("div");
        line.className = "log-line";
        line.textContent = `${fileName} — Left in download folder`;
        section.appendChild(line);
      });

      entry.appendChild(section);
    }

    if (log.error) {
      const errorBox = document.createElement("div");
      errorBox.className = "log-error";
      errorBox.textContent = `Error: ${log.error}`;
      entry.appendChild(errorBox);
    }

    logList.appendChild(entry);
  });
}

function createLogSection(title, extraClass = "") {
  const section = document.createElement("div");
  section.className = "log-section";

  const heading = document.createElement("div");
  heading.className =
    extraClass
      ? `log-section-title ${extraClass}`
      : "log-section-title";
  heading.textContent = title;

  section.appendChild(heading);

  return section;
}

function formatLogTimestamp(timestamp) {
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(timestamp));
}
