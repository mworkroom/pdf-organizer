// Shared application state is initialized in app.js after these function definitions load.

function createDownloadFileRecord(entry) {
  digestKeys.set(entry, `download:${entry.name}`);
  return {
    name: entry.name,
    handle: entry,
    excluded: false,
    destinationName: "",
    selectedFolder: null,
    sourceDesignerName: "",
    sourceDesignerTouched: false,
    patternFileName: entry.name,
    patternManuallyEdited: false,
    autoLinkedAlias: "",
    specialFolderKey: "singles",
    previewElement: null,
    statusElement: null,
    analysis: {
      action: "unchecked",
      message: "",
      matchPath: ""
    }
  };
}

function getExistingFolderName(file) {
  if (file.selectedFolder) {
    return file.selectedFolder;
  }

  const destinationKey = normalizeText(file.destinationName);

  return designerFolders.find(
    (folderName) => normalizeText(folderName) === destinationKey
  ) || null;
}

function getSpecialFolderOption(file) {
  return SPECIAL_FOLDER_OPTIONS[file.specialFolderKey] ||
    SPECIAL_FOLDER_OPTIONS.singles;
}

function getSpecialFolderTargetName(file) {
  const destinationName = file.destinationName.trim();
  const patternFileName = ensurePdfExtension(file.patternFileName.trim());

  return `${destinationName}_${patternFileName}`;
}

function findSinglesFiles(destinationName) {
  const prefix = normalizeText(`${destinationName}_`);

  return singlesPdfNames.filter((fileName) =>
    normalizeText(fileName).startsWith(prefix)
  );
}

function findIncomingFilesForDesigner(destinationName) {
  const targetName = normalizeText(destinationName);

  return downloadFiles.filter((file) =>
    !file.excluded &&
    file.specialFolderKey === "singles" &&
    !getExistingFolderName(file) &&
    normalizeText(file.destinationName) === targetName
  );
}

async function analyseAllDuplicates() {
  assertBatchLimit();
  checkFiles = new Map();
  checkProgress = { completed: 0, total: downloadFiles.filter(file => !file.excluded).length, reads: 0 };
  checkedFileSignatures = new Map();

  downloadFiles.forEach((file) => {
    file.analysis = {
      action: file.excluded ? "excluded" : "move",
      message: "",
      matchPath: ""
    };
  });

  const existingFolderGroups = new Map();
  const specialFolderGroups = new Map();
  const singlesGroups = new Map();

  downloadFiles
    .filter((file) => !file.excluded)
    .forEach((file) => {
      const existingFolderName = getExistingFolderName(file);

      if (existingFolderName) {
        const key = normalizeText(existingFolderName);

        if (!existingFolderGroups.has(key)) {
          existingFolderGroups.set(key, {
            folderName: existingFolderName,
            files: []
          });
        }

        existingFolderGroups.get(key).files.push(file);
        return;
      }

      if (file.specialFolderKey !== "singles") {
        const specialOption = getSpecialFolderOption(file);
        const key = normalizeText(specialOption.folderName);

        if (!specialFolderGroups.has(key)) {
          specialFolderGroups.set(key, {
            folderName: specialOption.folderName,
            files: []
          });
        }

        specialFolderGroups.get(key).files.push(file);
        return;
      }

      const destinationName = file.destinationName.trim();
      const key = normalizeText(destinationName);

      if (!singlesGroups.has(key)) {
        singlesGroups.set(key, {
          destinationName,
          files: []
        });
      }

      singlesGroups.get(key).files.push(file);
    });

  for (const group of existingFolderGroups.values()) {
    await analyseExistingFolderGroup(group);
  }

  for (const group of specialFolderGroups.values()) {
    await analyseSpecialFolderGroup(group);
  }

  for (const group of singlesGroups.values()) {
    await analyseSinglesGroup(group);
  }
}

