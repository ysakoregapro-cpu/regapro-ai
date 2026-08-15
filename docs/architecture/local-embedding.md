# Local Embedding Runtime

## Audit decision

| Item | Choice | Reason |
|---|---|---|
| Runtime | Node + `@huggingface/transformers` | Self-hosted, no paid API, swappable |
| Model | `Xenova/multilingual-e5-small` | Multilingual (JA), documented **384-d** |
| DB column | `knowledge_chunks.embedding vector(384)` | Model drives schema (not provisional 1536) |
| Port | `@regapro/knowledge` `EmbeddingProvider` | Domain never imports Xenova/HF |

Provisional `vector(1536)` from initial schema is **not** treated as a product requirement. Changing models later requires a new migration that clears incompatible rows and updates the RPC signature.

## Activation

- Default: `REGAPRO_EMBEDDING_RUNTIME=transformers` (real ONNX embeddings, lazy download on first embed)
- Honest off: `REGAPRO_EMBEDDING_RUNTIME=disconnected` → lexical-only; no fake vectors
- Smoke: `REGAPRO_EMBEDDING_SMOKE=1 npm run test --workspace=@regapro/local-ai`

E5 prefixes: `query: ` / `passage: `.

## Flow

publish → chunk → `embedDocuments` → store model/version/dimensions →  
answer → `embedQuery` → `regapro_knowledge_vector_search` → RRF with lexical
