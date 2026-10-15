// Shared application state is initialized in app.js after these function definitions load.

async function initializeDraft() {
  try {
    if (navigator.locks) {
      const ownsDraft = await new Promise((resolve, reject) => {
        navigator.locks.request("pdf-organizer-review", { ifAvailable: true }, lock => {
          resolve(Boolean(lock));
          if (lock) return new Promise(release => window.addEventListener("pagehide", release, { once: true }));
        }).catch(reject);
      });
      if (!ownsDraft) {
        draftLockedElsewhere = true;
        setOperationBusy(true);
        draftSaveStatus.textContent = "다른 탭에서 검토 중입니다. 그 탭을 닫고 이 페이지를 새로고침하세요.";
        return false;
      }
      window.addEventListener("pageshow", event => { if (event.persisted) window.location.reload(); });
    }
    pendingDraft = await ReviewDraftStore.load();
    if (pendingDraft) pendingDraft = normalizeReviewDraft(pendingDraft);
    if (pendingDraft?.files.length) {
      document.getElementById("draftRecoverySummary").textContent =
        `${pendingDraft.downloadDirectory.name} · 저장된 검토 ${pendingDraft.files.length}개`;
      draftRecovery.classList.remove("hidden");
      draftSaveStatus.textContent = "이전 검토 내용을 이어서 작업할 수 있습니다.";
    } else {
      pendingDraft = null;
      draftSaveStatus.textContent = "폴더를 선택하면 검토 내용을 자동 저장합니다.";
    }
    return true;
  } catch (error) {
    draftSaveStatus.textContent = `저장소 확인 실패: ${error.message}. 페이지를 다시 열어주세요.`;
    return false;
  }
}

function scheduleDraftSave() {
  if (suppressDraftSave || !downloadDirectoryHandle) return;
  draftRevision++;
  draftSaveStatus.textContent = "검토 내용 저장 중...";
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => saveReviewDraft().catch(() => {}), 250);
}

async function saveReviewDraft() {
  clearTimeout(draftTimer);
  if (!downloadDirectoryHandle || suppressDraftSave) return;
  const revision = draftRevision;
  // Take a snapshot before queuing the transaction, never serialize DOM references.
  const snapshot = {
    version: 2, savedAt: new Date().toISOString(),
    downloadDirectory: downloadDirectoryHandle,
    libraryDirectory: libraryDirectoryHandle,
    batchNumber, selectedReviewName, selections: [...reviewSelections], view: activeView,
    files: serializeBatchFiles()
  };
  const task = draftSaveChain.then(async () => {
    if (!await draftReady) throw new Error("검토 저장소를 사용할 수 없습니다.");
    await ReviewDraftStore.save(snapshot);
    savedDraftRevision = revision;
    if (draftRevision === revision) {
      draftSaveStatus.textContent = "검토 내용 저장됨";
      retryDraftSaveButton.classList.add("hidden");
    }
  }).catch(error => {
    draftSaveStatus.textContent = `검토 내용 저장 실패: ${error.message}`;
    retryDraftSaveButton.classList.remove("hidden");
    throw error;
  });
  draftSaveChain = task.catch(() => {});
  return task;
}

async function prepareFolderChange(handle, currentHandle) {
  if (categoryEditorDirty || libraryCategoryDrafts.size || libraryPageDrafts.size) throw new Error('편집 중인 분류·대표 페이지를 먼저 저장하거나 취소하세요.');
  if (!await draftReady) throw new Error("검토 저장소를 확인한 후 다시 시도하세요.");
  await saveReviewDraft();
  const sameFolder = currentHandle && await currentHandle.isSameEntry(handle);
  if ((!sameFolder && currentHandle && getAllReviewFiles().length) || pendingDraft?.files.length) {
    if (!window.confirm("다른 폴더로 시작하면 이전 검토 복구본을 새 작업으로 교체합니다. 계속할까요?")) return false;
  }
  pendingDraft = null;
  draftRecovery.classList.add("hidden");
  return true;
}

