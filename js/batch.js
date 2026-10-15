// A file belongs to exactly one of: current batch, waiting queue, or deferred review.
function getAllReviewFiles() {
  return [...downloadFiles, ...queuedDownloadFiles, ...deferredDownloadFiles];
}

function resetBatchState() {
  downloadFiles = [];
  queuedDownloadFiles = [];
  deferredDownloadFiles = [];
  selectedReviewName = "";
  reviewSelections = new Set();
  batchNumber = 1;
  batchInitialized = false;
}

function serializeBatchFiles() {
  return [["current", downloadFiles], ["queued", queuedDownloadFiles], ["deferred", deferredDownloadFiles]]
    .flatMap(([role, files]) => files.filter(file => !file.completed).map(file => ({
      name: file.name, size: file.size, lastModified: file.lastModified, role,
      deferredReason: file.deferredReason || "",
      ...Object.fromEntries(REVIEW_FIELDS.map(field => [field, file[field]]))
    })));
}

function normalizeReviewDraft(draft) {
  if (!draft || ![1, 2].includes(draft.version) || !Array.isArray(draft.files)) {
    throw new Error("지원하지 않는 검토 저장 형식입니다. 저장 내용을 덮어쓰지 않습니다.");
  }
  const names = new Set();
  const files = draft.files.map((file, index) => {
    if (typeof file.name !== "string" || names.has(file.name)) throw new Error("복구본의 파일 목록을 확인할 수 없습니다.");
    names.add(file.name);
    const role = draft.version === 1 ? (index < BATCH_LIMIT ? "current" : "queued") : file.role;
    if (!["current", "queued", "deferred"].includes(role)) throw new Error("복구본의 작업 묶음 정보가 올바르지 않습니다.");
    return { ...file, role, specialFolderKey: "singles" };
  });
  if (files.filter(file => file.role === "current").length > BATCH_LIMIT) throw new Error("저장된 작업 묶음이 100개를 초과합니다.");
  return { ...draft, files };
}

function restoreBatchMembership(records, draft) {
  const byName = new Map(records.map(file => [file.name, file]));
  downloadFiles = []; queuedDownloadFiles = []; deferredDownloadFiles = [];
  for (const saved of draft.files) {
    const file = byName.get(saved.name);
    if (!file) continue;
    const target = saved.role === "current" ? downloadFiles : saved.role === "queued" ? queuedDownloadFiles : deferredDownloadFiles;
    file.deferredReason = saved.role === "deferred" ? (saved.deferredReason || "보류") : "";
    target.push(file);
    byName.delete(saved.name);
  }
  queuedDownloadFiles.push(...byName.values());
  batchNumber = Number.isInteger(draft.batchNumber) && draft.batchNumber > 0 ? draft.batchNumber : 1;
  selectedReviewName = downloadFiles.some(file => file.name === draft.selectedReviewName) ? draft.selectedReviewName : (downloadFiles[0]?.name || "");
  reviewSelections = new Set((Array.isArray(draft.selections) ? draft.selections : []).filter(name => downloadFiles.some(file => file.name === name)));
  batchInitialized = true;
  setActiveView(draft.view === "library" ? "library" : "organize");
}

function finishCurrentBatch() {
  for (const file of downloadFiles.filter(file => !file.completed)) {
    file.deferredReason = file.excluded ? "이번 묶음에서 제외" : (file.analysis.message || "보류");
    deferredDownloadFiles.push(file);
  }
  downloadFiles = [];
  selectedReviewName = "";
  reviewSelections.clear();
}

async function startNextBatch(fromDeferred = false) {
  if (operationBusy || downloadFiles.length) return;
  setOperationBusy(true);
  try {
    await saveReviewDraft();
    await reloadDownloadData();
    const source = fromDeferred ? deferredDownloadFiles : queuedDownloadFiles;
    if (!source.length) return;
    downloadFiles = source.splice(0, BATCH_LIMIT);
    for (const file of downloadFiles) {
      file.completed = false;
      file.deferredReason = "";
      if (fromDeferred) file.excluded = false;
      file.analysis = { action: "unchecked", message: "", matchPath: "" };
      file.specialFolderKey = "singles";
    }
    batchNumber++;
    selectedReviewName = downloadFiles[0]?.name || "";
    reviewSelections.clear();
    applyRememberedConnectionsToEmptyFiles();
    invalidateDuplicateCheck();
    renderDownloadFileList();
    renderSortingRows();
    scheduleDraftSave();
    await saveReviewDraft();
  } catch (error) {
    executeStatus.textContent = `다음 작업을 시작하지 못했습니다: ${error.message}`;
  } finally { setOperationBusy(false); updateBatchControls(); }
}