async function analyseExistingFolderGroup(group) {
  const directoryHandle =
    await libraryDirectoryHandle.getDirectoryHandle(group.folderName);

  const storedFiles =
    await listPdfCandidates(directoryHandle, group.folderName);

  await markExactContentDuplicates(group.files, storedFiles);
  await markIncomingBatchDuplicates(group.files);

  markNameConflicts(
    group.files,
    storedFiles,
    (file) => ensurePdfExtension(file.patternFileName.trim()),
    (storedFile) => storedFile.name
  );
}

async function analyseSpecialFolderGroup(group) {
  const storedFiles =
    await listSpecialFolderCandidates(group.folderName);

  await markExactContentDuplicates(group.files, storedFiles);
  await markIncomingBatchDuplicates(group.files);

  markNameConflicts(
    group.files,
    storedFiles,
    (file) => getSpecialFolderTargetName(file),
    (storedFile) => storedFile.name
  );
}

async function analyseSinglesGroup(group) {
  const storedFiles =
    await listSinglesCandidates(group.destinationName);

  await markExactContentDuplicates(group.files, storedFiles);
  await markIncomingBatchDuplicates(group.files);

  const activeFiles = group.files.filter(
    (file) => file.analysis.action === "move"
  );

  const willPromote =
    storedFiles.length + activeFiles.length >= 3;

  if (willPromote) {
    markNameConflicts(
      group.files,
      storedFiles,
      (file) => ensurePdfExtension(file.patternFileName.trim()),
      (storedFile) =>
        removeSinglesDesignerPrefix(
          storedFile.name,
          group.destinationName
        )
    );
  } else {
    markNameConflicts(
      group.files,
      storedFiles,
      (file) =>
        `${group.destinationName}_${ensurePdfExtension(file.patternFileName.trim())}`,
      (storedFile) => storedFile.name
    );
  }
}

async function markExactContentDuplicates(incomingFiles, storedFiles) {
  const bySize = new Map();
  for (const stored of storedFiles) {
    const size = (await getCheckedFile(stored.handle)).size;
    if (!bySize.has(size)) bySize.set(size, []);
    bySize.get(size).push(stored);
  }
  const hashIndexes = new Map();
  for (const incomingFile of incomingFiles) {
    if (incomingFile.analysis.action !== "move") {
      continue;
    }

    throwIfCheckCancelled();
    const size = (await getCheckedFile(incomingFile.handle)).size;
    if (!bySize.has(size)) continue;
    if (!hashIndexes.has(size)) {
      const index = new Map();
      for (const stored of bySize.get(size)) {
        const digest = await getFileDigest(stored.handle);
        if (!index.has(digest.hash)) index.set(digest.hash, stored);
      }
      hashIndexes.set(size, index);
    }
    const digest = await getFileDigest(incomingFile.handle);
    const matching = hashIndexes.get(size).get(digest.hash);
    if (matching) {
      incomingFile.analysis = {
        action: "deleteDuplicate", message: "", matchPath: matching.path
      };
    }
  }
}

async function markIncomingBatchDuplicates(incomingFiles) {
  const sizeCounts = new Map();
  for (const incomingFile of incomingFiles) {
    if (incomingFile.analysis.action !== "move") continue;
    const size = (await getCheckedFile(incomingFile.handle)).size;
    sizeCounts.set(size, (sizeCounts.get(size) || 0) + 1);
  }
  const keptFiles = new Map();

  for (const incomingFile of incomingFiles) {
    throwIfCheckCancelled();
    if (incomingFile.analysis.action === "move") {
      const size = (await getCheckedFile(incomingFile.handle)).size;
      if (sizeCounts.get(size) > 1) {
        const digest = await getFileDigest(incomingFile.handle);
        const key = `${size}:${digest.hash}`;
        const duplicate = keptFiles.get(key);
        if (duplicate) {
          incomingFile.analysis = {
            action: "deleteDuplicate", message: "",
            matchPath: `${duplicate.name} in this download folder`
          };
        } else {
          keptFiles.set(key, incomingFile);
        }
      }
    }
    checkProgress.completed++;
    await yieldCheck();
  }
}

