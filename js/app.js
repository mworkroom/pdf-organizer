const SINGLES_FOLDER_NAME = "!zz_Singles";

const SPECIAL_FOLDER_OPTIONS = { singles: { label: 'Singles', folderName: SINGLES_FOLDER_NAME } };
const BATCH_LIMIT = 100;
let queuedDownloadFiles = [];
let deferredDownloadFiles = [];
let selectedReviewName = '';
let reviewSelections = new Set(); // Retained for compatibility with saved v2 review drafts.
let batchNumber = 1;
let batchInitialized = false;
let activeView = 'organize';

const ALIAS_STORAGE_KEY = "pdfOrganizerDesignerAliasesV1";
const ALIAS_BACKUP_FILE_NAME = "!pdf-organizer-designer-aliases.json";
const LOG_STORAGE_KEY = "pdfOrganizerActionLogsV1";
const MAX_LOG_ENTRIES = 50;

const selectDownloadFolderButton = document.getElementById("selectDownloadFolderButton");
const downloadFolderName = document.getElementById("downloadFolderName");
const downloadFileCount = document.getElementById("downloadFileCount");
const downloadFileList = document.getElementById("downloadFileList");

const selectLibraryFolderButton = document.getElementById("selectLibraryFolderButton");
const libraryFolderName = document.getElementById("libraryFolderName");
const designerFolderCount = document.getElementById("designerFolderCount");
const singlesFileCount = document.getElementById("singlesFileCount");
const designerSearch = document.getElementById("designerSearch");
const designerFolderList = document.getElementById("designerFolderList");

const aliasCount = document.getElementById("aliasCount");
const aliasList = document.getElementById("aliasList");
const aliasBox = document.getElementById("aliasBox");
const aliasToggleButton = document.getElementById("aliasToggleButton");
const exportAliasesButton = document.getElementById("exportAliasesButton");
const importAliasesButton = document.getElementById("importAliasesButton");
const importAliasesInput = document.getElementById("importAliasesInput");

const sortingPanel = document.getElementById("sortingPanel");
const sortingList = document.getElementById("sortingList");
const duplicateCheckButton = document.getElementById("duplicateCheckButton");
const executeButton = document.getElementById("executeButton");
const executeStatus = document.getElementById("executeStatus");

const clearLogButton = document.getElementById("clearLogButton");
const logList = document.getElementById("logList");

let downloadDirectoryHandle = null;
let libraryDirectoryHandle = null;
let singlesDirectoryHandle = null;

let downloadFiles = [];
let designerFolders = [];
let singlesPdfNames = [];

let designerAliases = loadDesignerAliases();
let actionLogs = loadActionLogs();

let duplicateCheckComplete = false;
let digestCache = new Map();
let operationBusy = false;
let draftLockedElsewhere = false;
let duplicateCheckController = null;
let checkFiles = new Map();
let checkedFileSignatures = new Map();
const digestKeys = new WeakMap();
let checkProgress = { completed: 0, total: 0, reads: 0 };
let pendingDraft = null;
let draftTimer;
let draftRevision = 0;
let savedDraftRevision = 0;
let draftSaveChain = Promise.resolve();
let suppressDraftSave = false;
const draftSaveStatus = document.getElementById("draftSaveStatus");
const retryDraftSaveButton = document.getElementById("retryDraftSaveButton");
const draftRecovery = document.getElementById("draftRecovery");
const restoreDraftButton = document.getElementById("restoreDraftButton");
const cancelDuplicateCheckButton = document.getElementById("cancelDuplicateCheckButton");
const REVIEW_FIELDS = ["excluded", "destinationName", "selectedFolder",
  "sourceDesignerName", "sourceDesignerTouched", "patternFileName",
  "patternManuallyEdited", "autoLinkedAlias", "specialFolderKey", "patternId", "categoryIds", "categorySource"];
const draftReady = initializeDraft();

