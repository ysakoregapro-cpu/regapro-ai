# AccessContext

検索・RAG・ナレッジ取得の前に必ず構築する。

```
userId, organizationId, membershipId, departmentId, departmentKey,
roleKeys, permissionKeys, maximumConfidentialityLevel,
threadConfidentialityLevel, threadVisibility, projectIds,
participantThreadIds, auditMode, auditCaseId
```

実効検索上限:

```
min(user.maximumConfidentialityLevel, thread.confidentialityLevel)
```

Repository / RPC に AccessContext を渡し、取得後のフロント除外だけに依存しない。
