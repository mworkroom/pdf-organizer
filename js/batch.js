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
    throw new Error("Unsupported review format. Saved data will not be overwritten.");
  }
  if(draft.attributes!==undefined)CatalogModel.validateAttributes(draft.attributes);
  const names = new Set();
  const files = draft.files.map((file, index) => {
    if (typeof file.name !== "string" || names.has(file.name)) throw new Error("The file list in the saved review is invalid.");
    if(file.attributeIds!==undefined&&(!Array.isArray(file.attributeIds)||CatalogModel.attributeIds(file.attributeIds,draft.attributes).length!==file.attributeIds.length))throw new Error('The attributes in the saved review are invalid. Saved data will not be overwritten.');
    names.add(file.name);
    const role = draft.version === 1 ? (index < BATCH_LIMIT ? "current" : "queued") : file.role;
    if (!["current", "queued", "deferred"].includes(role)) throw new Error("The batch information in the saved review is invalid.");
    return { ...file, role, specialFolderKey: "singles" };
  });
  if (files.filter(file => file.role === "current").length > BATCH_LIMIT) throw new Error("The saved batch exceeds 100 files.");
  return { ...draft, files };
}

function restoreBatchMembership(records, draft) {
  const byName = new Map(records.map(file => [file.name, file]));
  downloadFiles = []; queuedDownloadFiles = []; deferredDownloadFiles = [];
  for (const saved of draft.files) {
    const file = byName.get(saved.name);
    if (!file) continue;
    const target = saved.role === "current" ? downloadFiles : saved.role === "queued" ? queuedDownloadFiles : deferredDownloadFiles;
    file.deferredReason = saved.role === "deferred" ? (saved.deferredReason || "On hold") : "";
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
    file.deferredReason = file.excluded ? "Excluded from this batch" : (file.analysis.message || "On hold");
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
    await reloadDownloadData({startBatch:false});
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
    executeStatus.textContent = `Could not start the next batch: ${error.message}`;
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
    executeStatus.textContent = 'Batch deferred. Files remain in their original locations.';
  } catch (error) {
    downloadFiles = previous.files; deferredDownloadFiles = previous.deferred;
    selectedReviewName = previous.name; reviewSelections = previous.selections;
    downloadFiles.forEach((file, index) => file.deferredReason = previous.reasons[index]);
    executeStatus.textContent = `Could not defer the batch: ${error.message}`;
  } finally {
    renderDownloadFileList(); renderSortingRows(); setOperationBusy(false);
  }
}

function initializeBatchControls() {
  document.getElementById("nextBatchButton").addEventListener("click", () => startNextBatch());
  document.getElementById("deferBatchButton").addEventListener("click", deferCurrentBatch);
  document.getElementById("reviewDeferredButton").addEventListener("click", () => startNextBatch(true));
}

function selectReviewFile(name) {
  if (!downloadFiles.some(file => file.name === name)) return;
  selectedReviewName = name;
  scheduleDraftSave();
}

function updateBatchControls() {
  document.getElementById("batchTitle").textContent = `Batch ${batchNumber}`;
  document.getElementById("batchSummary").textContent = `Current: ${downloadFiles.length} · Queued: ${queuedDownloadFiles.length} · Deferred/excluded: ${deferredDownloadFiles.length}`;
  if (!operationBusy) {
    document.getElementById("nextBatchButton").textContent = queuedDownloadFiles.length?`Review next ${Math.min(BATCH_LIMIT,queuedDownloadFiles.length)}`:'No queued files';
    document.getElementById("nextBatchButton").disabled = Boolean(downloadFiles.length) || !queuedDownloadFiles.length;
    document.getElementById("deferBatchButton").disabled = !downloadFiles.length;
    document.getElementById("reviewDeferredButton").disabled = Boolean(downloadFiles.length) || !deferredDownloadFiles.length;
    duplicateCheckButton.disabled = !downloadFiles.length;
    executeButton.disabled = !downloadFiles.length;
  }
  const deferredPanel = document.getElementById("deferredPanel");
  deferredPanel.classList.toggle("hidden", !deferredDownloadFiles.length);
  document.getElementById("deferredCount").textContent = `(${deferredDownloadFiles.length})`;
  const deferredList = document.getElementById("deferredFileList");
  deferredList.replaceChildren();
  for (const file of deferredDownloadFiles.slice(0, 20)) {
    const item = document.createElement("div"); item.className = "deferred-file";
    item.textContent = `${file.name} — ${file.deferredReason || "On hold"}`; deferredList.append(item);
  }
  if (deferredDownloadFiles.length > 20) {
    const more = document.createElement("p"); more.className = "note"; more.textContent = `${deferredDownloadFiles.length - 20} more. Review up to 100 files at a time.`; deferredList.append(more);
  }
}

function assertBatchLimit() {
  if (downloadFiles.length > BATCH_LIMIT) throw new Error("Up to 100 files can be organized at a time.");
}