retryDraftSaveButton.addEventListener("click", () => saveReviewDraft().catch(() => {}));
restoreDraftButton.addEventListener("click", restoreReviewDraft);
cancelDuplicateCheckButton.addEventListener("click", () => {
  duplicateCheckController?.abort();
  cancelDuplicateCheckButton.disabled = true;
  executeStatus.textContent = "Canceling after the current file finishes...";
});
window.addEventListener("beforeunload", event => {
  if (!draftLockedElsewhere && (draftRevision !== savedDraftRevision || operationBusy || categoryEditorDirty || libraryCategoryDrafts.size || libraryPageDrafts.size)) {
    event.preventDefault();
    event.returnValue = "";
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && draftRevision !== savedDraftRevision) {
    saveReviewDraft().catch(() => {});
  }
});

renderAliasList();
renderActionLogs();

aliasToggleButton.addEventListener("click", () => {
  const collapsed = aliasBox.classList.toggle("collapsed");
  aliasToggleButton.textContent = collapsed ? "Expand" : "Collapse";
});

exportAliasesButton.addEventListener("click", exportDesignerAliases);

importAliasesButton.addEventListener("click", () => {
  importAliasesInput.value = "";
  importAliasesInput.click();
});

importAliasesInput.addEventListener("change", async () => {
  const file = importAliasesInput.files?.[0];
  if (!file) return;

  try {
    const imported = JSON.parse(await file.text());
    if (!imported || typeof imported !== "object" || Array.isArray(imported)) {
      throw new Error("Invalid alias file format.");
    }

    designerAliases = { ...designerAliases, ...imported };
    saveDesignerAliases();
    applyRememberedConnectionsToEmptyFiles();
    renderSortingRows();
    alert(`Aliases imported. Total: ${Object.keys(designerAliases).length}.`);
  } catch (error) {
    alert(`Could not import aliases.\n\n${error.message}`);
  }
});

selectDownloadFolderButton.addEventListener("click", async () => {
  let started = false;
  let previous;
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await draftReady;
    previous = captureFolderReview();
    setOperationBusy(true);
    started = true;
    if (!await prepareFolderChange(handle, downloadDirectoryHandle)) return;
    await assertSeparateFolders(handle,libraryDirectoryHandle);
    const sameFolder = downloadDirectoryHandle && await downloadDirectoryHandle.isSameEntry(handle);
    if (!sameFolder) { resetBatchState(); digestCache.clear(); }
    downloadDirectoryHandle = handle;

    downloadFolderName.textContent = `Selected folder: ${downloadDirectoryHandle.name}`;

    await reloadDownloadData();
    executeStatus.className = 'execute-status';
    executeStatus.textContent = '';
    scheduleDraftSave();
    await saveReviewDraft();

  } catch (error) {
    if (previous) restoreFolderReview(previous);
    if (error.name !== "AbortError") {
      alert(`Could not connect the download folder.\n\n${error.message}`);
      console.error(error);
    }
  } finally {
    if (started) setOperationBusy(false);
  }
});

selectLibraryFolderButton.addEventListener("click", async () => {
  let started = false;
  let previous;
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await draftReady;
    previous = captureFolderReview();
    setOperationBusy(true);
    started = true;
    if (!await prepareFolderChange(handle, libraryDirectoryHandle)) return;
    await assertSeparateFolders(downloadDirectoryHandle,handle);
    const changedFolder = libraryDirectoryHandle && !await libraryDirectoryHandle.isSameEntry(handle);
    if (changedFolder) {
      digestCache.clear();
      getAllReviewFiles().forEach(file => { file.selectedFolder = null; file.autoLinkedAlias = ""; });
    }
    libraryDirectoryHandle = handle;

    libraryFolderName.textContent = `Selected folder: ${libraryDirectoryHandle.name}`;
    designerSearch.value = "";

    await reloadLibraryData();
    await loadDesignerAliasesFromLibrary();

    applyRememberedConnectionsToEmptyFiles();
    invalidateDuplicateCheck();

    renderDesignerFolders(designerFolders);
    renderSortingRows();
    scheduleDraftSave();
    await saveReviewDraft();

  } catch (error) {
    if (previous) restoreFolderReview(previous);
    if (error.name !== "AbortError") {
      alert(`Could not connect the pattern folder.\n\n${error.message}`);
      console.error(error);
    }
  } finally {
    if (started) setOperationBusy(false);
  }
});