function markNameConflicts(
  incomingFiles,
  storedFiles,
  getIncomingTargetName,
  getStoredTargetName
) {
  const storedNames = new Map();

  storedFiles.forEach((storedFile) => {
    storedNames.set(
      normalizeText(getStoredTargetName(storedFile)),
      storedFile
    );
  });

  incomingFiles.forEach((incomingFile) => {
    if (incomingFile.analysis.action !== "move") {
      return;
    }

    const targetName = getIncomingTargetName(incomingFile);
    const matchingStoredFile =
      storedNames.get(normalizeText(targetName));

    if (matchingStoredFile) {
      incomingFile.analysis = {
        action: "hold",
        message:
          `A PDF with the same filename has different content: ${matchingStoredFile.path}`,
        matchPath: ""
      };
    }
  });

  const incomingNames = new Map();

  incomingFiles.forEach((incomingFile) => {
    if (incomingFile.analysis.action !== "move") {
      return;
    }

    const targetName = getIncomingTargetName(incomingFile);
    const key = normalizeText(targetName);

    if (incomingNames.has(key)) {
      const previousFile = incomingNames.get(key);

      previousFile.analysis = {
        action: "hold",
        message:
          `Multiple downloads have the same destination filename: ${targetName}`,
        matchPath: ""
      };

      incomingFile.analysis = {
        action: "hold",
        message:
          `Multiple downloads have the same destination filename: ${targetName}`,
        matchPath: ""
      };
    } else {
      incomingNames.set(key, incomingFile);
    }
  });
}

async function listSpecialFolderCandidates(folderName) {
  try {
    const directoryHandle =
      await libraryDirectoryHandle.getDirectoryHandle(folderName);

    return await listPdfCandidates(directoryHandle, folderName);
  } catch (error) {
    if (error.name === "NotFoundError") {
      return [];
    }

    throw error;
  }
}

async function listPdfCandidates(directoryHandle, folderName) {
  const candidates = [];

  for await (const entry of directoryHandle.values()) {
    throwIfCheckCancelled();
    if (
      entry.kind === "file" &&
      entry.name.toLowerCase().endsWith(".pdf")
    ) {
      candidates.push({
        name: entry.name,
        handle: entry,
        path: `${folderName}/${entry.name}`
      });
      digestKeys.set(entry, `library:${folderName}/${entry.name}`);
    }
  }

  return candidates;
}

async function listSinglesCandidates(destinationName) {
  if (!singlesDirectoryHandle) {
    return [];
  }

  const prefix = normalizeText(`${destinationName}_`);
  const candidates = [];

  for await (const entry of singlesDirectoryHandle.values()) {
    throwIfCheckCancelled();
    if (
      entry.kind === "file" &&
      entry.name.toLowerCase().endsWith(".pdf") &&
      normalizeText(entry.name).startsWith(prefix)
    ) {
      candidates.push({
        name: entry.name,
        handle: entry,
        path: `${SINGLES_FOLDER_NAME}/${entry.name}`
      });
      digestKeys.set(entry, `library:${SINGLES_FOLDER_NAME}/${entry.name}`);
    }
  }

  return candidates;
}

async function filesAreIdentical(firstHandle, secondHandle) {
  const firstFile = await getCheckedFile(firstHandle);
  const secondFile = await getCheckedFile(secondHandle);
  if (firstFile.size !== secondFile.size) return false;
  const first = await getFileDigest(firstHandle);
  const second = await getFileDigest(secondHandle);

  return first.size === second.size && first.hash === second.hash;
}

async function getFileDigest(fileHandle) {
  throwIfCheckCancelled();
  const file = await getCheckedFile(fileHandle);
  const key = digestKeys.get(fileHandle) || fileHandle;
  const cached = digestCache.get(key);
  if (cached && cached.size === file.size && cached.lastModified === file.lastModified) return cached;
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  throwIfCheckCancelled();

  const hash = Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  const info = {
    size: file.size,
    hash, lastModified: file.lastModified
  };

  if (digestCache.size >= 4096) digestCache.delete(digestCache.keys().next().value);
  digestCache.set(key, info);
  checkProgress.reads++;
  await yieldCheck();
  return info;
}