async function assertSeparateFolders(downloads,library){
  if(!downloads||!library)return;
  const same=await downloads.isSameEntry(library);
  const libraryContains=library.resolve?await library.resolve(downloads):null;
  const downloadsContains=downloads.resolve?await downloads.resolve(library):null;
  if(same||libraryContains!==null||downloadsContains!==null)throw new Error('다운로드 폴더와 패턴 폴더는 서로 다른 위치여야 합니다. 한 폴더를 다른 폴더 안에 두지 마세요.');
}

function captureFolderReview() {
  return {
    downloadDirectoryHandle, libraryDirectoryHandle, singlesDirectoryHandle, pendingDraft,
    downloadFiles: [...downloadFiles], queuedDownloadFiles: [...queuedDownloadFiles], deferredDownloadFiles: [...deferredDownloadFiles],
    selectedReviewName, reviewSelections: new Set(reviewSelections), batchNumber, batchInitialized,
    designerFolders: [...designerFolders], singlesPdfNames: [...singlesPdfNames], designerAliases: { ...designerAliases },
    fields: getAllReviewFiles().map(file => [file, Object.fromEntries(REVIEW_FIELDS.map(key => [key, file[key]]))]),
    labels: [downloadFolderName, libraryFolderName, designerFolderCount, singlesFileCount].map(element => element.textContent),
    catalog: {libraryCatalog,catalogRoot,catalogDiskText,catalogError,indexedLibraryFiles,libraryPage}
  };
}

function restoreFolderReview(previous) {
  ({libraryCatalog,catalogRoot,catalogDiskText,catalogError,indexedLibraryFiles,libraryPage}=previous.catalog);
  ({ downloadDirectoryHandle, libraryDirectoryHandle, singlesDirectoryHandle, pendingDraft,
    downloadFiles, queuedDownloadFiles, deferredDownloadFiles, selectedReviewName, reviewSelections,
    batchNumber, batchInitialized, designerFolders, singlesPdfNames, designerAliases } = previous);
  for (const [file, fields] of previous.fields) Object.assign(file, fields);
  [downloadFolderName, libraryFolderName, designerFolderCount, singlesFileCount].forEach((element, index) => element.textContent = previous.labels[index]);
  localStorage.setItem(ALIAS_STORAGE_KEY, JSON.stringify(designerAliases));
  draftRecovery.classList.toggle('hidden', !pendingDraft?.files.length);
  digestCache.clear();
  invalidateDuplicateCheck();
  renderDownloadFileList(); renderSortingRows(); renderDesignerFolders(designerFolders); renderAliasList();
  executeStatus.textContent = '폴더를 연결하지 못해 이전 검토를 유지했습니다. 정리 전에 중복 검사를 다시 실행하세요.';
  renderCatalogUI();
}