designerSearch.addEventListener("input", () => {
  const keyword = normalizeText(designerSearch.value);

  const filteredFolders = designerFolders.filter((folderName) =>
    normalizeText(folderName).includes(keyword)
  );

  renderDesignerFolders(filteredFolders);
});

clearLogButton.addEventListener("click", () => {
  if (actionLogs.length === 0) {
    return;
  }

  const confirmed = window.confirm("Clear all activity logs?");

  if (!confirmed) {
    return;
  }

  actionLogs = [];
  saveActionLogs();
});

duplicateCheckButton.addEventListener("click", async () => {
  if (!downloadDirectoryHandle || !libraryDirectoryHandle) {
    alert("Select the download and pattern folders first.");
    return;
  }

  if (categoryEditorDirty || libraryCategoryDrafts.size || libraryPageDrafts.size) {
    alert('Save or cancel category and cover page edits in Pattern Library first.');
    setActiveView('library');
    return;
  }

  const activeFiles = downloadFiles.filter((file) => !file.excluded);

  if (activeFiles.length === 0) {
    alert("No PDFs to check.");
    return;
  }

  if (!validateCompletenessAndFocus()) {
    return;
  }

  setOperationBusy(true);
  duplicateCheckComplete = false;
  duplicateCheckController = new AbortController();
  cancelDuplicateCheckButton.disabled = false;
  cancelDuplicateCheckButton.classList.remove("hidden");
  executeStatus.className = "execute-status";
  executeStatus.textContent = "Checking for duplicate files...";

  try {
    await saveReviewDraft();
    await analyseAllDuplicates();
    throwIfCheckCancelled();

    duplicateCheckComplete = true;
    updateAllPreviews();

    const duplicateCount = downloadFiles.filter(
      (file) => file.analysis.action === "deleteDuplicate"
    ).length;

    const holdCount = downloadFiles.filter(
      (file) => file.analysis.action === "hold"
    ).length;

    const moveCount = downloadFiles.filter(
      (file) => file.analysis.action === "move"
    ).length;

    const excludedCount = downloadFiles.filter(
      (file) => file.excluded
    ).length;

    executeStatus.textContent =
      `Duplicate check complete: ${moveCount} to move / ${duplicateCount} exact duplicates to delete / ${holdCount} on hold / ${excludedCount} excluded`;

  } catch (error) {
    downloadFiles.forEach(file => {
      file.analysis = { action: file.excluded ? "excluded" : "unchecked", message: "", matchPath: "" };
    });
    duplicateCheckComplete = false;
    updateAllPreviews();
    if (error.name === "AbortError") {
      executeStatus.textContent = "Duplicate check canceled. Reviews are preserved. Run the check again before organizing.";
      return;
    }
    console.error(error);
    executeStatus.className = "execute-status error";
    executeStatus.textContent = `Duplicate check failed: ${error.message}`;
    alert(`An error occurred while checking duplicates.\n\n${error.message}`);
  } finally {
    duplicateCheckController = null;
    checkFiles.clear();
    cancelDuplicateCheckButton.classList.add("hidden");
    setOperationBusy(false);
  }
});