function throwIfCheckCancelled() {
  if (duplicateCheckController?.signal.aborted) throw new DOMException("Cancel check", "AbortError");
}

async function yieldCheck() {
  if (!duplicateCheckController) return;
  throwIfCheckCancelled();
  executeStatus.textContent = `Checking duplicates: ${checkProgress.completed} / ${checkProgress.total} · Files read: ${checkProgress.reads}`;
  await new Promise(resolve => setTimeout(resolve, 0));
  throwIfCheckCancelled();
}

async function getCheckedFile(handle) {
  throwIfCheckCancelled();
  if (checkFiles.has(handle)) return checkFiles.get(handle);
  const file = await handle.getFile();
  checkFiles.set(handle, file);
  const key = digestKeys.get(handle) || handle;
  checkedFileSignatures.set(key, { handle, size: file.size, lastModified: file.lastModified });
  if (checkFiles.size % 16 === 0) await yieldCheck();
  return file;
}

async function assertCheckedFile(handle) {
  let key = digestKeys.get(handle);
  // Fresh handles returned by getFileHandle still refer to an already checked entry.
  if (!key) {
    for (const [candidateKey, signature] of checkedFileSignatures) {
      if (signature.handle.name === handle.name && await signature.handle.isSameEntry(handle)) { key = candidateKey; break; }
    }
  }
  const checked = checkedFileSignatures.get(key);
  if (!checked) throw new Error(`No duplicate check record for file: ${handle.name}`);
  const file = await handle.getFile();
  if (file.size !== checked.size || file.lastModified !== checked.lastModified) {
    duplicateCheckComplete = false;
    throw new Error(`The file changed after the duplicate check. Reload the folder and check again: ${handle.name}`);
  }
  return file;
}

async function verifyCheckedFiles() {
  for (const checked of checkedFileSignatures.values()) await assertCheckedFile(checked.handle);
}

async function completeReviewedFile(plan) {
  if (!await plan.sourceDirectory.isSameEntry(downloadDirectoryHandle)) return;
  const file = downloadFiles.find(file => file.name === plan.sourceName);
  if (file) file.completed = true;
  scheduleDraftSave();
  await saveReviewDraft();
}

