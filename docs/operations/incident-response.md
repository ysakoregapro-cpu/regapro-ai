# Incident Response / インシデント対応

Regapro AI のインシデント対応手順。

## Severity Levels / 深刻度

| Level | Description | Response Time | Example |
|---|---|---|---|
| SEV-1 | Service down, data breach | 15 min | DB unreachable, secret leaked |
| SEV-2 | Major feature broken | 1 hour | Auth failure, research pipeline down |
| SEV-3 | Minor feature degraded | 4 hours | Slow queries, UI bug on mobile |
| SEV-4 | Cosmetic / low impact | Next business day | Typo, minor styling issue |

## Incident Response Flow / 対応フロー

```
Detect → Triage → Mitigate → Resolve → Post-mortem
```

### 1. Detect / 検知

| Source | Method |
|---|---|
| Monitoring | Uptime checks, error rate alerts |
| User report | Support channel, in-app feedback |
| CI/CD | Failed deployment, check gate failure |
| Security | Secret scanner, unusual API activity |

### 2. Triage / トリアージ

1. Assign severity level
2. Assign incident commander
3. Create incident channel (Slack/Teams)
4. Document timeline start

### 3. Mitigate / 緩和

| Scenario | Immediate Action |
|---|---|
| Secret leaked | Rotate key immediately, revoke old |
| Bad deployment | `vercel rollback` to previous |
| DB corruption | Stop writes, restore from backup |
| RLS bypass discovered | Disable affected endpoint, patch RLS |
| SearXNG down | Research fails gracefully; user message |
| DDoS / abuse | Rate limit, block IPs |

### 4. Resolve / 解決

1. Root cause identified and fixed
2. `npm run check` passes on fix
3. Deploy fix
4. Verify in production
5. Monitor for 24 hours

### 5. Post-mortem / ポストモーテム

Template:

```markdown
# Incident Post-mortem: [TITLE]
Date: YYYY-MM-DD
Severity: SEV-X
Duration: X hours

## Summary
[1-2 sentences]

## Timeline
- HH:MM — Detected
- HH:MM — Mitigated
- HH:MM — Resolved

## Root Cause
[Technical explanation]

## Impact
- Users affected: N
- Data affected: [scope]

## Action Items
- [ ] [Preventive measure] — Owner — Due date
- [ ] [Detection improvement] — Owner — Due date
```

## Security Incidents / セキュリティインシデント

### Secret Exposure / 秘密情報漏洩

1. **Immediately rotate** affected keys
2. Check git history — if committed, use BFG/filter-branch
3. Audit access logs for unauthorized usage
4. Notify affected users if data accessed (within 72 hours, APPI compliance)
5. Update `.env.example` if template was wrong

### RLS Bypass / RLS 迂回

1. Disable affected API endpoint
2. Review and fix RLS policy
3. Audit data accessed during vulnerability window
4. Add integration test for the policy

### Data Breach / データ侵害

1. Contain: disable access, preserve logs
2. Assess: what data, how many users
3. Notify: legal team, affected users, authorities if required
4. Remediate: fix vulnerability, enhance monitoring

## Communication Templates / 連絡テンプレート

### User-Facing (JA) / ユーザー向け

```
現在、〇〇機能に一時的な障害が発生しています。
復旧作業を進めております。ご不便をおかけし申し訳ございません。
最新情報は [status page URL] でご確認ください。
```

### Internal / 社内

```
[SEV-X] Incident: [title]
Status: Investigating | Mitigated | Resolved
IC: [name]
Impact: [description]
Next update: [time]
```

## On-Call Rotation / オンコール

| Role | Responsibility |
|---|---|
| Primary | First responder, triage, mitigate |
| Secondary | Backup, escalation |
| Engineering Lead | SEV-1 decisions, post-mortem |

## Related / 関連

- [Backup and Recovery](./backup-and-recovery.md)
- [Data Security](../.cursor/rules/data-security.mdc)
- [Deployment](./deployment.md)
