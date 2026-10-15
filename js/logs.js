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
      `<p class="empty">아직 작업 로그가 없습니다.</p>`;
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
      log.status === "failed" ? "실행 실패" : "정리 완료";

    header.appendChild(date);
    header.appendChild(result);

    const summary = document.createElement("div");
    summary.className = "log-summary";
    summary.textContent =
      `이동 ${moved.length}개 / 중복 삭제 ${deleted.length}개 / 보류 ${held.length}개 / 제외 ${excluded.length}개`;

    entry.appendChild(header);
    entry.appendChild(summary);

    if (deleted.length > 0) {
      const section = createLogSection("중복 삭제", "deleted");

      deleted.forEach((item) => {
        const line = document.createElement("div");
        line.className = "log-line deleted";
        line.textContent =
          `삭제: ${item.file} → 동일 파일: ${item.sameAs}`;
        section.appendChild(line);
      });

      entry.appendChild(section);
    }

    if (createdFolders.length > 0) {
      const section = createLogSection("새 폴더 생성");

      createdFolders.forEach((folderName) => {
        const line = document.createElement("div");
        line.className = "log-line";
        line.textContent = folderName;
        section.appendChild(line);
      });

      entry.appendChild(section);
    }

    if (moved.length > 0) {
      const section = createLogSection("이동");

      moved.forEach((item) => {
        const line = document.createElement("div");
        line.className = "log-line";
        line.textContent = `${item.from} → ${item.to}`;
        section.appendChild(line);
      });

      entry.appendChild(section);
    }

    if (held.length > 0) {
      const section = createLogSection("보류");

      held.forEach((item) => {
        const line = document.createElement("div");
        line.className = "log-line";
        line.textContent = `${item.file} — ${item.reason}`;
        section.appendChild(line);
      });

      entry.appendChild(section);
    }

    if (excluded.length > 0) {
      const section = createLogSection("이번 작업에서 제외");

      excluded.forEach((fileName) => {
        const line = document.createElement("div");
        line.className = "log-line";
        line.textContent = `${fileName} — 다운로드 폴더에 남김`;
        section.appendChild(line);
      });

      entry.appendChild(section);
    }

    if (log.error) {
      const errorBox = document.createElement("div");
      errorBox.className = "log-error";
      errorBox.textContent = `오류: ${log.error}`;
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
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(timestamp));
}
