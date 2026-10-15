// Shared application state is initialized in app.js after these function definitions load.

function suggestPatternFileName(originalFileName, sourceDesignerName) {
  const baseName = removePdfExtension(originalFileName).trim();
  const designer = sourceDesignerName.trim();

  if (!designer) {
    return ensurePdfExtension(baseName);
  }

  const escapedDesigner = escapeRegExp(designer);

  const designerAtStart = new RegExp(
    `^${escapedDesigner}(?:\\s*[_-]\\s*)+`,
    "i"
  );

  const designerAtStartWithSpace = new RegExp(
    `^${escapedDesigner}\\s+`,
    "i"
  );

  const designerAtEndWithSymbol = new RegExp(
    `(?:\\s*[_-]\\s*)+${escapedDesigner}$`,
    "i"
  );

  const designerAtEndWithBy = new RegExp(
    `\\s+by\\s+${escapedDesigner}$`,
    "i"
  );

  const designerAtEndWithSpace = new RegExp(
    `\\s+${escapedDesigner}$`,
    "i"
  );

  const designerInMiddleWithSymbol = new RegExp(
    `([_-]+)${escapedDesigner}([_-]+)`,
    "i"
  );

  let cleanedName = baseName;

  if (designerAtStart.test(cleanedName)) {
    cleanedName = cleanedName.replace(designerAtStart, "");
  } else if (designerAtStartWithSpace.test(cleanedName)) {
    cleanedName = cleanedName.replace(designerAtStartWithSpace, "");
  } else if (designerAtEndWithBy.test(cleanedName)) {
    cleanedName = cleanedName.replace(designerAtEndWithBy, "");
  } else if (designerAtEndWithSymbol.test(cleanedName)) {
    cleanedName = cleanedName.replace(designerAtEndWithSymbol, "");
  } else if (designerAtEndWithSpace.test(cleanedName)) {
    cleanedName = cleanedName.replace(designerAtEndWithSpace, "");
  } else if (designerInMiddleWithSymbol.test(cleanedName)) {
    cleanedName = cleanedName.replace(designerInMiddleWithSymbol, "$1");
  }

  cleanedName = cleanedName.trim();

  return ensurePdfExtension(cleanedName || baseName);
}

function removePdfExtension(fileName) {
  return fileName.replace(/\.pdf$/i, "");
}

function ensurePdfExtension(fileName) {
  const cleaned = removePdfExtension(fileName).trim();
  return cleaned ? `${cleaned}.pdf` : "";
}

function normalizeText(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("ko");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
