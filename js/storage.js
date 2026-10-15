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
        draftSaveStatus.textContent = "A review is open in another tab. Close that tab and refresh this page.";
        return false;
      }
      window.addEventListener("pageshow", event => { if (event.persisted) window.location.reload(); });
    }
    pendingDraft = await ReviewDraftStore.load();
    if (pendingDraft) pendingDraft = normalizeReviewDraft(pendingDraft);
    if (pendingDraft?.files.length) {
      document.getElementById("draftRecoverySummary").textContent =
        `${pendingDraft.downloadDirectory.name} · Saved reviews: ${pendingDraft.files.length}`;
      draftRecovery.classList.remove("hidden");
      draftSaveStatus.textContent = "A saved review is available to resume.";
    } else {
      pendingDraft = null;
      draftSaveStatus.textContent = "Select a folder to enable review autosave.";
    }
    return true;
  } catch (error) {
    draftSaveStatus.textContent = `Could not check storage: ${error.message}. Reopen this page.`;
    return false;
  }
}

function scheduleDraftSave() {
  if (suppressDraftSave || !downloadDirectoryHandle) return;
  draftRevision++;
  draftSaveStatus.textContent = "Saving review...";
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
    if (!await draftReady) throw new Error("Review storage is unavailable.");
    await ReviewDraftStore.save(snapshot);
    savedDraftRevision = revision;
    if (draftRevision === revision) {
      draftSaveStatus.textContent = "Review saved";
      retryDraftSaveButton.classList.add("hidden");
    }
  }).catch(error => {
    draftSaveStatus.textContent = `Could not save review: ${error.message}`;
    retryDraftSaveButton.classList.remove("hidden");
    throw error;
  });
  draftSaveChain = task.catch(() => {});
  return task;
}

async function prepareFolderChange(handle, currentHandle) {
  if (hasPendingLibraryEdits()) throw new Error('Save or cancel category, attribute and cover page edits first.');
  if (!await draftReady) throw new Error("Wait for the review storage check, then try again.");
  await saveReviewDraft();
  const sameFolder = currentHandle && await currentHandle.isSameEntry(handle);
  if ((!sameFolder && currentHandle && getAllReviewFiles().length) || pendingDraft?.files.length) {
    if (!window.confirm("Starting with a different folder replaces the saved review with a new one. Continue?")) return false;
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
  if(same||libraryContains!==null||downloadsContains!==null)throw new Error('The download and pattern folders must be separate locations. Neither folder may contain the other.');
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
  executeStatus.textContent = 'Could not connect the folders. The previous review is preserved. Check duplicates again before organizing.';
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
      if (permission !== "granted") throw new Error("Access to the selected folders is required. Grant permission and try again.");
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
    downloadFolderName.textContent = `Selected folder: ${downloadDirectoryHandle.name}`;
    libraryFolderName.textContent = libraryDirectoryHandle ? `Selected folder: ${libraryDirectoryHandle.name}` : "";
    restoreBatchMembership(getAllReviewFiles(), draft);
    renderDownloadFileList();
    renderSortingRows();
    loaded = true;
    duplicateCheckComplete = false;
    executeStatus.textContent = `Restored ${restored} reviews. Review ${changed} changed files again. Check duplicates before organizing.`;
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
    draftSaveStatus.textContent = `Could not restore review: ${error.message}`;
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