async function restoreReviewDraft() {
  if (!pendingDraft || operationBusy) return;
  const draft = pendingDraft;
  const previous = { downloadDirectoryHandle, libraryDirectoryHandle, downloadFiles,
    designerFolders, singlesPdfNames, singlesDirectoryHandle, designerAliases,
    queuedDownloadFiles, deferredDownloadFiles, selectedReviewName, reviewSelections, batchNumber, batchInitialized,
    catalog: {libraryCatalog,catalogRoot,catalogDiskText,catalogError,indexedLibraryFiles,libraryPage} };
  let loaded = false;
  let restored = 0, changed = 0;
  try {
    setOperationBusy(true);
    suppressDraftSave = true;
    for (const handle of [draft.downloadDirectory, draft.libraryDirectory].filter(Boolean)) {
      let permission = await handle.queryPermission({ mode: "readwrite" });
      if (permission !== "granted") permission = await handle.requestPermission({ mode: "readwrite" });
      if (permission !== "granted") throw new Error("선택 폴더의 접근 권한이 필요합니다. 권한을 허용한 뒤 다시 시도하세요.");
    }
    downloadDirectoryHandle = draft.downloadDirectory;
    libraryDirectoryHandle = draft.libraryDirectory;
    await assertSeparateFolders(downloadDirectoryHandle,libraryDirectoryHandle);
    if (libraryDirectoryHandle) {
      await reloadLibraryData();
      await loadDesignerAliasesFromLibrary();
      renderDesignerFolders(designerFolders);
    }
    await reloadDownloadData();
    const savedFiles = new Map(draft.files.map(file => [file.name, file]));
    for (const file of getAllReviewFiles()) {
      const saved = savedFiles.get(file.name);
      if (!saved) continue;
      if (saved.size !== file.size || saved.lastModified !== file.lastModified) { changed++; continue; }
      for (const field of REVIEW_FIELDS) file[field] = saved[field];
      if (file.selectedFolder && !designerFolders.includes(file.selectedFolder)) {
        file.selectedFolder = null;
        file.autoLinkedAlias = "";
      }
      restored++;
    }
    downloadFolderName.textContent = `선택한 폴더: ${downloadDirectoryHandle.name}`;
    libraryFolderName.textContent = libraryDirectoryHandle ? `선택한 폴더: ${libraryDirectoryHandle.name}` : "";
    restoreBatchMembership(getAllReviewFiles(), draft);
    renderDownloadFileList();
    renderSortingRows();
    loaded = true;
    duplicateCheckComplete = false;
    executeStatus.textContent = `검토 ${restored}개 복구 / 변경된 파일 ${changed}개는 새로 검토합니다. 정리 전에 중복 검사를 다시 실행하세요.`;
    pendingDraft = null;
    draftRecovery.classList.add("hidden");
    suppressDraftSave = false;
    scheduleDraftSave();
    await saveReviewDraft();
  } catch (error) {
    if (!loaded) {
      ({libraryCatalog,catalogRoot,catalogDiskText,catalogError,indexedLibraryFiles,libraryPage}=previous.catalog);
      downloadDirectoryHandle = previous.downloadDirectoryHandle;
      libraryDirectoryHandle = previous.libraryDirectoryHandle;
      downloadFiles = previous.downloadFiles;
      designerFolders = previous.designerFolders;
      singlesPdfNames = previous.singlesPdfNames;
      singlesDirectoryHandle = previous.singlesDirectoryHandle;
      designerAliases = previous.designerAliases;
      queuedDownloadFiles = previous.queuedDownloadFiles;
      deferredDownloadFiles = previous.deferredDownloadFiles;
      selectedReviewName = previous.selectedReviewName;
      reviewSelections = previous.reviewSelections;
      batchNumber = previous.batchNumber;
      batchInitialized = previous.batchInitialized;
      renderDownloadFileList();
      renderSortingRows();
      renderDesignerFolders(designerFolders);
    }
    draftSaveStatus.textContent = `검토 복구 실패: ${error.message}`;
  } finally {
    suppressDraftSave = false;
    setOperationBusy(false);
  }
}

function setOperationBusy(busy) {
  operationBusy = busy;
  const controls = document.querySelectorAll("button, input, select, textarea");
  for (const control of controls) {
    if (control === cancelDuplicateCheckButton || control.classList.contains("nav-tab") || control.id === "pauseAnalysisButton") continue;
    if (busy) {
      if (control.dataset.preOperationDisabled === undefined) {
        control.dataset.preOperationDisabled = String(control.disabled);
      }
      control.disabled = true;
    } else if (control.dataset.preOperationDisabled !== undefined) {
      control.disabled = control.dataset.preOperationDisabled === "true";
      delete control.dataset.preOperationDisabled;
    }
  }
  // A restore/reload may have rendered new controls while the operation was busy.
  if (!busy) {
    duplicateCheckButton.disabled = false;
    executeButton.disabled = false;
    designerSearch.disabled = !libraryDirectoryHandle;
    updateBatchControls();
    renderCatalogControls();
    GalleryPreviews.resume();
  }
}
