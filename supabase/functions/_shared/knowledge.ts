/** File types the ElevenLabs knowledge base accepts natively. */
export const SUPPORTED_EXTENSIONS = ["pdf", "docx", "txt", "md", "html", "epub", "csv"] as const;

const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/plain",
  html: "text/html",
  epub: "application/epub+zip",
  // ElevenLabs has no CSV type; uploaded as plain text (see toKbUpload).
  csv: "text/plain",
};

/** Lower-cased extension without the dot; "" when the filename has none. */
export function fileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex === -1 || dotIndex === filename.length - 1) return "";
  return filename.slice(dotIndex + 1).toLowerCase();
}

export function isSupportedKnowledgeFile(filename: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(fileExtension(filename));
}

/**
 * Builds the multipart upload for the ElevenLabs knowledge base.
 * CSV has no dedicated type on ElevenLabs, so it is re-labelled as plain text.
 */
export function toKbUpload(
  filename: string,
  bytes: Uint8Array<ArrayBuffer>,
): { blob: Blob; uploadFilename: string } {
  const ext = fileExtension(filename);
  const mimeType = MIME_TYPES[ext] ?? "application/octet-stream";
  const uploadFilename = ext === "csv"
    ? `${filename.slice(0, filename.lastIndexOf("."))}.txt`
    : filename;

  return { blob: new Blob([bytes], { type: mimeType }), uploadFilename };
}

/** Namespaces the ElevenLabs document name so it is traceable back to the source row. */
export function kbDocumentName(
  businessId: string,
  documentId: string,
  filename: string,
): string {
  return `${businessId}/${documentId}/${filename}`;
}
