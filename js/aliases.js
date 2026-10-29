// Shared application state is initialized in app.js after these function definitions load.

function loadDesignerAliases() {
  try {
    return JSON.parse(localStorage.getItem(ALIAS_STORAGE_KEY)) || {};
  } catch (error) {
    return {};
  }
}

function saveDesignerAliases() {
  localStorage.setItem(ALIAS_STORAGE_KEY, JSON.stringify(designerAliases));
  renderAliasList();
  persistDesignerAliasesToLibrary();
}

async function persistDesignerAliasesToLibrary() {
  if (!libraryDirectoryHandle) return;

  try {
    const fileHandle = await libraryDirectoryHandle.getFileHandle(
      ALIAS_BACKUP_FILE_NAME,
      { create: true }
    );
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(designerAliases, null, 2));
    await writable.close();
  } catch (error) {
    console.warn("Could not save designer alias backup", error);
  }
}

async function loadDesignerAliasesFromLibrary() {
  if (!libraryDirectoryHandle) return;

  try {
    const fileHandle = await libraryDirectoryHandle.getFileHandle(ALIAS_BACKUP_FILE_NAME);
    const file = await fileHandle.getFile();
    const saved = JSON.parse(await file.text());

    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;

    designerAliases = { ...designerAliases, ...saved };
    localStorage.setItem(ALIAS_STORAGE_KEY, JSON.stringify(designerAliases));
    renderAliasList();
  } catch (error) {
    if (error.name !== "NotFoundError") {
      console.warn("Could not load designer alias backup", error);
    }
  }
}

function exportDesignerAliases() {
  const blob = new Blob(
    [JSON.stringify(designerAliases, null, 2)],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pdf-organizer-designer-aliases-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderAliasList() {
  aliasList.innerHTML = "";

  const aliases = Object.keys(designerAliases)
    .sort((a, b) => a.localeCompare(b, "ko"));

  aliasCount.textContent = `(${aliases.length})`;

  if (aliases.length === 0) {
    aliasList.innerHTML =
      `<p class="empty">No saved aliases yet.</p>`;
    return;
  }

  aliases.forEach((alias) => {
    const row = document.createElement("div");
    row.className = "alias-row";

    const text = document.createElement("div");
    text.className = "alias-text";
    text.innerHTML =
      `<strong>${escapeHtml(alias)}</strong>` +
      `<span class="alias-arrow">→</span>` +
      `${escapeHtml(designerAliases[alias])}`;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "delete-button";
    button.textContent = "Delete";

    button.addEventListener("click", () => {
      delete designerAliases[alias];
      saveDesignerAliases();
    });

    row.appendChild(text);
    row.appendChild(button);
    aliasList.appendChild(row);
  });
}

function rememberConnection(file) {
  const alias = file.sourceDesignerName.trim();
  const folderName = getExistingFolderName(file);

  if (!folderName) {
    alert("Select an existing designer first.");
    return;
  }

  if (!alias) {
    alert("Enter the designer name as it appears in the filename.");
    return;
  }

  const existingAliasKey = Object.keys(designerAliases).find(
    (key) => normalizeText(key) === normalizeText(alias)
  );

  const previousFolder = existingAliasKey
    ? designerAliases[existingAliasKey]
    : null;

  if (
    previousFolder &&
    normalizeText(previousFolder) !== normalizeText(folderName)
  ) {
    const replaceConfirmed = window.confirm(
      `A different alias mapping already exists.\n\n` +
      `${alias} → ${previousFolder}\n\n` +
      `Change it to ${alias} → ${folderName}?`
    );

    if (!replaceConfirmed) {
      return;
    }
  }

  if (existingAliasKey) {
    delete designerAliases[existingAliasKey];
  }

  designerAliases[alias] = folderName;
  saveDesignerAliases();

  file.autoLinkedAlias = alias;

  const linkedFiles = applyRememberedConnectionsToEmptyFiles();
  // Keep the existing cards: rebuilding them drops focus and cached card heights.
  for (const updatedFile of [file, ...linkedFiles]) {
    updatedFile.refreshDesignerFields?.();
  }
  invalidateDuplicateCheck();
}

function applyRememberedConnectionsToEmptyFiles() {
  const linkedFiles = [];
  if (designerFolders.length === 0) {
    return linkedFiles;
  }

  downloadFiles.forEach((file) => {
    if (
      file.excluded ||
      file.destinationName.trim() ||
      file.selectedFolder ||
      file.sourceDesignerTouched ||
      file.patternManuallyEdited
    ) {
      return;
    }

    const match = findMatchingRememberedAlias(file.name);

    if (!match) {
      return;
    }

    file.selectedFolder = match.folderName;
    file.destinationName = match.folderName;
    file.sourceDesignerName = match.alias;
    file.patternFileName = suggestPatternFileName(file.name, match.alias);
    file.autoLinkedAlias = match.alias;
    linkedFiles.push(file);
  });
  return linkedFiles;
}

function findMatchingRememberedAlias(originalFileName) {
  const untouchedName =
    ensurePdfExtension(removePdfExtension(originalFileName).trim());

  const possibleMatches = Object.keys(designerAliases)
    .map((alias) => ({
      alias,
      folderName: designerAliases[alias]
    }))
    .filter((item) =>
      designerFolders.some(
        (folderName) =>
          normalizeText(folderName) === normalizeText(item.folderName)
      )
    )
    .filter((item) =>
      suggestPatternFileName(originalFileName, item.alias) !== untouchedName
    )
    .sort((a, b) => b.alias.length - a.alias.length);

  return possibleMatches[0] || null;
}