async function deferCurrentBatch() {
  if (operationBusy || !downloadFiles.length) return;
  const previous = {
    files: downloadFiles, deferred: [...deferredDownloadFiles], name: selectedReviewName,
    selections: new Set(reviewSelections), reasons: downloadFiles.map(file => file.deferredReason)
  };
  setOperationBusy(true);
  try {
    await saveReviewDraft();
    finishCurrentBatch();
    scheduleDraftSave();
    await saveReviewDraft();
    duplicateCheckComplete = false;
    executeStatus.textContent = '현재 묶음을 보류했습니다. 실제 파일은 그대로 남아 있습니다.';
  } catch (error) {
    downloadFiles = previous.files; deferredDownloadFiles = previous.deferred;
    selectedReviewName = previous.name; reviewSelections = previous.selections;
    downloadFiles.forEach((file, index) => file.deferredReason = previous.reasons[index]);
    executeStatus.textContent = `묶음을 보류하지 못했습니다: ${error.message}`;
  } finally {
    renderDownloadFileList(); renderSortingRows(); setOperationBusy(false);
  }
}

function initializeBatchControls() {
  document.getElementById("nextBatchButton").addEventListener("click", () => startNextBatch());
  document.getElementById("deferBatchButton").addEventListener("click", deferCurrentBatch);
  document.getElementById("reviewDeferredButton").addEventListener("click", () => startNextBatch(true));
  document.getElementById("selectAllReviewFiles").addEventListener("change", event => {
    reviewSelections = event.target.checked ? new Set(downloadFiles.map(file => file.name)) : new Set();
    renderReviewFileList(); scheduleDraftSave();
  });
  document.getElementById("applyBulkDesignerButton").addEventListener("click", () => {
    const designer = document.getElementById("bulkDesignerInput").value.trim();
    if (!designer || !reviewSelections.size || operationBusy) return;
    const folder = designerFolders.find(name => normalizeText(name) === normalizeText(designer));
    for (const file of downloadFiles.filter(file => reviewSelections.has(file.name) && !file.excluded)) {
      file.destinationName = folder || designer;
      file.selectedFolder = folder || null;
      file.autoLinkedAlias = "";
      if (!file.sourceDesignerTouched) {
        const alias = findMatchingRememberedAlias(file.name);
        file.sourceDesignerName = alias && alias.folderName === folder ? alias.alias : designer;
      }
      if (!file.patternManuallyEdited) file.patternFileName = suggestPatternFileName(file.name, file.sourceDesignerName);
    }
    invalidateDuplicateCheck(); renderSortingRows();
  });
  for (const [id, excluded] of [["excludeSelectedButton", true], ["includeSelectedButton", false]]) {
    document.getElementById(id).addEventListener("click", () => {
      if (operationBusy) return;
      for (const file of downloadFiles.filter(file => reviewSelections.has(file.name))) file.excluded = excluded;
      invalidateDuplicateCheck(); renderSortingRows();
    });
  }
}

function selectReviewFile(name) {
  if (!downloadFiles.some(file => file.name === name)) return;
  selectedReviewName = name;
  renderSortingRows();
  document.querySelector('.review-file-button[aria-current="true"]')?.focus({ preventScroll: true });
  scheduleDraftSave();
}

function reviewStatus(file) {
  if (file.excluded) return "제외";
  if (!file.destinationName.trim() || !ensurePdfExtension(file.patternFileName.trim())) return "입력 필요";
  return { move: "이동 예정", hold: "보류", deleteDuplicate: "중복 삭제" }[file.analysis.action] || "검사 전";
}