executeButton.addEventListener("click", async () => {
  executeStatus.className = "execute-status";

  if (!downloadDirectoryHandle || !libraryDirectoryHandle) {
    alert("Select the download and pattern folders first.");
    return;
  }

  if (categoryEditorDirty || libraryCategoryDrafts.size || libraryPageDrafts.size) {
    alert('Save or cancel category and cover page edits in Pattern Library first.');
    setActiveView('library');
    return;
  }

  const activeFiles = downloadFiles.filter((file) => !file.excluded);

  if (activeFiles.length === 0) {
    alert("No PDFs to organize.");
    return;
  }

  if (!validateCompletenessAndFocus()) {
    return;
  }

  if (!duplicateCheckComplete) {
    alert("Check duplicates before organizing files.");
    return;
  }

  const moveCount = downloadFiles.filter(
    (file) => file.analysis.action === "move"
  ).length;

  const duplicateCount = downloadFiles.filter(
    (file) => file.analysis.action === "deleteDuplicate"
  ).length;

  const holdCount = downloadFiles.filter(
    (file) => file.analysis.action === "hold"
  ).length;

  const excludedCount = downloadFiles.filter(
    (file) => file.excluded
  ).length;

  const confirmed = window.confirm(
    `Proceed with organizing files?\n\n` +
    `Files to move: ${moveCount}\n` +
    `Exact duplicate downloads to delete: ${duplicateCount}\n` +
    `On hold: ${holdCount}\n` +
    `Excluded from this run: ${excludedCount}`
  );

  if (!confirmed) {
    return;
  }

  const executionLog = createExecutionLog();

  setOperationBusy(true);
  executeStatus.textContent = "Organizing files...";

  try {
    await saveReviewDraft();
    if (!libraryCatalog || catalogError) throw new Error(catalogError || 'Load the pattern folder metadata first.');
    await assertSeparateFolders(downloadDirectoryHandle,libraryDirectoryHandle);
    await verifyCheckedFiles();
    const plans = await buildExecutionPlans();

    executionLog.createdFolders = [
      ...new Set(
        plans.movePlans
          .filter((plan) => plan.targetType === "newDesignerFolder")
          .map((plan) => plan.targetFolderName)
      )
    ];

    await validateMovePlans(plans.movePlans);

    for (const plan of plans.movePlans) {
      await copyFileThenRemoveOriginal(plan);

      executionLog.moved.push({
        from: plan.sourcePath,
        to: `${plan.targetFolderName}/${plan.targetName}`
      });
      await completeReviewedFile(plan);
    }

    for (const plan of plans.deletePlans) {
      await assertCheckedFile(await plan.sourceDirectory.getFileHandle(plan.sourceName));
      await plan.sourceDirectory.removeEntry(plan.sourceName);

      executionLog.deleted.push({
        file: plan.sourceName,
        sameAs: plan.matchPath
      });
      await completeReviewedFile(plan);
    }

    finishCurrentBatch();
    executionLog.status = "completed";
    addActionLog(executionLog);

    executeStatus.textContent =
      `Organization complete: ${plans.movePlans.length} moved / ${plans.deletePlans.length} exact duplicates deleted / ${holdCount} on hold / ${excludedCount} excluded. Continue with PDF text analysis in Pattern Library.`;

  } catch (error) {
    executionLog.status = "failed";
    executionLog.error = error.message;
    addActionLog(executionLog);

    console.error(error);
    executeStatus.className = "execute-status error";
    executeStatus.textContent = `Run failed: ${error.message}`;
    alert(`An error occurred while organizing files.\n\n${error.message}`);
  } finally {
    try {
      await reloadLibraryData();
      await reloadDownloadData();
      scheduleDraftSave();
      await saveReviewDraft();
    } catch (error) {
      duplicateCheckComplete = false;
      executeStatus.className = "execute-status error";
      executeStatus.textContent += ` / Could not refresh remaining reviews: ${error.message}`;
    }
    setOperationBusy(false);
  }
});

initializeBatchControls();
initializeGalleryControls();
initializeCatalogControls();
initializeMaintenanceControls();
initializeNavigation();