async function buildExecutionPlans() {
  assertBatchLimit();
  const movePlans = [];
  const deletePlans = [];
  const newDesignerGroups = new Map();
  const singlesDirectory = await getOrCreateSinglesDirectory();

  downloadFiles.forEach((file) => {
    if (file.excluded) {
      return;
    }

    if (file.analysis.action === "deleteDuplicate") {
      deletePlans.push({
        sourceDirectory: downloadDirectoryHandle,
        sourceName: file.name,
        matchPath: file.analysis.matchPath
      });
      return;
    }

    if (file.analysis.action === "hold") {
      return;
    }

    const patternFileName =
      ensurePdfExtension(file.patternFileName.trim());

    const existingFolderName =
      getExistingFolderName(file);

    if (existingFolderName) {
      movePlans.push({
        sourceDirectory: downloadDirectoryHandle,
        sourceName: file.name,
        sourcePath: file.name,
        targetFolderName: existingFolderName,
        targetName: patternFileName,
        targetType: "existing"
      });
      return;
    }

    if (file.specialFolderKey !== "singles") {
      const specialOption = getSpecialFolderOption(file);

      movePlans.push({
        sourceDirectory: downloadDirectoryHandle,
        sourceName: file.name,
        sourcePath: file.name,
        targetFolderName: specialOption.folderName,
        targetName: getSpecialFolderTargetName(file),
        targetType: "specialFolder"
      });

      return;
    }

    const destinationName = file.destinationName.trim();
    const key = normalizeText(destinationName);

    if (!newDesignerGroups.has(key)) {
      newDesignerGroups.set(key, {
        destinationName,
        files: []
      });
    }

    newDesignerGroups.get(key).files.push({
      sourceFile: file,
      patternFileName
    });
  });

  for (const group of newDesignerGroups.values()) {
    const existingSingles =
      findSinglesFiles(group.destinationName);

    const totalCount =
      existingSingles.length + group.files.length;

    if (totalCount >= 3) {
      existingSingles.forEach((fileName) => {
        movePlans.push({
          sourceDirectory: singlesDirectory,
          sourceName: fileName,
          sourcePath: `${SINGLES_FOLDER_NAME}/${fileName}`,
          targetFolderName: group.destinationName,
          targetName: removeSinglesDesignerPrefix(
            fileName,
            group.destinationName
          ),
          targetType: "newDesignerFolder"
        });
      });

      group.files.forEach(({ sourceFile, patternFileName }) => {
        movePlans.push({
          sourceDirectory: downloadDirectoryHandle,
          sourceName: sourceFile.name,
          sourcePath: sourceFile.name,
          targetFolderName: group.destinationName,
          targetName: patternFileName,
          targetType: "newDesignerFolder"
        });
      });
    } else {
      group.files.forEach(({ sourceFile, patternFileName }) => {
        movePlans.push({
          sourceDirectory: downloadDirectoryHandle,
          sourceName: sourceFile.name,
          sourcePath: sourceFile.name,
          targetFolderName: SINGLES_FOLDER_NAME,
          targetName: `${group.destinationName}_${patternFileName}`,
          targetType: "singles"
        });
      });
    }
  }

  for (const plan of movePlans) {
    if (plan.targetFolderName === SINGLES_FOLDER_NAME) {
      plan.targetDirectory = singlesDirectory;
    } else {
      plan.targetDirectory =
        await libraryDirectoryHandle.getDirectoryHandle(
          plan.targetFolderName,
          {
            create:
              plan.targetType === "newDesignerFolder" ||
              plan.targetType === "specialFolder"
          }
        );
    }
  }

  return {
    movePlans,
    deletePlans
  };
}

async function getOrCreateSinglesDirectory() {
  if (!singlesDirectoryHandle) {
    singlesDirectoryHandle =
      await libraryDirectoryHandle.getDirectoryHandle(
        SINGLES_FOLDER_NAME,
        { create: true }
      );
  }

  return singlesDirectoryHandle;
}

function removeSinglesDesignerPrefix(fileName, destinationName) {
  const prefix = `${destinationName}_`;

  if (!normalizeText(fileName).startsWith(normalizeText(prefix))) {
    return fileName;
  }

  const separatorIndex = fileName.indexOf("_");

  return separatorIndex >= 0
    ? fileName.slice(separatorIndex + 1)
    : fileName;
}

async function validateMovePlans(plans) {
  const destinationPaths = new Set();

  for (const plan of plans) {
    const key =
      normalizeText(`${plan.targetFolderName}/${plan.targetName}`);

    if (destinationPaths.has(key)) {
      throw new Error(
        `Two files would be created at the same destination: ${plan.targetFolderName}/${plan.targetName}`
      );
    }

    destinationPaths.add(key);

    const alreadyExists =
      await fileExists(plan.targetDirectory, plan.targetName);

    if (alreadyExists) {
      throw new Error(
        `The destination changed after the duplicate check: ${plan.targetFolderName}/${plan.targetName}`
      );
    }
  }
}

async function fileExists(directoryHandle, fileName) {
  try {
    await directoryHandle.getFileHandle(fileName);
    return true;
  } catch (error) {
    if (error.name === "NotFoundError") {
      return false;
    }

    throw error;
  }
}

