import { describe, expect, it } from "vitest";
import {
  citationsForRightPane,
  toAssistantMessages,
} from "./assistant-message-view";
import type { StoredMessage } from "./chat-service";
import { citationSourceLabel, extractChunkId, toCitationView } from "./citation-persistence";

describe("toAssistantMessages citation pass-through", () => {
  it("keeps persisted citations on reload mapping", () => {
    const messages: StoredMessage[] = [
      {
        id: "u1",
        threadId: "t1",
        role: "user",
        content: "取り組みを整理して",
        createdAt: "2026-08-16T00:00:00.000Z",
        confidentialityLevel: "company",
        visibility: "organization",
      },
      {
        id: "a1",
        threadId: "t1",
        role: "assistant",
        content: "確認できた範囲です",
        createdAt: "2026-08-16T00:00:01.000Z",
        confidentialityLevel: "company",
        visibility: "organization",
        citations: [
          {
            id: "c1",
            title: "社内メモ",
            source: "社内情報",
            excerpt: "公開済み抜粋",
            uri: "knowledge://document/d1/chunk/11111111-1111-1111-1111-111111111111",
            provenance: "internal",
          },
        ],
      },
    ];
    const local = toAssistantMessages(messages);
    expect(local[1]?.citations?.length).toBe(1);
    expect(local[1]?.citations?.[0]?.title).toBe("社内メモ");
    const pane = citationsForRightPane({
      messageCitations: local[1]?.citations ?? [],
      researchCitations: [],
    });
    expect(pane.length).toBe(1);
  });

  it("strips knowledge URIs from visible assistant text but keeps citation metadata", () => {
    const messages: StoredMessage[] = [
      {
        id: "a1",
        threadId: "t1",
        role: "assistant",
        content:
          "許可取得済みです（根拠：『紹介』 knowledge://document/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/chunk/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb）",
        createdAt: "2026-08-16T00:00:01.000Z",
        confidentialityLevel: "company",
        visibility: "organization",
        citations: [
          {
            id: "c1",
            title: "社内メモ",
            source: "社内情報",
            excerpt: "公開済み抜粋",
            uri: "knowledge://document/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/chunk/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            provenance: "internal",
          },
        ],
      },
    ];
    const local = toAssistantMessages(messages);
    expect(local[0]?.content).not.toMatch(/knowledge:\/\//);
    expect(local[0]?.content).not.toMatch(/根拠/);
    expect(local[0]?.citations?.[0]?.uri).toMatch(/^knowledge:\/\//);
  });

  it("does not let empty research wipe message citations", () => {
    const pane = citationsForRightPane({
      messageCitations: [
        { id: "c", title: "公開記事", source: "example.com", uri: "https://example.com", provenance: "web" },
      ],
      researchCitations: [],
    });
    expect(pane).toHaveLength(1);
    expect(pane[0]?.provenance).toBe("web");
  });
});

describe("citation persistence mapping", () => {
  it("extracts knowledge chunk ids and labels web domains", () => {
    expect(
      extractChunkId(
        "knowledge://document/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/chunk/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      ),
    ).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    expect(
      citationSourceLabel({
        sourceType: "web",
        sourceUrl: "https://www.example.com/a",
      }),
    ).toBe("example.com");
    expect(
      citationSourceLabel({ sourceType: "knowledge_chunk", sourceUrl: null }),
    ).toBe("社内情報");
  });

  it("reload view keeps web uri and provenance", () => {
    const view = toCitationView({
      id: "row-1",
      source_title: "市場レポート",
      source_url: "https://example.com/market",
      source_type: "web",
      excerpt: "公開動向",
      chunk_id: null,
      document_id: null,
    });
    expect(view.provenance).toBe("web");
    expect(view.uri).toBe("https://example.com/market");
    expect(view.source).toBe("example.com");
  });
});