function renderReviewFileList() {
  const list = document.getElementById("reviewFileList");
  const previousScroll = list.scrollTop;
  list.replaceChildren();
  if (!downloadFiles.length) list.innerHTML = '<p class="empty">현재 묶음이 끝났습니다. 다음 묶음을 열거나 보류 파일을 다시 검토하세요.</p>';
  for (const file of downloadFiles) {
    const row = document.createElement("div");
    row.className = "review-list-row" + (file.name === selectedReviewName ? " selected" : "");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox"; checkbox.checked = reviewSelections.has(file.name);
    checkbox.setAttribute("aria-label", `${file.name} 일괄 작업 선택`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) reviewSelections.add(file.name); else reviewSelections.delete(file.name);
      updateBatchControls(); scheduleDraftSave();
    });
    const button = document.createElement("button");
    button.type = "button"; button.className = "review-file-button";
    button.setAttribute("aria-current", String(file.name === selectedReviewName));
    const name = document.createElement("span"); name.className = "review-file-name"; name.textContent = file.name;
    const designer = document.createElement("span"); designer.className = "review-file-designer"; designer.textContent = file.destinationName || "디자이너 미지정";
    const status = document.createElement("span"); status.className = "review-file-status"; status.textContent = reviewStatus(file);
    file.listDesignerElement = designer; file.listStatusElement = status;
    button.append(name, designer, status);
    button.addEventListener("click", () => selectReviewFile(file.name));
    button.addEventListener("keydown", event => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      const index = downloadFiles.indexOf(file) + (event.key === "ArrowDown" ? 1 : -1);
      if (downloadFiles[index]) {
        selectReviewFile(downloadFiles[index].name);
        list.querySelectorAll(".review-file-button")[index]?.focus();
      }
    });
    row.append(checkbox, button); list.append(row);
  }
  list.scrollTop = previousScroll;
  updateBatchControls();
}

function updateBatchControls() {
  document.getElementById("batchTitle").textContent = `작업 묶음 ${batchNumber}`;
  document.getElementById("batchSummary").textContent = `현재 ${downloadFiles.length}개 · 대기 ${queuedDownloadFiles.length}개 · 보류·제외 ${deferredDownloadFiles.length}개`;
  const count = reviewSelections.size;
  document.getElementById("reviewSelectionCount").textContent = `선택 ${count}개`;
  const all = document.getElementById("selectAllReviewFiles");
  all.checked = Boolean(downloadFiles.length) && count === downloadFiles.length;
  all.indeterminate = count > 0 && count < downloadFiles.length;
  if (!operationBusy) {
    all.disabled = !downloadFiles.length;
    document.getElementById("nextBatchButton").disabled = Boolean(downloadFiles.length) || !queuedDownloadFiles.length;
    document.getElementById("deferBatchButton").disabled = !downloadFiles.length;
    document.getElementById("reviewDeferredButton").disabled = Boolean(downloadFiles.length) || !deferredDownloadFiles.length;
    duplicateCheckButton.disabled = !downloadFiles.length;
    executeButton.disabled = !downloadFiles.length;
    document.getElementById("applyBulkDesignerButton").disabled = !count;
    document.getElementById("excludeSelectedButton").disabled = !count;
    document.getElementById("includeSelectedButton").disabled = !count;
    document.getElementById("applyBulkCategoriesButton").disabled = !count;
  }
  const deferredPanel = document.getElementById("deferredPanel");
  deferredPanel.classList.toggle("hidden", !deferredDownloadFiles.length);
  document.getElementById("deferredCount").textContent = `(${deferredDownloadFiles.length}개)`;
  const deferredList = document.getElementById("deferredFileList");
  deferredList.replaceChildren();
  for (const file of deferredDownloadFiles.slice(0, 20)) {
    const item = document.createElement("div"); item.className = "deferred-file";
    item.textContent = `${file.name} — ${file.deferredReason || "보류"}`; deferredList.append(item);
  }
  if (deferredDownloadFiles.length > 20) {
    const more = document.createElement("p"); more.className = "note"; more.textContent = `외 ${deferredDownloadFiles.length - 20}개 · 다시 검토는 최대 100개씩 열립니다.`; deferredList.append(more);
  }
}

function assertBatchLimit() {
  if (downloadFiles.length > BATCH_LIMIT) throw new Error("한 번에 최대 100개만 정리할 수 있습니다.");
}