async function copyFileThenRemoveOriginal(plan) {
  const sourceHandle =
    await plan.sourceDirectory.getFileHandle(plan.sourceName);

  const sourceFile = await assertCheckedFile(sourceHandle);
  const sourceKey=(await plan.sourceDirectory.isSameEntry(downloadDirectoryHandle)?'download:':'library:')+plan.sourcePath;
  const cachedDigest=digestCache.get(sourceKey);
  const sourceHash=cachedDigest&&cachedDigest.size===sourceFile.size&&cachedDigest.lastModified===sourceFile.lastModified?cachedDigest.hash:
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await sourceFile.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
  if (await fileExists(plan.targetDirectory, plan.targetName)) {
    throw new Error(`A file now exists at the destination. It will not be overwritten: ${plan.targetFolderName}/${plan.targetName}`);
  }
  let created = false;
  let metadataSaved = false;

  try {
    const targetHandle =
      await plan.targetDirectory.getFileHandle(
        plan.targetName,
        { create: true }
      );

    created = true;

    const writable = await targetHandle.createWritable();
    await writable.write(sourceFile);
    await writable.close();

    const copiedFile = await targetHandle.getFile();
    if (copiedFile.size !== sourceFile.size) throw new Error("The copied file size does not match.");
    await assertCheckedFile(sourceHandle);
    await persistMovedPattern(plan, copiedFile, sourceHash);
    metadataSaved = true;
    await plan.sourceDirectory.removeEntry(plan.sourceName);

  } catch (error) {
    // Once metadata is committed, retain both copies if source removal fails.
    // A later exact-duplicate check can safely finish the interrupted operation.
    if (created && !metadataSaved) {
      try {
        await plan.targetDirectory.removeEntry(plan.targetName);
      } catch (cleanupError) {
        console.error("Could not clean up the created file:", cleanupError);
      }
    }

    throw error;
  }
}

async function reloadDownloadData({startBatch=false}={}) {
  const previousFiles = new Map(getAllReviewFiles().filter(file => !file.completed).map(file => [file.name, file]));
  const currentNames = downloadFiles.filter(file => !file.completed).map(file => file.name);
  const queuedNames = queuedDownloadFiles.map(file => file.name);
  const deferredNames = deferredDownloadFiles.map(file => file.name);
  const records = [];
  for await (const entry of downloadDirectoryHandle.values()) {
    if (entry.kind !== "file" || !entry.name.toLowerCase().endsWith(".pdf")) continue;
    const record = createDownloadFileRecord(entry);
    const metadata = await entry.getFile();
    record.size = metadata.size;
    record.lastModified = metadata.lastModified;
    const previous = previousFiles.get(entry.name);
    if (previous && previous.size === record.size && previous.lastModified === record.lastModified) {
      for (const field of REVIEW_FIELDS) record[field] = previous[field];
      record.deferredReason = previous.deferredReason;
    }
    record.specialFolderKey = "singles";
    record.patternId ||= crypto.randomUUID();
    inferReviewCategories(record);
    records.push(record);
  }
  records.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  if (!batchInitialized) {
    downloadFiles = records.slice(0, BATCH_LIMIT);
    queuedDownloadFiles = records.slice(BATCH_LIMIT);
    deferredDownloadFiles = [];
    batchInitialized = true;
  } else {
    const byName = new Map(records.map(file => [file.name, file]));
    const take = names => names.map(name => { const file = byName.get(name); byName.delete(name); return file; }).filter(Boolean);
    downloadFiles = take(currentNames);
    queuedDownloadFiles = take(queuedNames);
    deferredDownloadFiles = take(deferredNames);
    queuedDownloadFiles.push(...byName.values());
    if(startBatch&&!downloadFiles.length&&queuedDownloadFiles.length){
      downloadFiles=queuedDownloadFiles.splice(0,BATCH_LIMIT);
      batchNumber++;
    }
  }
  if (!downloadFiles.some(file => file.name === selectedReviewName)) selectedReviewName = downloadFiles[0]?.name || "";
  reviewSelections = new Set([...reviewSelections].filter(name => downloadFiles.some(file => file.name === name)));
  applyRememberedConnectionsToEmptyFiles();
  duplicateCheckComplete = false;
  renderDownloadFileList();
  renderSortingRows();
}
