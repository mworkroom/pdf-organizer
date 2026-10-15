const SINGLES_FOLDER_NAME = "!zz_Singles";

const SPECIAL_FOLDER_OPTIONS = { singles: { label: 'Singles', folderName: SINGLES_FOLDER_NAME } };
const BATCH_LIMIT = 100;
let queuedDownloadFiles = [];
let deferredDownloadFiles = [];
let selectedReviewName = '';
let reviewSelections = new Set();
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
  executeStatus.textContent = "진행 중인 파일 처리가 끝나면 검사를 취소합니다...";
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
  aliasToggleButton.textContent = collapsed ? "펼치기" : "접기";
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
      throw new Error("올바른 연결표 형식이 아닙니다.");
    }

    designerAliases = { ...designerAliases, ...imported };
    saveDesignerAliases();
    applyRememberedConnectionsToEmptyFiles();
    renderSortingRows();
    alert(`연결표를 가져왔습니다. 현재 ${Object.keys(designerAliases).length}개입니다.`);
  } catch (error) {
    alert(`연결표를 가져오지 못했습니다.\n\n${error.message}`);
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

    downloadFolderName.textContent = `선택한 폴더: ${downloadDirectoryHandle.name}`;

    await reloadDownloadData();
    executeStatus.className = 'execute-status';
    executeStatus.textContent = '';
    scheduleDraftSave();
    await saveReviewDraft();

  } catch (error) {
    if (previous) restoreFolderReview(previous);
    if (error.name !== "AbortError") {
      alert(`다운로드 폴더를 연결하지 못했습니다.\n\n${error.message}`);
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

    libraryFolderName.textContent = `선택한 폴더: ${libraryDirectoryHandle.name}`;
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
      alert(`패턴 폴더를 연결하지 못했습니다.\n\n${error.message}`);
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

  const confirmed = window.confirm("작업 로그를 모두 지울까요?");

  if (!confirmed) {
    return;
  }

  actionLogs = [];
  saveActionLogs();
});

duplicateCheckButton.addEventListener("click", async () => {
  if (!downloadDirectoryHandle || !libraryDirectoryHandle) {
    alert("다운로드 폴더와 기존 패턴 폴더를 먼저 선택하세요.");
    return;
  }

  if (categoryEditorDirty || libraryCategoryDrafts.size || libraryPageDrafts.size) {
    alert('Pattern Library에서 편집 중인 분류·대표 페이지를 먼저 저장하거나 취소하세요.');
    setActiveView('library');
    return;
  }

  const activeFiles = downloadFiles.filter((file) => !file.excluded);

  if (activeFiles.length === 0) {
    alert("검사할 PDF 파일이 없습니다.");
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
  executeStatus.textContent = "중복 파일을 검사하는 중입니다...";

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
      `중복 검사 완료: 이동 ${moveCount}개 / 완전 중복 삭제 ${duplicateCount}개 / 보류 ${holdCount}개 / 제외 ${excludedCount}개`;

  } catch (error) {
    downloadFiles.forEach(file => {
      file.analysis = { action: file.excluded ? "excluded" : "unchecked", message: "", matchPath: "" };
    });
    duplicateCheckComplete = false;
    updateAllPreviews();
    if (error.name === "AbortError") {
      executeStatus.textContent = "중복 검사를 취소했습니다. 검토 내용은 유지됩니다. 정리 전에 다시 검사하세요.";
      return;
    }
    console.error(error);
    executeStatus.className = "execute-status error";
    executeStatus.textContent = `중복 검사 실패: ${error.message}`;
    alert(`중복 검사 중 오류가 발생했습니다.\n\n${error.message}`);
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
    alert("다운로드 폴더와 기존 패턴 폴더를 먼저 선택하세요.");
    return;
  }

  if (categoryEditorDirty || libraryCategoryDrafts.size || libraryPageDrafts.size) {
    alert('Pattern Library에서 편집 중인 분류·대표 페이지를 먼저 저장하거나 취소하세요.');
    setActiveView('library');
    return;
  }

  const activeFiles = downloadFiles.filter((file) => !file.excluded);

  if (activeFiles.length === 0) {
    alert("정리할 PDF 파일이 없습니다.");
    return;
  }

  if (!validateCompletenessAndFocus()) {
    return;
  }

  if (!duplicateCheckComplete) {
    alert("정리 실행 전에 중복 검사를 먼저 실행하세요.");
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
    `실제 파일 정리를 실행합니다.\n\n` +
    `이동 예정: ${moveCount}개\n` +
    `완전 중복 다운로드본 삭제: ${duplicateCount}개\n` +
    `보류: ${holdCount}개\n` +
    `이번 작업에서 제외: ${excludedCount}개`
  );

  if (!confirmed) {
    return;
  }

  const executionLog = createExecutionLog();

  setOperationBusy(true);
  executeStatus.textContent = "파일을 정리하는 중입니다...";

  try {
    await saveReviewDraft();
    if (!libraryCatalog || catalogError) throw new Error(catalogError || '패턴 폴더의 메타데이터를 먼저 연결하세요.');
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
      `정리 완료: 이동 ${plans.movePlans.length}개 / 완전 중복 삭제 ${plans.deletePlans.length}개 / 보류 ${holdCount}개 / 제외 ${excludedCount}개 · Pattern Library에서 미분석 PDF 텍스트 분석을 이어서 실행할 수 있습니다.`;

  } catch (error) {
    executionLog.status = "failed";
    executionLog.error = error.message;
    addActionLog(executionLog);

    console.error(error);
    executeStatus.className = "execute-status error";
    executeStatus.textContent = `실행 실패: ${error.message}`;
    alert(`정리 실행 중 오류가 발생했습니다.\n\n${error.message}`);
  } finally {
    try {
      await reloadLibraryData();
      await reloadDownloadData();
      scheduleDraftSave();
      await saveReviewDraft();
    } catch (error) {
      duplicateCheckComplete = false;
      executeStatus.className = "execute-status error";
      executeStatus.textContent += ` / 남은 검토 갱신 실패: ${error.message}`;
    }
    setOperationBusy(false);
  }
});

initializeBatchControls();
initializeGalleryControls();
initializeCatalogControls();
initializeMaintenanceControls();
initializeNavigation();
