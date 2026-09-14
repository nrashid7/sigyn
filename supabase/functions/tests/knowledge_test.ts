import { assertEquals } from "jsr:@std/assert@1";
import {
  fileExtension,
  isSupportedKnowledgeFile,
  kbDocumentName,
  SUPPORTED_EXTENSIONS,
  toKbUpload,
} from "../_shared/knowledge.ts";

// --- fileExtension ---

Deno.test("fileExtension: lower-cases and strips the dot", () => {
  assertEquals(fileExtension("A.PDF"), "pdf");
  assertEquals(fileExtension("menu.pdf"), "pdf");
  assertEquals(fileExtension("Notes.Docx"), "docx");
});

Deno.test("fileExtension: returns an empty string when there is no extension", () => {
  assertEquals(fileExtension(""), "");
  assertEquals(fileExtension("README"), "");
  assertEquals(fileExtension("trailing-dot."), "");
});

// --- isSupportedKnowledgeFile ---

Deno.test("isSupportedKnowledgeFile: true for every supported extension", () => {
  for (const ext of SUPPORTED_EXTENSIONS) {
    assertEquals(isSupportedKnowledgeFile(`file.${ext}`), true);
  }
});

Deno.test("isSupportedKnowledgeFile: false for .doc", () => {
  assertEquals(isSupportedKnowledgeFile("photo.doc"), false);
});

Deno.test("isSupportedKnowledgeFile: true for .csv", () => {
  assertEquals(isSupportedKnowledgeFile("data.csv"), true);
});

Deno.test("isSupportedKnowledgeFile: false with no extension at all", () => {
  assertEquals(isSupportedKnowledgeFile("README"), false);
});

// --- toKbUpload ---

Deno.test("toKbUpload: renames a csv to txt and types it text/plain", async () => {
  const { blob, uploadFilename } = toKbUpload(
    "prices.csv",
    new TextEncoder().encode("a,b\n1,2"),
  );
  assertEquals(uploadFilename, "prices.txt");
  assertEquals(blob.type, "text/plain");
  assertEquals(await blob.text(), "a,b\n1,2");
});

Deno.test("toKbUpload: keeps the filename and types a pdf application/pdf", () => {
  const { blob, uploadFilename } = toKbUpload("menu.pdf", new Uint8Array([1, 2, 3]));
  assertEquals(uploadFilename, "menu.pdf");
  assertEquals(blob.type, "application/pdf");
});

Deno.test("toKbUpload: types docx as the OOXML wordprocessing mime type", () => {
  const { blob, uploadFilename } = toKbUpload("contract.docx", new Uint8Array());
  assertEquals(uploadFilename, "contract.docx");
  assertEquals(
    blob.type,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
});

Deno.test("toKbUpload: types txt and md as text/plain", () => {
  assertEquals(toKbUpload("notes.txt", new Uint8Array()).blob.type, "text/plain");
  assertEquals(toKbUpload("notes.md", new Uint8Array()).blob.type, "text/plain");
});

Deno.test("toKbUpload: types html as text/html", () => {
  assertEquals(toKbUpload("page.html", new Uint8Array()).blob.type, "text/html");
});

Deno.test("toKbUpload: types epub as application/epub+zip", () => {
  assertEquals(toKbUpload("book.epub", new Uint8Array()).blob.type, "application/epub+zip");
});

// --- kbDocumentName ---

Deno.test("kbDocumentName: joins business id, document id and filename", () => {
  assertEquals(
    kbDocumentName("biz_1", "doc_1", "menu.pdf"),
    "biz_1/doc_1/menu.pdf",
  );
});
